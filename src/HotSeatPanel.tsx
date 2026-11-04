import { useState } from 'react';
import { Flame, Timer } from 'lucide-react';
import { Badge } from './Badge';
import { formatPoints, type Snapshot } from './game';
import './hotseat.css';

export function HotSeatPanel({room,busy,demo,now,onAction}:{room:Snapshot;busy:boolean;demo:boolean;now:number;onAction:(action:string,candidate?:string)=>void}) {
  const [choice,setChoice]=useState('');const h=room.hotseat!;
  const speaker=h.contestants.find(c=>c.id===h.order[h.index]);
  const isHost=room.me===room.host,isJudge=h.judges.includes(room.me),submitted=h.submitted.includes(room.me);
  const seconds=room.deadline?Math.max(0,Math.ceil((Date.parse(room.deadline)-now)/1000)):60;
  return <section className="hotseat-panel" aria-label="Hot Seat">
    <div className="results-title"><Flame size={32}/><span>HOT SEAT</span></div>
    <p className="voting-prompt">“{room.prompt}”</p>
    {room.phase==='hotseat_ready'&&<>
      <h2>{h.index===0?'Too close to call':'Next in the Hot Seat.'}</h2>
      <p className="panel-description">{h.index===0?`${h.contestants.length} takes tied for hottest. Each player gets one minute to defend their take.`:'Take a breath. Your next defense starts when the host is ready.'}</p>
      <div className="notice">{formatPoints(h.pool)} points at stake. Each player who is not tied for the hottest will vote on who defended their take the best. Whoever gets the least votes gets 0 points.</div>
      {h.index===0&&<ul className="hotseat-candidates" aria-label="Tied hottest takes">{h.contestants.map(c=><li key={c.id}><span className="named-badge"><Badge id={c.badge} size={32}/><strong>{c.name}</strong></span><p>“{c.text}”</p></li>)}</ul>}
      {speaker&&<div className="speaker-card"><Badge id={speaker.badge} size={72}/><h3>{speaker.name} is up next</h3><p>“{speaker.text}”</p></div>}
      {isHost?<button className="primary-button" disabled={busy} onClick={()=>onAction('hotseat_start')}>{h.index===0?'Start Hot Seat':'Start next speaker'} <Flame size={18}/></button>:<p className="waiting-message">Waiting for the host to start the next turn.</p>}
    </>}
    {room.phase==='hotseat_speaking'&&speaker&&<>
      <div className="speaker-card"><Badge id={speaker.badge} size={96}/><h2>{speaker.name} is in the <em>Hot Seat.</em></h2><h3>Explain your case!</h3><p>“{speaker.text}”</p></div>
      <div className={`speech-clock ${seconds<15?'urgent':''}`} role="timer" aria-label="Speaking time remaining"><Timer size={25}/>{seconds}s</div>
      <p className="panel-description">Speak to the room, in person. Nothing is recorded.</p>
      {seconds===0?<p role="status">Time's up. Moving to the next turn…</p>:speaker.player===room.me?<button className="primary-button" disabled={busy} onClick={()=>onAction('hotseat_done')}>I'm done</button>:demo?<button className="text-button" onClick={()=>onAction('hotseat_done')}>Practice: finish simulated speech</button>:<p className="waiting-message">Listen to their defense. You'll vote after everyone has spoken.</p>}
    </>}
    {room.phase==='hotseat_voting'&&<>
      <h2>Who made the <em>best case?</em></h2>
      {!isJudge?<p className="panel-description">You're a Hot Seat contestant. The outside judges are deciding.</p>:submitted?<div className="locked-state"><h3>Your explanation vote is locked.</h3></div>:<form onSubmit={e=>{e.preventDefault();onAction('hotseat_vote',choice);}}>
        <fieldset className="defense-options"><legend>Choose the best defense</legend>{h.contestants.map(c=><label key={c.id} className={choice===c.id?'selected':''}><input type="radio" name="defense" value={c.id} checked={choice===c.id} onChange={()=>setChoice(c.id)} disabled={busy}/><Badge id={c.badge} size={42}/><span><strong>{c.name}</strong><small>“{c.text}”</small></span></label>)}</fieldset>
        <button className="primary-button" disabled={busy||!choice}>Submit explanation vote</button>
      </form>}
      <p className="waiting-message">{h.submitted.length} of {h.judges.length} judges voted. No timer.</p>
      <p className="form-footnote">Waiting for {h.judges.filter(id=>!h.submitted.includes(id)).map((id,i)=>{const p=room.players.find(p=>p.id===id)!;return <span key={id}>{i>0?', ':''}<span className="named-badge"><Badge id={p.badge} size={24}/>{p.name}</span></span>;})}.</p>
    </>}
    <ol className="speaker-order" aria-label="Speaking order">{h.order.map((id,i)=>{const c=h.contestants.find(c=>c.id===id)!;return <li key={id} aria-current={i===h.index?'step':undefined}><Badge id={c.badge} size={26}/><span>{i+1}. {c.name}</span>{i<h.index&&<small>Spoken</small>}</li>;})}</ol>
    {demo&&<p className="demo-notice">Practice: other players' speeches and judge votes are simulated.</p>}
  </section>;
}
