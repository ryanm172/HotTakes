import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it } from 'vitest';
import type { Snapshot } from '../src/game';
const db=new PGlite();
const ids=Array.from({length:8},(_,i)=>`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
async function api(i:number,action:string,code='',payload:Record<string,unknown>={}){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);
  const result=await db.query<{s:Snapshot}>('select public.hot_game($1,$2,$3::jsonb) s',[action,code,JSON.stringify(payload)]);
  return result.rows[0].s;
}
function token(s:Snapshot,extra:Record<string,unknown>={}){return {round:s.round,prompt:s.prompt,speaker:s.hotseat?.order[s.hotseat.index],...extra};}
async function room(count=4,enabled=true){
  let s=await api(0,'create','',{name:'P0',badge:'hot-honey',hotseat:enabled});
  for(let i=1;i<count;i++)s=await api(i,'join',s.code,{name:`P${i}`});
  return s;
}
async function tiedRound(enabled=true,lowerTie=false){
  let s=await room(4,enabled);s=await api(0,'start',s.code);
  for(let i=0;i<4;i++)s=await api(i,'answer',s.code,{text:`Take ${i}`,prompt:s.prompt});
  const a=s.answers.map(v=>v.id);
  const ballots=[[a[1],a[2],a[3]],[a[0],a[2],a[3]],[a[0],a[1],a[3]],[a[1],a[0],a[2]]];
  if(lowerTie)ballots[3]=[a[0],a[2],a[1]];
  for(let i=0;i<4;i++)s=await api(i,'vote',s.code,{ids:ballots[i],prompt:s.prompt});
  return s;
}
async function speeches(s:Snapshot){
  while(s.phase==='hotseat_ready'){
    s=await api(ids.indexOf(s.host),'hotseat_start',s.code,token(s));
    const c=s.hotseat!.contestants.find(c=>c.id===s.hotseat!.order[s.hotseat!.index])!;
    s=await api(ids.indexOf(c.player),'hotseat_done',s.code,token(s));
  }
  return s;
}
async function threeWay(){
  let s=await room(6);
  const state={phase:'hotseat_ready',host:ids[0],round:5,prompt:'A three-way tie',used:[],deadline:null,history:[],ballots:{},
    players:s.players.map(p=>({id:p.id,name:p.name,badge:p.badge,seen:new Date().toISOString(),answered:true,voted:true,score_units:1680})),
    answers:s.players.map((p,i)=>({id:`a${i}`,player:p.id,text:`Take ${i}`,heat_units:i<3?100:50-i,heat:i<3?80:30-i,point_units:(i<3?3:6-i)*840,points:i<3?3:6-i})),
    hotseat:{order:['a0','a1','a2'],index:0,judges:ids.slice(3,6),pool_units:9*840,votes:{}}};
  await db.query('update hot_private.rooms set state=$1::jsonb where code=$2',[JSON.stringify(state),s.code]);
  s=await api(0,'sync',s.code);return speeches(s);
}
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const name of ['001_hot_takes.sql','002_room_lifecycle.sql','004_game_recap.sql','20261104204041_player_badges.sql','20261104213611_hot_seat.sql'])await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'));
},30000);
afterAll(()=>db.close());

it('intercepts only the highest exact tie, holds all totals, and saves a fixed speaking order',async()=>{
  const s=await tiedRound();
  expect(s.phase).toBe('hotseat_ready');expect(s.hotseat!.contestants.map(c=>c.player).sort()).toEqual(ids.slice(0,2));
  expect(s.hotseat!.judges).toEqual(ids.slice(2,4));expect(s.hotseat!.pool).toBe(3);
  expect(s.players.every(p=>p.total===0)).toBe(true);expect(s.answers.every(a=>a.points===undefined)).toBe(true);expect(s.history).toEqual([]);
  const resumed=await api(1,'resume',s.code);expect(resumed.hotseat!.order).toEqual(s.hotseat!.order);
  await expect(api(2,'hotseat_start',s.code,token(s))).rejects.toThrow('Only the host');
  expect(s.hotseat!.contestants.find(c=>c.player===ids[0])?.badge).toBe('hot-honey');
});
it('leaves rooms created without Hot Seat support on the original scoring flow',async()=>{
  const s=await tiedRound(false);expect(s.phase).toBe('results');expect(s.hotseat).toBeUndefined();
  expect(s.answers.map(a=>a.points)).toEqual([1.5,1.5,2,1]);
});
it('does not trigger for lower-position ties',async()=>{
  const s=await tiedRound(true,true);expect(s.phase).toBe('results');expect(s.hotseat).toBeUndefined();
  expect(s.answers.map(a=>a.points)).toEqual([0,2.5,2.5,1]);
});
it('skips a whole-room tie with a visible explanation',async()=>{
  let s=await room();s=await api(0,'start',s.code);
  for(let i=0;i<4;i++)s=await api(i,'answer',s.code,{text:`Take ${i}`,prompt:s.prompt});
  const answers=s.answers;
  for(let i=0;i<4;i++){
    const ranking=Array.from({length:3},(_,j)=>answers[(i+j+1)%4].id);
    s=await api(i,'vote',s.code,{ids:ranking,prompt:s.prompt});
  }
  expect(s.phase).toBe('results');expect(s.note).toContain('No outside judges');
  expect(s.players.every(p=>p.total===1.5)).toBe(true);
});
it('enforces speaker permissions, keeps one deadline on retry, and ignores stale turn tokens',async()=>{
  let s=await tiedRound();s=await api(0,'hotseat_start',s.code,token(s));
  const first={...s};const deadline=s.deadline;
  s=await api(0,'hotseat_start',s.code,token(s));expect(s.deadline).toBe(deadline);
  await expect(api(2,'hotseat_done',s.code,token(s))).rejects.toThrow('Only the current speaker');
  await db.query(`update hot_private.rooms set state=jsonb_set(state,'{deadline}',to_jsonb(now()-interval '1 second')) where code=$1`,[s.code]);
  s=await api(2,'sync',s.code);expect(s.phase).toBe('hotseat_ready');expect(s.hotseat!.index).toBe(1);
  s=await api(0,'hotseat_start',s.code,token(s));
  const speaker=first.hotseat!.contestants.find(c=>c.id===first.hotseat!.order[0])!;
  s=await api(ids.indexOf(speaker.player),'hotseat_done',s.code,token(first));
  expect(s.phase).toBe('hotseat_speaking');expect(s.hotseat!.index).toBe(1);
});
it('keeps votes private, enforces judge eligibility, and retains waiting judges after departure',async()=>{
  let s=await speeches(await tiedRound());const candidate=s.hotseat!.order[0];
  await expect(api(0,'hotseat_vote',s.code,token(s,{candidate}))).rejects.toThrow('outside judges');
  await expect(api(2,'hotseat_vote',s.code,token(s,{candidate:'not-a-contestant'}))).rejects.toThrow('contestant');
  s=await api(2,'hotseat_vote',s.code,token(s,{candidate}));
  expect(s.phase).toBe('hotseat_voting');expect(s.hotseat!.myVote).toBe(candidate);
  const other=await api(0,'sync',s.code);expect(other.hotseat!.myVote).toBeNull();
  expect(other.hotseat!.contestants.every(c=>!('votes' in c))).toBe(true);expect(other.answers.every(a=>a.defenseVotes===undefined)).toBe(true);
  await expect(api(2,'hotseat_vote',s.code,token(s,{candidate}))).rejects.toThrow('locked');
  await api(3,'leave',s.code);s=await api(0,'sync',s.code);
  expect(s.phase).toBe('hotseat_voting');expect(s.hotseat!.judges).toContain(ids[3]);
  s=await api(3,'resume',s.code);s=await api(3,'hotseat_vote',s.code,token(s,{candidate}));
  expect(s.phase).toBe('results');
  expect(s.answers.filter(a=>a.defenseVotes!==undefined).map(a=>a.points).sort()).toEqual([0,3]);
  const scores=s.players.map(p=>p.total);s=await api(3,'hotseat_vote',s.code,token(s,{candidate}));
  expect(s.players.map(p=>p.total)).toEqual(scores);
  const stored=await db.query<{history:any[]}>(`select state->'history' history from hot_private.rooms where code=$1`,[s.code]);expect(stored.rows[0].history).toHaveLength(1);
});
it.each([
  {votes:['a0','a0','a0'],points:[9,0,0],hottest:['a1','a2']},
  {votes:['a0','a0','a1'],points:[4.5,4.5,0],hottest:['a2']},
  {votes:['a0','a1','a2'],points:[3,3,3],hottest:['a0','a1','a2']},
])('distributes a three-way pool for $votes and delays round-five finish',async({votes,points,hottest})=>{
  let s=await threeWay();expect(s.phase).toBe('hotseat_voting');expect(s.history).toEqual([]);
  for(let i=0;i<3;i++)s=await api(i+3,'hotseat_vote',s.code,token(s,{candidate:votes[i]}));
  expect(s.phase).toBe('finished');expect(s.answers.slice(0,3).map(a=>a.points)).toEqual(points);
  expect(s.players.map(p=>p.total)).toEqual([...points.map(n=>n+2),5,4,3]);
  expect(s.history[0].takes.map(t=>t.id)).toEqual(hottest);
  const history=s.history;s=await api(0,'resume',s.code);expect(s.history).toEqual(history);
});
it('transfers hosting during Hot Seat without changing the order or offline speaker turn',async()=>{
  let s=await tiedRound();const order=s.hotseat!.order;
  await db.query(`update hot_private.rooms set state=jsonb_set(state,'{players,0,seen}',to_jsonb(now()-interval '1 minute')) where code=$1`,[s.code]);
  s=await api(1,'hotseat_start',s.code,token(s));expect(s.host).toBe(ids[1]);expect(s.phase).toBe('hotseat_speaking');expect(s.hotseat!.order).toEqual(order);
  const code=s.code;await api(1,'leave',code);s=await api(2,'sync',code);expect(s.hotseat!.order).toEqual(order);
  expect(s.phase).toBe('hotseat_speaking');
});
