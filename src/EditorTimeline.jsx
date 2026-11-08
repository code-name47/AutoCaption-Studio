import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {clipEnd,clipLength,TRACKS} from './editorCore.js';
import {overlaps} from './editorMotion.js';
const CLOCK=n=>{const m=Math.floor(n/60),s=Math.floor(n%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')};
export default function EditorTimeline({
 tracks=TRACKS,clips,assets,time,zoom,setZoom,onSeek,onSelect,selectedId,onPlace,onMove,onTrim,onTrimStart,
 onTransition,onRemove,onAddTrack,onRemoveTrack,onSplit,onDuplicate,onAddTitle,onPatch,onDetachAudio,onSplitStereo,onRippleDelete,
 trackMuted,trackSolo={},onToggleTrackMute,onToggleTrackSolo,recordingTrackId,onToggleRecord,onOpenInspector,
 panelHeight=335,expanded=false,onToggleExpanded
}){
 const [dragHint,setDragHint]=useState(''),[menu,setMenu]=useState(null);
 const [labelWidth,setLabelWidth]=useState(()=>{
  try{return Math.max(96,Math.min(440,Number(window.localStorage.getItem('acs_track_label_width'))||116))}catch{return 116}
 });
 const resizeRef=useRef(null);
 useEffect(()=>{try{window.localStorage.setItem('acs_track_label_width',String(labelWidth))}catch{}},[labelWidth]);
 function beginLabelResize(e){if(e.button!==0)return;e.preventDefault();e.stopPropagation();
  resizeRef.current={startX:e.clientX,width:labelWidth};e.currentTarget.setPointerCapture(e.pointerId);
 }
 function moveLabelResize(e){if(!resizeRef.current)return;
  setLabelWidth(Math.max(96,Math.min(440,resizeRef.current.width+e.clientX-resizeRef.current.startX)));
 }
 function endLabelResize(e){resizeRef.current=null;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 }
 const trimRef=useRef(null),scrubRef=useRef(null),scroller=useRef(null),rulerRef=useRef(null);
 const transitions=useMemo(()=>overlaps(clips),[clips]);
 const total=Math.max(30,...clips.map(c=>clipEnd(c)+5));
 const width=Math.max(1100,total*zoom+300);
 const tick=Math.max(1,Math.round(100/zoom));
 const marks=useMemo(()=>Array.from({length:Math.ceil(total/tick)+1},(_,i)=>i*tick),[total,tick]);
 useEffect(()=>{
  if(!menu)return;
  const close=()=>setMenu(null),escape=e=>{if(e.key==='Escape')close()};
  document.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape)};
 },[menu]);
 function showContext(e,trackId,clipId=null,overlapId=null){
  e.preventDefault();e.stopPropagation();
  setMenu({x:Math.max(8,Math.min(window.innerWidth-230,e.clientX)),y:Math.max(8,Math.min(window.innerHeight-350,e.clientY)),trackId,clipId,overlapId});
  if(clipId)onSelect(clipId);
 }
 const laneTime=(e,element)=>Math.max(0,(e.clientX-element.getBoundingClientRect().left)/zoom);
 const drop=(e,track)=>{
  e.preventDefault();setDragHint('');
  if(e.dataTransfer.files?.length)return;
  const asset=e.dataTransfer.getData('application/x-acs-asset');
  const clip=e.dataTransfer.getData('application/x-acs-clip');
  const transition=e.dataTransfer.getData('application/x-acs-transition');
  const seconds=laneTime(e,e.currentTarget);
  if(asset)onPlace(asset,track.id,seconds);
  else if(clip){const offset=Number(e.dataTransfer.getData('application/x-acs-offset'))||0;onMove(clip,track.id,seconds-offset)}
  else if(transition){const target=clips.filter(c=>c.kind!=='motion'&&c.trackId===track.id).sort((a,b)=>Math.abs(a.start-seconds)-Math.abs(b.start-seconds))[0];if(target)onTransition(target.id,transition,.7)}
 };
 function beginTrim(e,clip,side){e.preventDefault();e.stopPropagation();onSelect(clip.id);onTrimStart?.();trimRef.current={id:clip.id,side,x:e.clientX,original:clip};e.currentTarget.setPointerCapture(e.pointerId)}
 function updateTrim(e){if(!trimRef.current)return;const r=trimRef.current;onTrim(r.id,r.side,(e.clientX-r.x)/zoom,r.original)}
 function endTrim(e){trimRef.current=null;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}}
 function seekFrom(e){const rect=rulerRef.current?.getBoundingClientRect();if(!rect)return;onSeek(Math.max(0,(e.clientX-rect.left)/zoom))}
 function startScrubbing(e){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  scrubRef.current=e.pointerId;
  e.currentTarget.setPointerCapture(e.pointerId);
  seekFrom(e);
 }
 function moveScrubbing(e){
  if(scrubRef.current!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();seekFrom(e);
 }
 function stopScrubbing(e){
  if(scrubRef.current!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  scrubRef.current=null;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 }

 const action=(fn)=>()=>{setMenu(null);fn()};
 const menuButton=(name,fn)=> <button role="menuitem" key={name} onClick={action(fn)}>{name}</button>;
 return <div className={"ve-timeline"+(expanded?" ve-expanded":"")} style={{'--ve-timeline-height':panelHeight+'px','--ve-track-label-width':labelWidth+'px'}}>
  <header className="ve-timeline-tools">
   <div className="ve-timeline-heading"><strong>Timeline</strong><span>{tracks.length} tracks</span></div>
   <button onClick={()=>onAddTrack('video')} title="Create video track">+ Video track</button>
   <button onClick={()=>onAddTrack('audio')} title="Create audio track">+ Audio track</button>
   <div className="ve-timeline-spacer"/>
   <button title="Zoom out" onClick={()=>setZoom(z=>Math.max(14,z-12))}>−</button>
   <input title="Timeline zoom" aria-label="Timeline zoom" type="range" min="14" max="160" step="2" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/>
   <button title="Zoom in" onClick={()=>setZoom(z=>Math.min(160,z+12))}>+</button>
   <button title={expanded?"Reduce timeline height":"Expand timeline height"} onClick={onToggleExpanded}>{expanded?"▤":"▣"}</button><button title="Fit timeline" onClick={()=>{const viewport=scroller.current?.clientWidth||1000;setZoom(Math.max(14,Math.min(120,(viewport-180)/Math.max(10,total))))}}>Fit</button>
  </header>
  <div className="ve-timeline-scroll" ref={scroller}>
   <div className="ve-timeline-body" style={{width:width+labelWidth}}>
    <div className="ve-ruler-row"><div className="ve-ruler-label">TIME
     <div className="ve-track-label-resizer" role="separator" aria-label="Resize timeline track-name column" title="Drag left or right to resize track names; double-click to reset" tabIndex={0}
      aria-valuenow={labelWidth} aria-valuemin={96} aria-valuemax={440}
      onPointerDown={beginLabelResize} onPointerMove={moveLabelResize} onPointerUp={endLabelResize} onPointerCancel={endLabelResize}
      onDoubleClick={e=>{e.stopPropagation();setLabelWidth(116)}} onKeyDown={e=>{
       if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setLabelWidth(n=>Math.max(96,Math.min(440,n+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?24:8))))}
       if(e.key==='Home'){e.preventDefault();setLabelWidth(96)}
      }}/>
     </div>
     <div className="ve-ruler" ref={rulerRef} style={{width}} onPointerDown={startScrubbing} onPointerMove={moveScrubbing} onPointerUp={stopScrubbing} onPointerCancel={stopScrubbing} onDragStart={e=>e.preventDefault()}>
      {marks.map(n=><span className="ve-ruler-mark" style={{left:n*zoom}} key={n}>{CLOCK(n)}</span>)}
      <div className="ve-ruler-playhead" aria-label="Drag timeline playhead" data-testid="playhead-handle"
       style={{left:time*zoom}} onPointerDown={startScrubbing} onPointerMove={moveScrubbing} onPointerUp={stopScrubbing} onPointerCancel={stopScrubbing}>
       <span aria-hidden="true"/>
      </div>
     </div>
    </div>
    <div className="ve-track-stack" style={{position:'relative'}}>
    {tracks.map(track=><div key={track.id} className={'ve-track-row '+(dragHint===track.id?'ve-drop-over':'')} onContextMenu={e=>showContext(e,track.id)}>
      <div className="ve-track-label">
       <span className="ve-track-kind">{track.kind==='audio'?'♫':track.kind==='text'?'T':'▣'}</span>
       <div><strong>{track.label}</strong><small>{track.id}</small></div>
       <button className="ve-track-record" aria-label={'Record '+track.label} title={recordingTrackId===track.id?'Stop animation recording':'Record changes on this track'} aria-pressed={recordingTrackId===track.id} onClick={e=>{e.stopPropagation();onToggleRecord(track.id)}}>{recordingTrackId===track.id?'■':'●'}</button>
       <button className={trackMuted[track.id]?'ve-muted':''} onClick={()=>onToggleTrackMute(track.id)} title={trackMuted[track.id]?'Unmute track':'Mute track'}>{trackMuted[track.id]?'M×':'M'}</button>
       <button aria-label={'Solo '+track.label} aria-pressed={Boolean(trackSolo[track.id])} className={trackSolo[track.id]?'ve-solo':''} onClick={()=>onToggleTrackSolo(track.id)} title={trackSolo[track.id]?'Clear solo':'Solo this track audio'}>S</button>
      </div>
      <div className="ve-track-content" style={{width}}
       onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';setDragHint(track.id)}} onDragLeave={()=>setDragHint('')} onDrop={e=>drop(e,track)}
       onDoubleClick={e=>{if(e.target===e.currentTarget)onSeek(laneTime(e,e.currentTarget))}}>
       {clips.filter(c=>c.trackId===track.id).map(clip=>{
        const asset=assets.find(a=>a.id===clip.assetId),left=clip.start*zoom,span=Math.max(28,clipLength(clip)*zoom);
        const chosen=clip.id===selectedId;
        return <div key={clip.id} className={'ve-clip '+(chosen?'ve-clip-selected ':'')+'ve-'+(clip.kind==='motion'?'motion':track.kind)}
         data-clip-id={clip.id}
         style={{left,width:span,zIndex:chosen?20:Math.round(clip.start)+1,...(asset?.thumbnail?{backgroundImage:'linear-gradient(90deg,rgba(18,28,47,.74),rgba(18,28,47,.5)),url("'+asset.thumbnail+'")',backgroundSize:'cover',backgroundPosition:'center'}:{})}}
         draggable
         onDragStart={e=>{e.dataTransfer.setData('application/x-acs-clip',clip.id);e.dataTransfer.setData('application/x-acs-offset',String((e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom));e.dataTransfer.effectAllowed='move';onSelect(clip.id)}}
         onDragOver={e=>e.preventDefault()}
         onDrop={e=>{const tr=e.dataTransfer.getData('application/x-acs-transition');if(tr){e.preventDefault();e.stopPropagation();onTransition(clip.id,tr,.7)}}}
         onContextMenu={e=>showContext(e,track.id,clip.id)}
         onClick={e=>{e.stopPropagation();onSelect(clip.id)}}>
         <span className="ve-trim-handle ve-trim-start" draggable={false} title="Drag to trim start" onPointerDown={e=>beginTrim(e,clip,'start')} onPointerMove={updateTrim} onPointerUp={endTrim} onPointerCancel={endTrim}/>
         <div className="ve-clip-content"><strong>{clip.kind==='motion'?'◆ Recorded animation':clip.kind==='text'?clip.text:(asset?.name||'Media unavailable')}</strong><small>{CLOCK(clipLength(clip))}{clip.transitionIn!=='none'?' · '+clip.transitionIn:''}{clip.kind==='motion'?' · '+(clip.keyframes?.length||0)+' keys':''}</small></div>
         <span className="ve-trim-handle ve-trim-end" draggable={false} title="Drag to trim end" onPointerDown={e=>beginTrim(e,clip,'end')} onPointerMove={updateTrim} onPointerUp={endTrim} onPointerCancel={endTrim}/>
        </div>;
       })}
       {transitions.filter(o=>o.trackId===track.id).map(o=><div className="ve-overlap-marker" key={o.id} data-overlap-id={o.id}
         title={'Automatic visual + audio crossfade: '+o.duration.toFixed(2)+' seconds · right-click for options'}
         style={{left:o.start*zoom,width:Math.max(16,o.duration*zoom),zIndex:35}}
         onClick={e=>{e.stopPropagation();onSelect(o.incomingId)}}
         onContextMenu={e=>showContext(e,track.id,o.incomingId,o.id)}>↔</div>)}
      </div>
     </div>)}
     <div className="ve-playhead" style={{left:labelWidth+time*zoom}} aria-hidden="true"/>
     <div className="ve-playhead-grab" role="slider" aria-label="Scrub timeline playhead" aria-valuemin={0} aria-valuemax={Math.max(1,total)} aria-valuenow={Math.round(time*100)/100}
      tabIndex={0} style={{left:labelWidth+time*zoom}}
      onPointerDown={startScrubbing} onPointerMove={moveScrubbing} onPointerUp={stopScrubbing} onPointerCancel={stopScrubbing}
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();onSeek(Math.max(0,time+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?1:.1)))}}}>
      <span aria-hidden="true"/>
     </div>
    </div>
   </div>
  </div>
  <footer className="ve-timeline-footer"><span>Overlap clips on one track for automatic crossfades (video + audio). Right-click clips for actions. ● records motion.</span><span>{CLOCK(time)} / {CLOCK(total)}</span></footer>
  {menu&&createPortal(<div role="menu" aria-label="Timeline actions" className="ve-timeline-context" style={{left:menu.x,top:menu.y}} onPointerDown={e=>e.stopPropagation()}>
    {menu.overlapId&&<div className="ve-context-note">Automatic crossfade — move clips apart to remove.</div>}
    {menu.clipId&&<>
     {menuButton('✂ Split at playhead',()=>onSplit(menu.clipId))}
     {menuButton('↤ Ripple delete and close gap',()=>onRippleDelete(menu.clipId))}
     {clips.find(c=>c.id===menu.clipId)?.kind==='video'&&!menu.trackId.startsWith('A')&&menuButton('♫ Detach audio into audio track',()=>onDetachAudio(menu.clipId))}
     {clips.find(c=>c.id===menu.clipId)?.kind==='audio'&&menuButton('⇄ Split stereo L/R',()=>onSplitStereo(menu.clipId))}
     {menuButton('⧉ Duplicate clip / animation',()=>onDuplicate(menu.clipId))}
     {menuButton('◈ Cross dissolve',()=>onTransition(menu.clipId,'crossfade',.7))}
     {menuButton('◐ Fade in',()=>onTransition(menu.clipId,'fade',.7))}
     {menuButton('▧ Wipe transition',()=>onTransition(menu.clipId,'wipe',.7))}
     {menuButton('✕ Remove transition',()=>onTransition(menu.clipId,'none',.7))}
     <hr/>
     {menuButton('☼ Add brighten effect',()=>onPatch(menu.clipId,{brightness:1.25}))}
     {menuButton('◐ Add monochrome effect',()=>onPatch(menu.clipId,{saturation:0}))}
     {menuButton('◧ Add high contrast effect',()=>onPatch(menu.clipId,{contrast:1.45}))}
     {menuButton('↺ Remove color effects',()=>onPatch(menu.clipId,{brightness:1,contrast:1,saturation:1}))}
     {menuButton('☷ Open effects & properties',()=>onOpenInspector(menu.clipId))}
     <hr/>
     {menuButton('🗑 Remove clip from track',()=>onRemove(menu.clipId))}
    </>}
    {!menu.clipId&&<>
     {menuButton(recordingTrackId===menu.trackId?'■ Stop recording':'● Record motion on track',()=>onToggleRecord(menu.trackId))}
     {menuButton('＋ Add video track',()=>onAddTrack('video'))}
     {menuButton('＋ Add audio track',()=>onAddTrack('audio'))}
     {tracks.find(t=>t.id===menu.trackId)?.kind==='text'&&menuButton('T Add text at playhead',()=>onAddTitle(menu.trackId))}
     {menuButton(trackMuted[menu.trackId]?'Unmute track':'Mute track',()=>onToggleTrackMute(menu.trackId))}
     {menuButton(trackSolo[menu.trackId]?'Clear track solo':'Solo track audio',()=>onToggleTrackSolo(menu.trackId))}
     <hr/>
     {menuButton('Remove track',()=>onRemoveTrack(menu.trackId))}
    </>}
   </div>,document.body)}
 </div>;
}
