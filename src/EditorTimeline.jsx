import React,{useMemo,useRef,useState} from 'react';
import {clipEnd,clipLength,TRACKS} from './editorCore.js';
const CLOCK=n=>{const m=Math.floor(n/60),s=Math.floor(n%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')};
export default function EditorTimeline({tracks=TRACKS,clips,assets,time,zoom,setZoom,onSeek,onSelect,selectedId,onPlace,onMove,onTrim,onTrimStart,onTransition,onRemove,onAddTrack,trackMuted,onToggleTrackMute}){
 const [dragHint,setDragHint]=useState(''),trimRef=useRef(null),scroller=useRef(null),rulerRef=useRef(null);
 const total=Math.max(30,...clips.map(c=>clipEnd(c)+5));
 const width=Math.max(1100,total*zoom+300);
 const tick=Math.max(1,Math.round(100/zoom));
 const marks=useMemo(()=>Array.from({length:Math.ceil(total/tick)+1},(_,i)=>i*tick),[total,tick]);
 const laneTime=(e,element)=>Math.max(0,(e.clientX-element.getBoundingClientRect().left)/zoom);
 const drop=(e,track)=>{
  e.preventDefault();setDragHint('');
  if(e.dataTransfer.files?.length){return}
  const asset=e.dataTransfer.getData('application/x-acs-asset');
  const clip=e.dataTransfer.getData('application/x-acs-clip');
  const transition=e.dataTransfer.getData('application/x-acs-transition');
  const seconds=laneTime(e,e.currentTarget);
  if(asset)onPlace(asset,track.id,seconds);
  else if(clip){const offset=Number(e.dataTransfer.getData('application/x-acs-offset'))||0;onMove(clip,track.id,seconds-offset)}
  else if(transition){const target=clips.filter(c=>c.trackId===track.id).sort((a,b)=>Math.abs(a.start-seconds)-Math.abs(b.start-seconds))[0];if(target)onTransition(target.id,transition,.7)}
 };
 function beginTrim(e,clip,side){e.preventDefault();e.stopPropagation();onSelect(clip.id);onTrimStart?.();trimRef.current={id:clip.id,side,x:e.clientX,original:clip};e.currentTarget.setPointerCapture(e.pointerId)}
 function updateTrim(e){if(!trimRef.current)return;const r=trimRef.current;onTrim(r.id,r.side,(e.clientX-r.x)/zoom,r.original)}
 function endTrim(e){trimRef.current=null;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}}
 function seekFrom(e){const rect=rulerRef.current?.getBoundingClientRect();if(!rect)return;onSeek(Math.max(0,(e.clientX-rect.left)/zoom))}
 return <div className="ve-timeline">
  <header className="ve-timeline-tools">
   <div className="ve-timeline-heading"><strong>Timeline</strong><span>{tracks.length} tracks</span></div>
   <button onClick={()=>onAddTrack('video')} title="Create video track">+ Video track</button>
   <button onClick={()=>onAddTrack('audio')} title="Create audio track">+ Audio track</button>
   <div className="ve-timeline-spacer"/>
   <button title="Zoom out" onClick={()=>setZoom(z=>Math.max(14,z-12))}>−</button>
   <input title="Timeline zoom" aria-label="Timeline zoom" type="range" min="14" max="160" step="2" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/>
   <button title="Zoom in" onClick={()=>setZoom(z=>Math.min(160,z+12))}>+</button>
   <button title="Fit timeline" onClick={()=>{const viewport=scroller.current?.clientWidth||1000;setZoom(Math.max(14,Math.min(120,(viewport-180)/Math.max(10,total))))}}>Fit</button>
  </header>
  <div className="ve-timeline-scroll" ref={scroller}>
   <div className="ve-timeline-body" style={{width:width+116}}>
    <div className="ve-ruler-row"><div className="ve-ruler-label">TIME</div>
     <div className="ve-ruler" ref={rulerRef} style={{width}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seekFrom(e)}} onPointerMove={e=>{if(e.buttons===1)seekFrom(e)}}>
      {marks.map(n=><span className="ve-ruler-mark" style={{left:n*zoom}} key={n}>{CLOCK(n)}</span>)}
     </div>
    </div>
    <div className="ve-track-stack" style={{position:'relative'}}>
    {tracks.map(track=><div key={track.id} className={'ve-track-row '+(dragHint===track.id?'ve-drop-over':'')}>
      <div className="ve-track-label"><span className="ve-track-kind">{track.kind==='audio'?'♫':track.kind==='text'?'T':'▣'}</span><div><strong>{track.label}</strong><small>{track.id}</small></div><button className={trackMuted[track.id]?'ve-muted':''} onClick={()=>onToggleTrackMute(track.id)} title={trackMuted[track.id]?'Unmute track':'Mute track'}>{trackMuted[track.id]?'M×':'M'}</button></div>
      <div className="ve-track-content" style={{width}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';setDragHint(track.id)}} onDragLeave={()=>setDragHint('')} onDrop={e=>drop(e,track)}
       onDoubleClick={e=>{if(e.target===e.currentTarget)onSeek(laneTime(e,e.currentTarget))}}>
       {clips.filter(c=>c.trackId===track.id).map(clip=>{
        const asset=assets.find(a=>a.id===clip.assetId),left=clip.start*zoom,span=Math.max(28,clipLength(clip)*zoom);
        const chosen=clip.id===selectedId;
        return <div key={clip.id} className={'ve-clip '+(chosen?'ve-clip-selected ':'')+'ve-'+track.kind} style={{left,width:span,zIndex:chosen?10:Math.round(clip.start)+1}}
         draggable
         onDragStart={e=>{e.dataTransfer.setData('application/x-acs-clip',clip.id);e.dataTransfer.setData('application/x-acs-offset',String((e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom));e.dataTransfer.effectAllowed='move';onSelect(clip.id)}}
         onDragOver={e=>e.preventDefault()}
         onDrop={e=>{const tr=e.dataTransfer.getData('application/x-acs-transition');if(tr){e.preventDefault();e.stopPropagation();onTransition(clip.id,tr,.7)}}}
         onClick={e=>{e.stopPropagation();onSelect(clip.id);}}>
         <span className="ve-trim-handle ve-trim-start" draggable={false} title="Drag to trim start" onPointerDown={e=>beginTrim(e,clip,'start')} onPointerMove={updateTrim} onPointerUp={endTrim} onPointerCancel={endTrim}/>
         <div className="ve-clip-content"><strong>{clip.kind==='text'?clip.text:(asset?.name||'Media unavailable')}</strong><small>{CLOCK(clipLength(clip))}{clip.transitionIn!=='none'?' • '+clip.transitionIn:''}</small></div>
         <span className="ve-trim-handle ve-trim-end" draggable={false} title="Drag to trim end" onPointerDown={e=>beginTrim(e,clip,'end')} onPointerMove={updateTrim} onPointerUp={endTrim} onPointerCancel={endTrim}/>
        </div>;
       })}
      </div>
     </div>)}
     <div className="ve-playhead" style={{left:116+time*zoom}}><span className="ve-playhead-head"/></div>
    </div>
   </div>
  </div>
  <footer className="ve-timeline-footer"><span>Drag media onto any compatible track. Drag clips to move; drag edges to trim. Double-click empty space to seek.</span><span>{CLOCK(time)} / {CLOCK(total)}</span></footer>
 </div>;
}
