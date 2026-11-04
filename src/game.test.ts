import { describe, expect, it } from 'vitest';
import { scoreAnswers } from './game';
describe('heat scoring',()=>{
  it('averages tied first and second points',()=>{
    const scores=scoreAnswers(['a','b','c'],[['a','b','c'],['b','a','c']]);
    expect(scores.map(s=>s.points)).toEqual([1,1,1]);
  });
  it('awards zero to hottest, most to second, then descending',()=>{
    const ids=['a','b','c','d','e','f'];
    expect(scoreAnswers(ids,[ids]).map(s=>s.points)).toEqual([0,5,4,3,2,1]);
  });
  it('normalizes ballots with different lengths',()=>{
    const scores=scoreAnswers(['a','b','c'],[['a','b','c'],['b','a'],['a','c']]);
    expect(scores.find(s=>s.id==='a')?.heat).toBeCloseTo(200/3);
    expect(scores.find(s=>s.id==='b')?.heat).toBe(75);
  });
  it('does not invent a score for an unrated answer',()=>{
    expect(()=>scoreAnswers(['a','b','c'],[['a','b']])).toThrow('Every answer');
  });
});
