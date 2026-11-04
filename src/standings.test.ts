import { expect, it } from 'vitest';
import { standings, type Player } from './game';
it('sorts final totals and shares ranks without changing the roster',()=>{
  const players=[{id:'a',total:3},{id:'b',total:9},{id:'c',total:9},{id:'d',total:1.5}] as Player[];
  expect(standings(players).map(p=>[p.id,p.rank])).toEqual([['b',1],['c',1],['a',3],['d',4]]);
  expect(players.map(p=>p.id)).toEqual(['a','b','c','d']);
});
