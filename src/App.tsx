import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronDown, ChevronUp, Copy, Crown, Flame, GripVertical, HelpCircle, Link, LoaderCircle, LogOut, Radio, Sparkles, Timer, Trophy, Users, X } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { callGame, configured } from './api';
import { formatPoints, prompts, scoreAnswers, type Answer, type Snapshot } from './game';

const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};
const demoNames = ['You', 'Alex', 'Jordan', 'Sam'];
const sampleAnswers = ['Pineapple. And I will not be taking questions.', 'Cold leftover pizza beats fresh pizza.', 'Anchovies deserve a redemption arc.'];

function RankCard({ answer, index, move, total }: { answer: Answer; index: number; move: (from: number, to: number) => void; total: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: answer.id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`rank-card ${isDragging ? 'dragging' : ''}`}>
    <span className="rank-number">{index + 1}</span><p>{answer.text}</p>
    <div className="rank-controls"><button type="button" className="icon-button small" aria-label={`Move answer ${index + 1} hotter`} disabled={index === 0} onClick={() => move(index,index-1)}><ChevronUp size={16}/></button><button type="button" className="icon-button small" aria-label={`Move answer ${index + 1} colder`} disabled={index === total-1} onClick={() => move(index,index+1)}><ChevronDown size={16}/></button></div>
    <button type="button" className="drag-handle" aria-label={`Drag answer ${index+1} to reorder`} {...attributes} {...listeners}><GripVertical size={22}/></button>
  </div>;
}

function MiniGame() {
  return <div className="game-art" aria-label="Example ranking: too hot gets zero, second hottest wins the most points">
    <div className="art-ring ring-one"/><div className="art-ring ring-two"/>
    <div className="sticker"><Sparkles size={17}/> FRIENDSHIPS MAY VARY</div>
    <div className="example-card"><div className="example-top"><span>LET’S SETTLE THIS</span><span>01 / 05</span></div>
      <h3>What food is<br/>wildly overrated?</h3><div className="example-rule">THE ROOM HAS SPOKEN <ArrowDown size={13}/></div>
      <div className="example-answer too-hot"><span className="answer-symbol"><Flame size={23}/></span><div><strong>Pizza.</strong><small>That’s a little too hot.</small></div><b>0 <small>PTS</small></b></div>
      <div className="example-answer sweet-spot"><span className="answer-symbol"><Trophy size={23}/></span><div><strong>Truffle fries.</strong><small>Perfectly controversial.</small></div><b>5 <small>PTS</small></b></div>
      <div className="example-answer cooler"><span className="answer-symbol">03</span><div><strong>Avocado toast.</strong><small>We can see your point.</small></div><b>4 <small>PTS</small></b></div>
      <div className="example-bottom"><span className="avatar-stack"><i>A</i><i>J</i><i>S</i><i>+3</i></span><span>6 opinions. Zero chill.</span></div>
    </div><div className="floating-note">Get hot.<br/><em>Just not too hot.</em><svg viewBox="0 0 70 40" aria-hidden="true"><path d="M2 5Q55 0 54 30M45 21L54 32L64 23" fill="none" stroke="currentColor" strokeWidth="2"/></svg></div>
  </div>;
}

export default function App() {
  const [room,setRoom] = useState<Snapshot|null>(null);
  const [roomCode,setRoomCode] = useState(() => localStorage.getItem('hot-room') || '');
  const [name,setName] = useState(() => localStorage.getItem('hot-name') || '');
  const [joinCode,setJoinCode] = useState(() => new URLSearchParams(location.search).get('room') || '');
  const [mode,setMode] = useState<'create'|'join'>(()=>new URLSearchParams(location.search).has('room')?'join':'create');
  const [demo,setDemo] = useState(false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [showRules,setShowRules] = useState(false);
  const [answer,setAnswer] = useState('');
  const [order,setOrder] = useState<Answer[]>([]);
  const [now,setNow] = useState(Date.now());
  const [copied,setCopied] = useState(false);
  const request = useRef(0);
  const rulesRef = useRef<HTMLElement>(null);
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const me = room?.players.find(p=>p.id===room.me);
  const host = room?.host === room?.me;

  useEffect(() => { const id=setInterval(()=>setNow(Date.now()),500); return ()=>clearInterval(id); },[]);
  useEffect(()=>{
    if(!showRules)return;
    const previous=document.activeElement as HTMLElement|null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){setShowRules(false);return;}
      if(e.key!=='Tab')return;
      const buttons=rulesRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if(!buttons?.length)return;
      const first=buttons[0],last=buttons[buttons.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=previousOverflow;previous?.focus();};
  },[showRules]);
  useEffect(() => {
    if (!roomCode || demo || !configured) return;
    let active=true, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const id=++request.current;
      try { const data=await callGame('sync',roomCode); if(active && id===request.current) {setRoom(data);setError('');} }
      catch(e) {if(active && id===request.current)setError(e instanceof Error ? e.message : 'Connection interrupted. Retrying…');}
      if(active)timer=setTimeout(poll,2500);
    }
    void poll();
    return ()=>{active=false;clearTimeout(timer);};
  },[roomCode,demo]);
  const roundKey = room ? `${room.code}:${room.round}:${room.prompt}` : '';
  useEffect(()=>{setAnswer('');},[roundKey]);
  const ballotKey = room?.phase === 'voting' ? `${roundKey}:${room.answers.map(a=>a.id).sort().join(',')}` : '';
  useEffect(()=>{if(room?.phase==='voting')setOrder(shuffle(room.answers.filter(a=>!a.mine)));},[ballotKey]); // Freeze order while other players submit.

  async function act(action:string,payload:Record<string,unknown>={}) {
    setBusy(true);setError('');
    const id=++request.current;
    try {
      const data=await callGame(action,action==='create'?'':action==='join'?joinCode:roomCode,{...payload,prompt:room?.prompt});
      if(id===request.current)setRoom(data);
      if(action==='create'||action==='join'){setRoom(data);setRoomCode(data.code);localStorage.setItem('hot-room',data.code);localStorage.setItem('hot-name',name);}
    }catch(e){setError(e instanceof Error?e.message:'Something went wrong. Try again.');}
    finally{setBusy(false);}
  }
  function leave(){request.current++;setRoom(null);setRoomCode('');setDemo(false);setError('');localStorage.removeItem('hot-room');}
  function startDemo(){
    leave();setDemo(true);
    setRoom({code:'PRACTICE',phase:'lobby',host:'0',me:'0',round:0,prompt:'',deadline:null,answers:[],players:demoNames.map((n,i)=>({id:String(i),name:i===0?(name.trim()||n):n,online:true,answered:false,voted:false,total:0}))});
  }
  function nextDemo(){setRoom(r=>r?{...r,phase:'answering',round:r.round+1,prompt:prompts[r.round%prompts.length],deadline:new Date(Date.now()+60000).toISOString(),note:undefined,answers:[],players:r.players.map(p=>({...p,answered:p.id!=='0',voted:false}))}:r);}
  function submitDemoAnswer(text:string){setRoom(r=>r?{...r,phase:'voting',deadline:null,answers:[...(text?[{id:'a0',text,mine:true}]:[]),...sampleAnswers.map((text,i)=>({id:`a${i+1}`,text,mine:false}))],players:r.players.map(p=>({...p,answered:p.id!=='0'||Boolean(text)}))}:r);}
  useEffect(()=>{if(demo&&room?.phase==='answering'&&room.deadline&&now>=Date.parse(room.deadline))submitDemoAnswer('');},[demo,room?.phase,room?.deadline,now]);
  function submitDemoVote(){
    if(!room)return;
    const ballots=[order.map(a=>a.id),...room.players.slice(1).map(p=>shuffle(room.answers.filter(a=>a.id!==`a${p.id}`).map(a=>a.id)))];
    const scores=scoreAnswers(room.answers.map(a=>a.id),ballots);
    const answers=scores.map(s=>({...room.answers.find(a=>a.id===s.id)!,...s,author:room.players[Number(s.id.slice(1))].name}));
    setRoom({...room,phase:room.round===5?'finished':'results',answers,players:room.players.map(p=>({...p,voted:true,total:(Math.round(p.total*840)+Math.round((answers.find(a=>a.id===`a${p.id}`)?.points||0)*840))/840}))});
  }
  const move=(from:number,to:number)=>setOrder(items=>arrayMove(items,from,to));
  function dragEnd(e:DragEndEvent){if(e.over&&e.active.id!==e.over.id)move(order.findIndex(a=>a.id===e.active.id),order.findIndex(a=>a.id===e.over!.id));}
  async function copyCode(){try{await navigator.clipboard.writeText(room!.code);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Copy unavailable. You can select and copy the room code.');}}
  const waiting = room?.players.filter(p=>room.phase==='answering'?!p.answered:!p.voted)||[];
  const seconds = Math.max(0,Math.ceil(((room?.deadline?Date.parse(room.deadline):now)-now)/1000));
  const enoughPlayers = (room?.players.filter(p=>p.online).length||0)>=4;
  const winners = room ? room.players.filter(p=>p.total===Math.max(...room.players.map(p=>p.total))) : [];

  return <div className="app-shell">
    <header className="site-header"><button className="wordmark" onClick={()=>{if(!room)setShowRules(false);}} aria-label="Hot Takes home"><span className="brand-flame"><Flame size={24} fill="currentColor"/></span>hot takes<span className="wordmark-dot">®</span></button><div className="header-right"><span className="header-tag">GOOD FRIENDS. QUESTIONABLE OPINIONS.</span><button className="how-button" onClick={()=>setShowRules(true)}><HelpCircle size={16}/> How to play</button></div></header>
    {error&&<div role="alert" className="error-banner">{error}<button className="icon-button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    {!room ? <main className="landing">
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span/> THE PARTY GAME THAT TURNS UP THE HEAT</div><h1>Your opinions.<br/>Their judgment.<br/><span>Zero chill.</span><svg viewBox="0 0 390 22" aria-hidden="true"><path d="M4 12Q135 -2 380 10M24 21Q190 4 359 16"/></svg></h1><p className="hero-description">Bring your friends. Drop your hottest takes.<br/>Be controversial enough to win.<br/>Just don’t get burned.</p><div className="hero-details"><span><Users size={17}/> 4–8 players</span><span><Timer size={17}/> 5 rounds</span><span><Link size={17}/> One link. Everyone’s in.</span></div></div><MiniGame/></section>
      <section className="play-section" aria-label="Start playing"><div className="play-intro"><span className="section-kicker">THE GROUP CHAT HAS ENTERED THE ROOM</span><h2>Got a take?<br/> Let’s hear it.</h2><p>No downloads. No accounts.<br/> Just a room full of strong opinions.</p></div><form className="join-card" onSubmit={e=>{e.preventDefault();void act(mode,{name:name.trim(),code:joinCode.trim().toUpperCase()});}}><div className="form-tabs"><button type="button" className={mode==='create'?'active':''} onClick={()=>setMode('create')}><Flame size={16}/> Host a game</button><button type="button" className={mode==='join'?'active':''} onClick={()=>setMode('join')}><Users size={16}/> Join a room</button></div><label htmlFor="nickname">WHAT SHOULD WE CALL YOU?</label><input id="nickname" autoComplete="nickname" maxLength={20} required value={name} onChange={e=>setName(e.target.value)} placeholder="Your nickname"/>{mode==='join'&&<><label htmlFor="room-code">ROOM CODE</label><input id="room-code" autoCapitalize="characters" maxLength={6} minLength={6} required value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="e.g. SPICYX"/></>}<button className="primary-button" disabled={busy||!name.trim()}>{busy?<LoaderCircle className="spin" size={19}/>:<>{mode==='create'?'Turn up the heat':'Enter the room'} <ArrowRight size={19}/></>}</button><p className="form-footnote">{configured?'Private room. Publicly questionable opinions.':'Online rooms need setup. Try practice mode below.'}</p></form></section>
      <section className="how-strip" aria-label="How it works"><div><span className="step-number">01</span><h3>Make your case.</h3><p>One prompt. One minute.<br/> Give us your unfiltered opinion.</p></div><div><span className="step-number">02</span><h3>Judge your friends.</h3><p>Rank anonymous answers<br/> from hottest to coldest.</p></div><div><span className="step-number">03</span><h3>Find the sweet spot.</h3><p>Second hottest scores big.<br/> The hottest? Zero. Too hot.</p></div></section>
      <div className="practice-line"><span>Want a taste before inviting the group?</span><button onClick={startDemo}>Try a practice game <ArrowRight size={15}/></button></div>
    </main> : <main className="room-layout"><div className="room-heading"><button className="text-button" onClick={leave}><LogOut size={15}/> Leave {demo?'practice':'room'}</button><span className="live-label"><Radio size={15}/>{demo?'PRACTICE · SIMULATED PLAYERS':'ONLINE ROOM'}</span><button className="code-button" onClick={()=>void copyCode()}>{room.code} {copied?<Check size={15}/>:<Copy size={15}/>}</button></div>
      <div className="room-grid"><section className="game-panel"><div className="panel-kicker"><span>{room.phase==='lobby'?'GET THE GANG TOGETHER':`ROUND ${room.round} OF 5`}</span>{room.phase==='answering'&&<span className={`timer ${seconds<15?'urgent':''}`}><Timer size={16}/>{seconds}s</span>}</div>
        {room.note&&<div className="notice">{room.note}</div>}
        {room.phase==='lobby'&&<><div className="big-icon"><Flame size={44}/></div><h2>The room is<br/><em>heating up.</em></h2><p className="panel-description">Send your friends the room code.<br/>You need 4–8 opinionated people to play.</p><div className="lobby-code">{room.code}</div><p className="muted">{room.players.length} / 8 players · {enoughPlayers?'Ready when you are.':`${Math.max(0,4-room.players.filter(p=>p.online).length)} more online to start.`}</p>{host?<button className="primary-button" disabled={!enoughPlayers||busy} onClick={()=>demo?nextDemo():void act('start')}>Start the game <ArrowRight size={18}/></button>:<p className="waiting-message"><LoaderCircle size={16} className="spin"/> Waiting for the host to start</p>}</>}
        {room.phase==='answering'&&<><h2 className="prompt-heading">{room.prompt}</h2><p className="panel-description">Make it controversial. Make it yours.</p>{me?.answered?<div className="locked-state"><CheckCheck size={36}/><h3>Your take is locked in.</h3><p>Now let’s see who can handle the heat.</p></div>:<form onSubmit={e=>{e.preventDefault();demo?submitDemoAnswer(answer.trim()):void act('answer',{text:answer.trim()});}}><label htmlFor="answer">YOUR HOT TAKE</label><textarea id="answer" placeholder="Okay, hear me out…" maxLength={140} required value={answer} onChange={e=>setAnswer(e.target.value)} disabled={seconds===0}/><div className="answer-footer"><span>{answer.length} / 140</span><span>Anonymous until the reveal</span></div><button className="primary-button" disabled={busy||!answer.trim()||seconds===0}>Lock in my take <Flame size={18}/></button></form>}<p className="waiting-message">{seconds===0?'Time’s up. Gathering the takes…':`${room.players.filter(p=>p.answered).length} of ${room.players.length} takes submitted`}</p></>}
        {room.phase==='voting'&&<><h2>Who brought<br/><em>the heat?</em></h2><p className="voting-prompt">“{room.prompt}”</p>{me?.voted?<div className="locked-state"><CheckCheck size={36}/><h3>Your ranking is locked.</h3><p>Waiting for {waiting.map(p=>p.name).join(', ') || 'the results'}.</p><small>No timer. Everyone gets a vote.</small></div>:<><p className="panel-description">Drag to rank the most controversial take first.<br/>Your own answer sits this one out.</p><div className="heat-label hot"><Flame size={15}/> HOTTEST <span>Too hot = 0 points</span></div><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={order.map(a=>a.id)} strategy={verticalListSortingStrategy}><div className="rank-list">{order.map((a,i)=><RankCard key={a.id} answer={a} index={i} move={move} total={order.length}/>)}</div></SortableContext></DndContext><div className="heat-label cold"><span>COLDEST</span><small>Less controversial</small></div><button className="primary-button" disabled={busy||order.length<2} onClick={()=>demo?submitDemoVote():void act('vote',{ids:order.map(a=>a.id)})}>Submit my ranking <Check size={18}/></button><p className="form-footnote">Take your time. Your ranking locks when submitted.</p></>}</>}
        {(room.phase==='results'||room.phase==='finished')&&<><div className="results-title"><Trophy size={32}/><span>{room.phase==='finished'?'THAT’S A WRAP':'THE ROOM HAS SPOKEN'}</span></div><h2>{room.phase==='finished'?<>{winners.map(p=>p.name).join(' & ')}<br/><em>{winners.length===1?'takes the crown.':'share the crown.'}</em></>:<>A little spicy.<br/><em>A little personal.</em></>}</h2><p className="voting-prompt">“{room.prompt}”</p><div className="result-list">{room.answers.map((a,i)=><div key={a.id} className={`result-card ${a.points===0?'burned':''}`}><span className="rank-number">{i+1}</span><div><strong>{a.text}</strong><small>{a.author}{a.mine?' · you':''} · {Math.round(a.heat||0)} heat</small></div><b>+{formatPoints(a.points||0)}<small>PTS</small></b></div>)}</div>{room.phase==='finished'?<button className="primary-button" onClick={leave}>Back to the start <ArrowRight size={18}/></button>:host?<><button className="primary-button" disabled={busy||!enoughPlayers} onClick={()=>demo?nextDemo():void act('next')}>Next round <ArrowRight size={18}/></button>{!enoughPlayers&&<p className="form-footnote">Waiting for at least four players to reconnect.</p>}</>:<p className="waiting-message">Waiting for the host to start the next round.</p>}</>}
      </section><aside className="players-panel"><div className="players-heading"><h3>The hot seat</h3><span>{room.players.length} / 8</span></div>{room.players.map((p,i)=><div className="player-row" key={p.id}><span className={`player-avatar color-${i%4}`}>{p.name.slice(0,1).toUpperCase()}<i className={p.online?'online':'offline'}/></span><div><strong>{p.name} {p.id===room.me&&<small>(you)</small>}</strong><small>{p.id===room.host?'Host':p.online?'In the room':'Disconnected'}{(room.phase==='answering'&&p.answered)||(room.phase==='voting'&&p.voted)?' · submitted':''}</small></div>{p.id===room.host&&<Crown className="crown" size={15}/>}<b>{formatPoints(p.total)}<small>PTS</small></b></div>)}<div className="sidebar-tip"><Flame size={21}/><strong>Hot is good.<br/>Too hot is not.</strong><p>The most controversial take gets zero. Aim for second hottest.</p></div>{demo&&<p className="demo-notice">Practice only. Other players and their votes are simulated. Nothing is sent online.</p>}</aside></div>
    </main>}
    <footer><span><Flame size={15}/> MADE FOR FRIENDLY DISAGREEMENTS.</span><span>Keep it spicy. Keep it kind.</span></footer>
    {showRules&&<div className="modal-backdrop" onClick={()=>setShowRules(false)}><section ref={rulesRef} className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={e=>e.stopPropagation()}><button autoFocus className="icon-button close-modal" aria-label="Close rules" onClick={()=>setShowRules(false)} onKeyDown={e=>{if(e.key==='Escape')setShowRules(false);}}><X/></button><span className="eyebrow">A CRASH COURSE IN CONTROVERSY</span><h2 id="rules-title">How to play.</h2><ol><li><strong>Gather 4–8 friends.</strong> The host shares a room code and starts the game.</li><li><strong>Drop a take.</strong> You have 60 seconds to answer the prompt. Submit once; no take-backs.</li><li><strong>Rank the heat.</strong> Order everyone else’s anonymous answers from most to least controversial. No voting timer.</li><li><strong>Find your sweet spot.</strong> With six answers: 0, 5, 4, 3, 2, 1 points, hottest to coldest. Ties average the points of their places.</li><li><strong>Five rounds. One bragging right.</strong> Highest total wins. Tied leaders share the crown.</li></ol><p className="notice">Missing an answer means zero points, but you can still vote. Voting waits for everyone—even disconnected players. Keep your friends close, and their connections closer.</p><button className="primary-button" onClick={()=>setShowRules(false)}>Got it. Let’s get spicy. <Flame size={18}/></button></section></div>}
  </div>;
}
