import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/game';
import { scoreAnswers } from '../src/game';
import { badges } from '../src/badges';

const db=new PGlite();
const ids=Array.from({length:9},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
async function api(player:number,action:string,code='',payload:Record<string,unknown>={}){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[player]]);
  const r=await db.query<{s:Snapshot}>('select public.hot_game($1,$2,$3::jsonb) as s',[action,code,JSON.stringify(payload)]);
  if ('unavailable' in r.rows[0].s) throw new Error(String(r.rows[0].s.unavailable));
  return r.rows[0].s;
}
async function room(count=4){
  let s=await api(0,'create','',{name:'Player 1'});
  for(let i=1;i<count;i++)s=await api(i,'join',s.code,{name:`Player ${i+1}`});
  return api(0,'start',s.code);
}
async function answerAll(s:Snapshot,count=4){for(let i=0;i<count;i++)s=await api(i,'answer',s.code,{text:`Take ${i}`,prompt:s.prompt});return s;}
beforeAll(async()=>{
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(readFileSync('supabase/migrations/001_hot_takes.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/002_room_lifecycle.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/004_game_recap.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104204041_player_badges.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104213611_hot_seat.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
describe('authoritative multiplayer game',()=>{
  it('validates badges, allows duplicates, and limits changes to the caller in the lobby',async()=>{
    await expect(api(0,'create','',{name:'Host',badge:'not-an-icon'})).rejects.toThrow('eight');
    let s=await api(0,'create','',{name:'Host',badge:'hot-breath'});
    expect(s.players[0].badge).toBe('hot-breath');
    await expect(api(1,'join',s.code,{name:'Other',badge:'bad'})).rejects.toThrow('eight');
    s=await api(1,'join',s.code,{name:'Other',badge:'hot-breath'});
    expect(s.players.every(p=>p.badge==='hot-breath')).toBe(true);
    await expect(api(0,'badge',s.code,{badge:'https://untrusted/image.png'})).rejects.toThrow('eight');
    s=await api(1,'badge',s.code,{badge:'hot-honey',player:ids[0]});
    expect(s.players.map(p=>p.badge)).toEqual(['hot-breath','hot-honey']);
    for(const badge of badges){
      s=await api(1,'badge',s.code,{badge:badge.id});
      expect(s.players[1].badge).toBe(badge.id);
    }
    await expect(api(2,'badge',s.code,{badge:'hot-sun'})).rejects.toThrow('Join');
  });
  it('defaults to Hot Sauce, locks saved badges after start, and preserves them on reconnect',async()=>{
    let s=await api(0,'create','',{name:'Host'});
    expect(s.players[0].badge).toBe('hot-sauce');
    for(let i=1;i<4;i++)s=await api(i,'join',s.code,{name:`P${i}`,badge:'hot-potato'});
    s=await api(0,'start',s.code);
    // Simulate a save arriving after another player started the game.
    s=await api(1,'badge',s.code,{badge:'hot-coffee'});
    expect(s.phase).toBe('answering');expect(s.players[1].badge).toBe('hot-potato');
    await api(1,'leave',s.code);
    s=await api(1,'resume',s.code);
    expect(s.players[1].badge).toBe('hot-potato');
    s=await api(1,'join',s.code,{name:'P1',badge:'hot-sun'});
    expect(s.players[1].badge).toBe('hot-potato');
  });
  it('enforces room capacity, membership, and host controls',async()=>{
    let s=await api(0,'create','',{name:'Host'});
    await expect(api(0,'start',s.code)).rejects.toThrow('four');
    await expect(api(1,'sync',s.code)).rejects.toThrow('Join');
    for(let i=1;i<8;i++)s=await api(i,'join',s.code,{name:`Player ${i}`});
    await expect(api(8,'join',s.code,{name:'Ninth'})).rejects.toThrow('full');
    await expect(api(1,'start',s.code)).rejects.toThrow('Only the host');
    s=await api(0,'start',s.code);expect(s.players).toHaveLength(8);
  });
  it('scores an eight-way heat tie exactly and pauses below four online players',async()=>{
    let s=await answerAll(await room(8),8);
    for(let i=0;i<8;i++){
      // Cyclic rankings give each answer every rank exactly once.
      const snapshots=await api(i,'sync',s.code);
      const ordered=snapshots.answers;
      const ownIndex=ordered.findIndex(a=>a.mine);
      const ranking=Array.from({length:7},(_,j)=>ordered[(ownIndex+j+1)%8].id);
      s=await api(i,'vote',s.code,{ids:ranking,prompt:s.prompt});
    }
    expect(s.phase).toBe('results');
    expect(s.answers.every(a=>a.heat===50&&a.points===3.5)).toBe(true);
    const stored=await db.query<{history:any[]}>(`select state->'history' history from hot_private.rooms where code=$1`,[s.code]);
    expect(stored.rows[0].history[0].takes).toHaveLength(8);
    expect(s.history).toEqual([]); // Recap is only exposed once the game finishes.
    await db.query(`update hot_private.rooms set state=jsonb_set(state,'{players}',(select jsonb_agg(jsonb_set(p,'{seen}',to_jsonb(now()-interval '1 minute'))) from jsonb_array_elements(state->'players') p)) where code=$1`,[s.code]);
    await expect(api(0,'next',s.code)).rejects.toThrow('four');
  });
  it('keeps state private and grants only the authenticated RPC',async()=>{
    const r=await db.query<{schema:boolean;rpc:boolean;anon:boolean}>(`select
      has_schema_privilege('authenticated','hot_private','usage') as schema,
      has_function_privilege('authenticated','public.hot_game(text,text,jsonb)','execute') as rpc,
      has_function_privilege('anon','public.hot_game(text,text,jsonb)','execute') as anon`);
    expect(r.rows[0]).toEqual({schema:false,rpc:true,anon:false});
  });
  it('runs five rounds, reveals authors only at results, matches exact reference scores, and never repeats prompts',async()=>{
    let s=await room(); const used=new Set<string>();
    for(let round=1;round<=5;round++){
      expect(s.round).toBe(round); expect(used.has(s.prompt)).toBe(false); used.add(s.prompt);
      s=await api(0,'answer',s.code,{text:'First take',prompt:s.prompt});
      expect(s.answers).toEqual([]);
      expect(s.history).toEqual([]);
      s=await api(1,'sync',s.code);expect(s.answers).toEqual([]);
      for(let i=1;i<4;i++)s=await api(i,'answer',s.code,{text:`Take ${i}`,prompt:s.prompt});
      expect(s.phase).toBe('voting');expect(s.answers.every(a=>a.author===undefined&&a.badge===undefined)).toBe(true);
      const ballots:string[][]=[];const answerIds=s.answers.map(a=>a.id);
      for(let i=0;i<4;i++){
        const own=await api(i,'sync',s.code);
        const ranking=own.answers.filter(a=>!a.mine).map(a=>a.id);
        ballots.push(ranking);s=await api(i,'vote',s.code,{ids:ranking,prompt:s.prompt});
      }
      expect(s.phase).toBe(round===5?'finished':'results');
      const expected=scoreAnswers(answerIds,ballots);
      for(const a of s.answers){expect(a.author).toBeTruthy();expect(a.badge).toBe('hot-sauce');expect(a.points).toBeCloseTo(expected.find(e=>e.id===a.id)!.points);}
      if(round<5)s=await api(0,'next',s.code);
    }
    expect(used.size).toBe(5);
    expect(s.history.map(r=>r.round)).toEqual([1,2,3,4,5]);
    expect(s.history.map(r=>r.prompt)).toEqual([...used]);
    expect(s.history.every(r=>r.takes.length>0&&r.takes.every(t=>t.author&&t.text&&t.badge==='hot-sauce'))).toBe(true);
    const synced=await api(0,'sync',s.code);
    expect(synced.history).toEqual(s.history); // Polling must not duplicate highlights.
    expect((await api(0,'resume',s.code)).history).toEqual(s.history);
    expect(JSON.stringify(s.history)).not.toMatch(/ballots|heat_units|point_units|"player"/);
  });
  it('rejects locked answers, incomplete ballots, own votes, and late joins',async()=>{
    let s=await room();
    s=await api(0,'answer',s.code,{text:'Locked',prompt:s.prompt});
    await expect(api(0,'answer',s.code,{text:'Edit',prompt:s.prompt})).rejects.toThrow('locked');
    await expect(api(4,'join',s.code,{name:'Late'})).rejects.toThrow('started');
    for(let i=1;i<4;i++)s=await api(i,'answer',s.code,{text:'Same duplicate take',prompt:s.prompt});
    const own=await api(0,'sync',s.code);
    await expect(api(0,'vote',s.code,{ids:[],prompt:s.prompt})).rejects.toThrow('every other');
    await expect(api(0,'vote',s.code,{ids:own.answers.slice(0,3).map(a=>a.id),prompt:s.prompt})).rejects.toThrow('Invalid answer');
    const ranked=own.answers.filter(a=>!a.mine).map(a=>a.id);
    await api(0,'vote',s.code,{ids:ranked,prompt:s.prompt});
    await expect(api(0,'vote',s.code,{ids:ranked,prompt:s.prompt})).rejects.toThrow('locked');
  });
  it('waits indefinitely for a disconnected voter and transfers host without skipping them',async()=>{
    let s=await answerAll(await room());
    for(let i=1;i<4;i++){
      const own=await api(i,'sync',s.code);
      s=await api(i,'vote',s.code,{ids:own.answers.filter(a=>!a.mine).map(a=>a.id),prompt:s.prompt});
    }
    await db.query(`update hot_private.rooms set state=jsonb_set(state,'{players,0,seen}',to_jsonb(now()-interval '2 hours')) where code=$1`,[s.code]);
    s=await api(1,'sync',s.code);
    expect(s.host).toBe(ids[1]);expect(s.phase).toBe('voting');expect(s.players[0].voted).toBe(false);
    await expect(api(1,'next',s.code)).rejects.toThrow('moved on');
    const own=await api(0,'sync',s.code);
    s=await api(0,'vote',s.code,{ids:own.answers.filter(a=>!a.mine).map(a=>a.id),prompt:s.prompt});
    expect(s.phase).toBe('results');
  });
  it('skips insufficient answers and never attaches an expired answer to the replacement prompt',async()=>{
    let s=await room(); const oldPrompt=s.prompt;
    await db.query(`update hot_private.rooms set state=jsonb_set(state,'{deadline}',to_jsonb(now()-interval '1 second')) where code=$1`,[s.code]);
    s=await api(0,'answer',s.code,{text:'Too late',prompt:oldPrompt});
    expect(s.phase).toBe('answering');expect(s.round).toBe(1);expect(s.prompt).not.toBe(oldPrompt);expect(s.players[0].answered).toBe(false);expect(s.note).toContain('Fewer');
  });
  it('allows missing-answer players to vote with a longer ballot',async()=>{
    let s=await room();
    for(let i=0;i<3;i++)s=await api(i,'answer',s.code,{text:`Take ${i}`,prompt:s.prompt});
    await db.query(`update hot_private.rooms set state=jsonb_set(state,'{deadline}',to_jsonb(now()-interval '1 second')) where code=$1`,[s.code]);
    s=await api(3,'sync',s.code);expect(s.phase).toBe('voting');expect(s.answers).toHaveLength(3);
    for(let i=0;i<4;i++){
      const own=await api(i,'sync',s.code);
      s=await api(i,'vote',s.code,{ids:own.answers.filter(a=>!a.mine).map(a=>a.id),prompt:s.prompt});
    }
    expect(s.phase).toBe('results');expect(s.players[3].total).toBe(0);
  });
});
