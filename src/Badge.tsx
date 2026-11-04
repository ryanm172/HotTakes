import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { badges, validBadge, type BadgeId } from './badges';
import './badges.css';

export function Badge({id,size=32}:{id?:string;size?:number}) {
  const index=badges.findIndex(b=>b.id===validBadge(id));
  return <span className="mascot-badge" role="img" aria-label={badges[index].name}
    style={{width:size,height:size,backgroundPosition:`${index%4*100/3}% ${index<4?0:100}%`}}/>;
}

export function BadgePicker({selected,busy,error,onSelect,onClose}:{selected:BadgeId;busy:boolean;error:string;onSelect:(id:BadgeId)=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const opener=useRef(document.activeElement as HTMLElement|null);
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const element=dialog.current;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';element?.showModal();
    return()=>{element?.close();document.body.style.overflow=oldOverflow;queueMicrotask(()=>{if(opener.current?.isConnected)opener.current.focus();});};
  },[]);
  return <dialog ref={dialog} className="badge-picker" aria-labelledby="badge-title" onCancel={e=>{e.preventDefault();if(!busy)close.current();}}
    onClick={e=>{if(e.target===dialog.current&&!busy)onClose();}}>
    <div className="badge-picker-content"><button type="button" className="icon-button close-modal" aria-label="Close icon picker" disabled={busy} onClick={onClose}><X/></button>
      <span className="eyebrow">PICK YOUR PERSONALITY</span><h2 id="badge-title">Who's bringing the heat?</h2>
      <p>Choose your icon. Yours until the final take.</p>
      <div className="badge-options" aria-label="Player icons">{badges.map(b=><button key={b.id} type="button" className="badge-option" aria-label={b.name} aria-pressed={selected===b.id} disabled={busy} onClick={()=>onSelect(b.id)}>
        <Badge id={b.id} size={72}/><span>{b.name}</span>
      </button>)}</div>
      {busy&&<p role="status">Saving your icon…</p>}{error&&<p role="alert" className="badge-error">{error}</p>}
      <p className="badge-picker-note">Everyone can pick their favorite. Icons lock when the game starts.</p>
    </div>
  </dialog>;
}
