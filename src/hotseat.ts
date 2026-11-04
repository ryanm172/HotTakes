import type { Answer, Snapshot } from './game';

export function defensePoints(pool:number,counts:number[]) {
  const minimum=Math.min(...counts), equal=counts.every(n=>n===minimum);
  const survivors=counts.filter(n=>equal||n>minimum).length;
  return counts.map(n=>equal||n>minimum?Math.round(pool*840)/survivors/840:0);
}

export function finishPracticeRound(room:Snapshot,answers:Answer[]):Snapshot {
  return {...room,phase:room.round===5?'finished':'results',deadline:null,answers,
    players:room.players.map(p=>({...p,voted:true,total:(Math.round(p.total*840)+Math.round((answers.find(a=>a.player===p.id)?.points||0)*840))/840})),
    history:[...room.history,{round:room.round,prompt:room.prompt,takes:answers.filter(a=>a.hottest).map(a=>({id:a.id,text:a.text,author:a.author!,badge:a.badge}))}]};
}

export function beginPracticeResults(room:Snapshot,answers:Answer[],random= Math.random):Snapshot {
  const tied=answers.filter(a=>a.hottest);
  const judges=room.players.filter(p=>!tied.some(a=>a.player===p.id)).map(p=>p.id);
  if(tied.length<2||!judges.length)return finishPracticeRound({...room,note:tied.length>1?'Everyone is tied for hottest. No outside judges, so points are shared.':undefined},answers);
  const order=tied.map(a=>a.id);
  for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  return {...room,phase:'hotseat_ready',deadline:null,answers:answers.map(({points,...a})=>a),
    hotseat:{contestants:tied.map(a=>({id:a.id,player:a.player!,name:a.author!,badge:a.badge,text:a.text})),
      order,index:0,pool:tied.reduce((sum,a)=>sum+Math.round(a.points!*840),0)/840,judges,submitted:[],myVote:null,practiceVotes:{},practiceAnswers:answers}};
}

function settlePractice(room:Snapshot):Snapshot {
  const h=room.hotseat!;
  if(h.submitted.length<h.judges.length)return room;
  const counts=h.order.map(id=>Object.values(h.practiceVotes!).filter(v=>v===id).length);
  const points=defensePoints(h.pool,counts),minimum=Math.min(...counts);
  return finishPracticeRound(room,h.practiceAnswers!.map(a=>{
    const i=h.order.indexOf(a.id);
    return i<0?a:{...a,points:points[i],defenseVotes:counts[i],hottest:counts[i]===minimum};
  }));
}

export function practiceHotSeat(room:Snapshot,action:string,candidate?:string,now=Date.now(),random=Math.random):Snapshot {
  const h=room.hotseat;if(!h)return room;
  if(action==='hotseat_start'&&room.phase==='hotseat_ready')return {...room,phase:'hotseat_speaking',deadline:new Date(now+60000).toISOString()};
  if(action==='hotseat_done'&&room.phase==='hotseat_speaking'){
    const index=h.index+1;
    if(index<h.order.length)return {...room,phase:'hotseat_ready',deadline:null,hotseat:{...h,index}};
    const votes:Record<string,string>={};
    for(const judge of h.judges.filter(id=>id!==room.me))votes[judge]=h.order[Math.floor(random()*h.order.length)];
    return settlePractice({...room,phase:'hotseat_voting',deadline:null,hotseat:{...h,index,practiceVotes:votes,submitted:Object.keys(votes)}});
  }
  if(action==='hotseat_vote'&&room.phase==='hotseat_voting'&&h.judges.includes(room.me)&&!h.submitted.includes(room.me)&&candidate&&h.order.includes(candidate)){
    return settlePractice({...room,hotseat:{...h,myVote:candidate,submitted:[...h.submitted,room.me],practiceVotes:{...h.practiceVotes,[room.me]:candidate}}});
  }
  return room;
}
