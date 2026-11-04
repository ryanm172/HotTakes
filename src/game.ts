export type Phase = 'lobby' | 'answering' | 'voting' | 'hotseat_ready' | 'hotseat_speaking' | 'hotseat_voting' | 'results' | 'finished';
export type Player = { id: string; name: string; badge?: string; online: boolean; answered: boolean; voted: boolean; total: number };
export type Answer = { id: string; text: string; mine?: boolean; author?: string; badge?: string; heat?: number; points?: number; hottest?:boolean; defenseVotes?:number; player?:string };
export type HotSeat = {contestants:{id:string;player:string;name:string;badge?:string;text:string}[];order:string[];index:number;pool:number;judges:string[];submitted:string[];myVote:string|null;practiceVotes?:Record<string,string>;practiceAnswers?:Answer[]};
export type RoundHighlight = { round: number; prompt: string; takes: {id:string; text:string; author:string;badge?:string}[] };
export type Snapshot = { code: string; phase: Phase; host: string; me: string; round: number; prompt: string; deadline: string | null; players: Player[]; answers: Answer[]; history: RoundHighlight[]; hotseat?:HotSeat; note?: string };
export function standings(players: Player[]) {
  const sorted=[...players].sort((a,b)=>b.total-a.total);
  return sorted.map(player=>({...player,rank:1+sorted.filter(p=>p.total>player.total).length}));
}
export const prompts = [
  'Which pizza topping deserves more respect?', 'Who is an actor everyone finds hot… except you?',
  'What food is wildly overrated?', 'What is the most underrated condiment?',
  'Which movie does not deserve the hype?', 'Who is a surprisingly attractive celebrity?',
  'What popular song is actually terrible?', 'What is the worst thing to put on a hot dog?',
  'What is a food combination you would defend with your life?', 'Which fictional villain had a point?',
  'Which beloved TV show should have ended sooner?', 'What is the most overrated holiday?',
  'What is a fashion trend that needs to disappear?', 'Which celebrity would be the worst roommate?',
  'What is the best thing to eat cold?', 'Which movie sequel is better than the original?',
  'What is an acceptable thing to put ketchup on?', 'Which social habit should be illegal at parties?',
  'What is the most overrated vacation activity?', 'Which celebrity is more talented than people admit?',
  'What is an unpopular opinion you have about breakfast?', 'What is the worst popular first-date idea?',
  'What is the most attractive quality people overlook?', 'What is the best terrible reality TV show?',
  'Which snack would you happily ban forever?', 'What is something adults should stop pretending to enjoy?',
  'Which actor is always playing the same character?', 'What belongs on a sandwich but will start an argument?',
  'What is a movie everyone should watch exactly once?', 'What is the most overrated thing about being an adult?',
];

// Integer ranks yield rational heat scores. Compare fractions, not rounded display values.
export function scoreAnswers(ids: string[], ballots: string[][]) {
  const heat = ids.map(id => {
    let numerator = 0n, denominator = 1n, count = 0n;
    for (const ballot of ballots) {
      const rank = ballot.indexOf(id);
      if (rank < 0) continue;
      if (ballot.length < 2) throw new Error('A ballot needs at least two answers.');
      const d = BigInt(ballot.length - 1);
      numerator = numerator * d + BigInt(ballot.length - 1 - rank) * denominator;
      denominator *= d;
      count++;
    }
    if (!count) throw new Error('Every answer needs a rating.');
    return { id, numerator, denominator: denominator * count };
  }).sort((a,b) => { const diff = b.numerator * a.denominator - a.numerator * b.denominator; return diff > 0n ? 1 : diff < 0n ? -1 : 0; });
  const result: { id: string; heat: number; points: number; hottest:boolean }[] = [];
  for (let i = 0; i < heat.length;) {
    let end = i + 1;
    while (end < heat.length && heat[i].numerator * heat[end].denominator === heat[end].numerator * heat[i].denominator) end++;
    let points = 0;
    for (let j = i; j < end; j++) points += j === 0 ? 0 : ids.length - j;
    for (let j = i; j < end; j++) result.push({ id: heat[j].id, heat: Number(heat[j].numerator) / Number(heat[j].denominator) * 100, points: points / (end - i), hottest:i===0 });
    i = end;
  }
  return result;
}
export const formatPoints = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
