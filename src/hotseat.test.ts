import { expect, it } from 'vitest';
import { beginPracticeResults, defensePoints, practiceHotSeat } from './hotseat';
import type { Answer, Snapshot } from './game';

it.each([
  {pool:9,votes:[1,0,0],points:[9,0,0]},
  {pool:9,votes:[2,1,0],points:[4.5,4.5,0]},
  {pool:9,votes:[1,1,1],points:[3,3,3]},
  {pool:12,votes:[1,1,0,0],points:[6,6,0,0]},
  {pool:27,votes:[1,1,1,1,1,1,0],points:[4.5,4.5,4.5,4.5,4.5,4.5,0]},
])('shares $pool for defense counts $votes',({pool,votes,points})=>expect(defensePoints(pool,votes)).toEqual(points));

const room:Snapshot={code:'PRACTICE',phase:'voting',host:'0',me:'0',round:5,prompt:'Test',deadline:null,answers:[],history:[],players:Array.from({length:4},(_,i)=>({id:String(i),name:`P${i}`,badge:'hot-sauce',online:true,answered:true,voted:false,total:2}))};
const answers:Answer[]=room.players.map((p,i)=>({id:`a${i}`,player:p.id,text:`T${i}`,author:p.name,hottest:i<2,heat:i<2?80:30-i,points:i<2?1.5:4-i}));
it('practice defers totals, runs speakers, simulates judges and preserves the final recap',()=>{
  let s=beginPracticeResults(room,answers,()=>0.99);
  expect(s.phase).toBe('hotseat_ready');expect(s.players.map(p=>p.total)).toEqual([2,2,2,2]);
  s=practiceHotSeat(s,'hotseat_start',undefined,100);expect(s.deadline).toBe(new Date(60100).toISOString());
  s=practiceHotSeat(s,'hotseat_done');s=practiceHotSeat(s,'hotseat_start');s=practiceHotSeat(s,'hotseat_done',undefined,100,()=>0);
  expect(s.phase).toBe('finished');expect(s.players.map(p=>p.total)).toEqual([5,2,4,3]);
  expect(s.history[0].takes.map(t=>t.id)).toEqual(['a1']);
  expect(practiceHotSeat(s,'hotseat_done').players).toEqual(s.players);
});
it('practice waits for the real player when they are an outside judge',()=>{
  let s=beginPracticeResults({...room,me:'3'},answers,()=>0.99);
  for(let i=0;i<2;i++){s=practiceHotSeat(s,'hotseat_start');s=practiceHotSeat(s,'hotseat_done',undefined,100,()=>0);}
  expect(s.phase).toBe('hotseat_voting');expect(s.hotseat!.submitted).toEqual(['2']);
  s=practiceHotSeat(s,'hotseat_vote','a1');expect(s.phase).toBe('finished');expect(s.answers.slice(0,2).map(a=>a.points)).toEqual([1.5,1.5]);
});
it('practice skips the Hot Seat with no outside judges',()=>{
  const s=beginPracticeResults(room,answers.map(a=>({...a,hottest:true,points:1.5})));
  expect(s.phase).toBe('finished');expect(s.note).toContain('No outside judges');expect(s.history[0].takes).toHaveLength(4);
});
