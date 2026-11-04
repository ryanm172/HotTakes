import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it } from 'vitest';
const db=new PGlite();
const ids=Array.from({length:4},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`);
async function call(i:number,action:string,code='',payload={}){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);
  const result=await db.query<{s:any}>('select public.hot_game($1,$2,$3::jsonb) s',[action,code,JSON.stringify(payload)]);
  return result.rows[0].s;
}
async function lobby(){return call(0,'create','',{name:'Host'});}
async function agePlayer(code:string,i:number,age:string){
  await db.query(`update hot_private.rooms set state=jsonb_set(state,$1::text[],to_jsonb(now()-$2::interval)) where code=$3`,[['players',String(i),'seen'],age,code]);
}
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for(const file of ['001_hot_takes.sql','002_room_lifecycle.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(()=>db.close());
it('removes lobby members, frees nicknames and transfers host immediately',async()=>{
  const {code}=await lobby();
  await call(1,'join',code,{name:'Next'});
  await call(0,'leave',code);
  const s=await call(1,'sync',code);
  expect(s.host).toBe(ids[1]);expect(s.players).toHaveLength(1);
  expect((await call(2,'join',code,{name:'Host'})).players).toHaveLength(2);
});
it('deletes an empty lobby and treats repeated leave safely',async()=>{
  const {code}=await lobby();await call(0,'leave',code);
  expect((await call(0,'sync',code)).unavailable).toBeTruthy();
  expect((await call(0,'leave',code)).unavailable).toBeTruthy();
});
it('closes a lobby when its host explicitly leaves only offline members',async()=>{
  const {code}=await lobby();await call(1,'join',code,{name:'Away'});await agePlayer(code,1,'1 minute');
  await call(0,'leave',code);expect((await call(1,'resume',code)).unavailable).toBeTruthy();
});
it('preserves a disconnected host lobby and permits rejoining after pruning',async()=>{
  const {code}=await lobby();await call(1,'join',code,{name:'Next'});await agePlayer(code,0,'11 minutes');
  const s=await call(1,'sync',code);expect(s.host).toBe(ids[1]);expect(s.players).toHaveLength(1);
  expect((await call(0,'join',code,{name:'Host'})).players).toHaveLength(2);
});
it('expires on access without revival and does not refresh activity for failed membership',async()=>{
  const {code}=await lobby();
  await expect(call(1,'answer',code)).resolves.toHaveProperty('unavailable');
  await db.query(`update hot_private.rooms set last_activity_at=now()-interval '1 hour' where code=$1`,[code]);
  expect((await call(0,'resume',code)).unavailable).toContain('expired');
  expect((await db.query('select * from hot_private.rooms where code=$1',[code])).rows).toHaveLength(0);
});
it('retains departed active players and ballots; stale sync cannot undo leave',async()=>{
  const {code}=await lobby();for(let i=1;i<4;i++)await call(i,'join',code,{name:`P${i}`});
  await call(0,'start',code);
  let s=await call(0,'sync',code);
  for(let i=0;i<4;i++)s=await call(i,'answer',code,{text:`Take ${i}`,prompt:s.prompt});
  const own=await call(0,'sync',code);
  await call(0,'vote',code,{ids:own.answers.filter((a:any)=>!a.mine).map((a:any)=>a.id),prompt:s.prompt});
  await call(0,'leave',code);await call(0,'leave',code);
  expect(await call(0,'sync',code)).toEqual({departed:true});
  s=await call(1,'sync',code);expect(s.host).toBe(ids[1]);expect(s.players).toHaveLength(4);
  expect(s.players[0]).toMatchObject({online:false,voted:true});
  expect((await call(0,'resume',code)).players[0]).toMatchObject({online:true,voted:true});
});
it('waits for an explicitly departed voter and completes when they return',async()=>{
  const {code}=await lobby();for(let i=1;i<4;i++)await call(i,'join',code,{name:`P${i}`});
  let s=await call(0,'start',code);
  for(let i=0;i<4;i++)s=await call(i,'answer',code,{text:`Take ${i}`,prompt:s.prompt});
  await call(0,'leave',code);
  for(let i=1;i<4;i++){
    const own=await call(i,'sync',code);
    s=await call(i,'vote',code,{ids:own.answers.filter((a:any)=>!a.mine).map((a:any)=>a.id),prompt:s.prompt});
  }
  expect(s.phase).toBe('voting');expect(s.players[0].voted).toBe(false);
  const own=await call(0,'resume',code);
  s=await call(0,'vote',code,{ids:own.answers.filter((a:any)=>!a.mine).map((a:any)=>a.id),prompt:s.prompt});
  expect(s.phase).toBe('results');
});
it('retains finished results on leave and expires them on the normal inactivity window',async()=>{
  const {code}=await lobby();
  await db.query(`update hot_private.rooms set state=jsonb_set(state,'{phase}','"finished"') where code=$1`,[code]);
  await call(0,'leave',code);
  expect((await call(0,'resume',code)).phase).toBe('finished');
  await db.query(`update hot_private.rooms set last_activity_at=now()-interval '1 hour' where code=$1`,[code]);
  expect((await call(0,'resume',code)).unavailable).toBeTruthy();
});
it('cleanup prunes lobby slots and expired games without removing active-game slots',async()=>{
  const a=await lobby();await agePlayer(a.code,0,'11 minutes');
  const b=await lobby();await db.query(`update hot_private.rooms set last_activity_at=now()-interval '2 hours' where code=$1`,[b.code]);
  const c=await lobby();for(let i=1;i<4;i++)await call(i,'join',c.code,{name:`P${i}`});await call(0,'start',c.code);await agePlayer(c.code,0,'11 minutes');
  await db.exec('select hot_private.cleanup_rooms()');
  for(const code of [a.code,b.code])expect((await db.query('select code from hot_private.rooms where code=$1',[code])).rows).toHaveLength(0);
  expect((await call(1,'sync',c.code)).players).toHaveLength(4);
});
it('keeps lifecycle internals inaccessible to clients',async()=>{
  const result=await db.query<{allowed:boolean}>(`select has_function_privilege('authenticated','hot_private.cleanup_rooms()','execute') or has_function_privilege('authenticated','hot_private.hot_game_core(text,text,jsonb)','execute') allowed`);
  expect(result.rows[0].allowed).toBe(false);
});
