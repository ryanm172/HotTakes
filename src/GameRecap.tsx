import { Crown, Flame, Trophy } from 'lucide-react';
import { formatPoints, standings, type Snapshot } from './game';
import './recap.css';
import { Badge } from './Badge';

export function GameRecap({room}:{room:Snapshot}) {
  const board=standings(room.players);
  const winners=board.filter(p=>p.rank===1);
  return <section className="game-panel game-recap" aria-label="Game recap">
    <div className="results-title"><Trophy size={36}/><span>THAT’S A WRAP</span></div>
    <h2 aria-label={`${winners.map(p=>p.name).join(' & ')} ${winners.length===1?'takes the crown.':'share the crown.'}`}>{winners.map((p,i)=><span key={p.id} className="winner-name">{i>0?' & ':''}<Badge id={p.badge} size={42}/> {p.name}</span>)}<br/><em>{winners.length===1?'takes the crown.':'share the crown.'}</em></h2>
    <p className="panel-description">Five rounds. A room full of opinions. Your final standings.</p>
    <section className="recap-scoreboard" aria-labelledby="scoreboard-title">
      <h3 id="scoreboard-title">Final scoreboard</h3>
      <table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Total points</th></tr></thead>
        <tbody>{board.map(p=><tr key={p.id} className={p.rank===1?'scoreboard-winner':''}>
          <td>{p.rank}</td><th scope="row"><Badge id={p.badge} size={30}/> {p.rank===1&&<Crown size={17} aria-label="Winner"/>} {p.name}{p.id===room.me&&<small> (you)</small>}</th><td>{formatPoints(p.total)}</td>
        </tr>)}</tbody>
      </table>
    </section>
    <section className="recap-highlights" aria-labelledby="highlights-title">
      <h3 id="highlights-title"><Flame size={23}/> The hottest takes</h3>
      {room.history.map(round=><article key={round.round} className="recap-round" aria-label={`Round ${round.round} highlights`}>
        <span className="section-kicker">ROUND {round.round}</span><h4>{round.prompt}</h4>
        {round.takes.map(take=><blockquote key={take.id}><p>“{take.text}”</p><footer><span className="named-badge"><Badge id={take.badge} size={26}/>{take.author}</span></footer></blockquote>)}
      </article>)}
    </section>
  </section>;
}
