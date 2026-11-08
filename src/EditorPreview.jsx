import React,{useEffect,useMemo,useRef,useState} from 'react';
import {activeClips,clipEnd,renderOpacity,transitionProgress,trackFor} from './editorCore.js';
import {resolvedClip,visualClipOpacity,audioClipGain,clamp,captureMotion} from './editorMotion.js';

const between=(n,a,b)=>Math.min(b,Math.max(a,n));
function layerStyle(clip,time,clips){
 const progress=transitionProgress(clip,time);
 const alpha=visualClipOpacity(clip,clips,time);
 const style={opacity:between(alpha,0,1),zIndex:trackFor(clip.trackId)?.z||1,
  transform:'translate('+clip.offsetX+'%, '+clip.offsetY+'%) scale('+clip.scale+') rotate('+clip.rotation+'deg)',
  filter:'brightness('+clip.brightness+') contrast('+clip.contrast+') saturate('+clip.saturation+')'};
 if(clip.transitionIn==='wipe')style.clipPath='inset(0 '+((1-progress)*100)+'% 0 0)';
 if(clip.transitionIn==='slide')style.transform='translateX('+((1-progress)*100)+'%) '+style.transform;
 return style;
}
function selectionGeometry(c,size){
 const isText=c.kind==='text';
 const scale=Math.max(.05,Number(c.scale)||1);
 const fontsize=Math.max(1,Number(c.fontSize)||1);
 const lines=String(c.text||'').split('\n');
 const longest=Math.max(1,...lines.map(s=>s.length));
 const textUnit=fontsize*size.w/1280;
 const width=isText?between(longest*textUnit*.67+24,26,size.w*1.8)*scale:size.w*scale;
 const height=isText?Math.max(18,lines.length*textUnit*1.3+16)*scale:size.h*scale;
 return {
  left:(isText?50:50)+(Number(c.offsetX)||0),
  top:(isText?(Number(c.positionY)??50):50)+(Number(c.offsetY)||0),
  width,height,rotation:Number(c.rotation)||0
 };
}
export default function EditorPreview({
 assets,clips,time,playing,onSelect,selectedId,aspect='16:9',trackMuted={},
 onTransformStart,onTransform,onTransformEnd,viewZoom=70
}){
 const nodes=useRef(new Map()),stage=useRef(null),gesture=useRef(null);
 const [size,setSize]=useState({w:720,h:405});
 useEffect(()=>{
  if(!stage.current)return;
  const measure=()=>{const r=stage.current?.getBoundingClientRect();if(r&&r.width&&r.height)setSize({w:r.width,h:r.height})};
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);observer.observe(stage.current);return()=>observer.disconnect();
 },[aspect]);
 const visible=useMemo(()=>activeClips(clips,time).map(c=>resolvedClip(c,clips,time)),[clips,time]);
 const visibleIds=visible.map(c=>c.id).join(',');
 useEffect(()=>{
  for(const [id,element] of nodes.current){
   const original=clips.find(c=>c.id===id),clip=original&&resolvedClip(original,clips,time);
   const asset=assets.find(a=>a.id===clip?.assetId);
   const isActive=clip&&time>=clip.start&&time<clipEnd(clip)&&asset?.url;
   if(!isActive){element.pause();continue}
   const target=between(clip.inPoint+(time-clip.start)*clip.speed,clip.inPoint,clip.outPoint);
   if(element.readyState>=1&&Math.abs(element.currentTime-target)>.3){try{element.currentTime=target}catch{}}
   element.playbackRate=between(clip.speed,.25,4);
   element.volume=trackMuted[clip.trackId]?0:audioClipGain(clip,clips,time);
   if(playing){if(element.paused)element.play().catch(()=>{})}else if(!element.paused)element.pause();
  }
 },[time,playing,visibleIds,clips,assets,trackMuted]);
 useEffect(()=>()=>{for(const el of nodes.current.values())el.pause()},[]);
 function begin(e,clip,mode='move'){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  onSelect?.(clip.id);
  onTransformStart?.(clip.id);
  gesture.current={id:clip.id,mode,startX:e.clientX,startY:e.clientY,values:captureMotion(clip)};
  e.currentTarget.setPointerCapture(e.pointerId);
 }
 function pointerMove(e){
  const g=gesture.current;if(!g)return;
  const dx=e.clientX-g.startX,dy=e.clientY-g.startY;
  let change;
  if(g.mode==='resize'){
   const factor=Math.max(.03,1+(dx+dy*.6)/Math.max(70,size.w*.3));
   const original=visible.find(c=>c.id===g.id);
   change=original?.kind==='text'?{fontSize:Math.round(clamp(g.values.fontSize*factor,1,500)*10)/10}
    :{scale:Math.round(clamp(g.values.scale*factor,.05,10)*1000)/1000};
  }else{
   change={offsetX:Math.round(clamp(g.values.offsetX+dx/size.w*100,-300,300)*100)/100,
    offsetY:Math.round(clamp(g.values.offsetY+dy/size.h*100,-300,300)*100)/100};
  }
  onTransform?.(g.id,change);
 }
 function pointerEnd(e){
  if(!gesture.current)return;
  onTransformEnd?.(gesture.current.id);
  gesture.current=null;try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}
 }
 const selected=visible.find(c=>c.id===selectedId&&c.kind!=='audio'&&!c.trackId.startsWith('A'));
 const frameStyle=aspect==='9:16'?{aspectRatio:'9 / 16',maxWidth:'min(100%, 270px)'}
  :aspect==='1:1'?{aspectRatio:'1 / 1',maxWidth:'min(100%, 480px)'}:{aspectRatio:'16 / 9'};
 const guide=selected&&selectionGeometry(selected,size);
 const offscreen=guide&&(guide.left<0||guide.left>100||guide.top<0||guide.top>100);
 return <div className="ve-stage-pasteboard">
  <div ref={stage} className="ve-stage-frame" data-aspect={aspect} style={{...frameStyle,width:Math.max(30,Math.min(95,viewZoom))+'%'}}>
   <div className="ve-stage-art">
    <div className="ve-stage-checker"><span>PROGRAM FRAME · {aspect}</span></div>
    {visible.map(clip=>{
     const asset=assets.find(a=>a.id===clip.assetId),position=layerStyle(clip,time,clips);
     const active=clip.id===selectedId;
     const common={onPointerDown:e=>begin(e,clip),onPointerMove:pointerMove,onPointerUp:pointerEnd,onPointerCancel:pointerEnd};
     if(clip.kind==='text'){
      const cssSize=Math.max(.5,(Number(clip.fontSize)||1)*size.w/1280);
      return <div key={clip.id} {...common} className={'ve-stage-text '+(active?'ve-selected-layer':'')} style={{
       ...position,top:(Number(clip.positionY)+Number(clip.offsetY||0))+'%',
       left:(50+Number(clip.offsetX||0))+'%',transform:'translate(-50%,-50%) scale('+clip.scale+') rotate('+clip.rotation+'deg)',
       fontSize:cssSize+'px',lineHeight:1.3,
       fontFamily:clip.fontFamily,color:clip.fontColor,fontWeight:clip.fontWeight,
       textAlign:'center',whiteSpace:'pre-wrap',maxWidth:'190%',width:'max-content'
      }}>{clip.text}</div>;
     }
     if(!asset?.url)return null;
     if(clip.kind==='image')return <img key={clip.id} {...common} className={'ve-stage-layer '+(active?'ve-selected-layer':'')} src={asset.url} style={position} alt={asset.name}/>;
     const audioOnly=clip.trackId.startsWith('A')||clip.kind==='audio';
     return <video key={clip.id} ref={el=>{if(el)nodes.current.set(clip.id,el);else nodes.current.delete(clip.id)}}
      {...common}
      onLoadedMetadata={e=>{const el=e.currentTarget;if(Math.abs(el.currentTime-(clip.inPoint+(time-clip.start)*clip.speed))>.2)el.currentTime=Math.max(0,clip.inPoint+(time-clip.start)*clip.speed);if(playing)el.play().catch(()=>{})}}
      src={asset.url} playsInline preload="auto" controls={false} className={'ve-stage-layer '+(audioOnly?'ve-hidden-audio ':'')+(active?'ve-selected-layer':'')} style={position}/>;
    })}
    {!visible.some(c=>c.kind!=='audio'&&!c.trackId.startsWith('A'))&&<div className="ve-empty-stage">{clips.length?'No visual clips at this time':'Drag videos onto the timeline to start editing'}</div>}
   </div>
   {offscreen&&<div className="ve-offscreen-indicator" role="status"
     style={{left:clamp(guide.left,7,93)+'%',top:clamp(guide.top,7,93)+'%'}}
     title="The selected object is outside the export frame. Drag it or zoom out to see the full bounds."
     onPointerDown={e=>begin(e,selected)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      ◇ Off-canvas · drag here
    </div>}
   {guide&&<div className="ve-object-outline" data-clip-id={selected.id} style={{
     left:guide.left+'%',top:guide.top+'%',width:guide.width,height:guide.height,
     transform:'translate(-50%,-50%) rotate('+guide.rotation+'deg)'
   }} onPointerDown={e=>begin(e,selected)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
    <div className="ve-object-label">{selected.kind==='text'?'TEXT':'MEDIA'} · drag to move</div>
    <span className="ve-corner ve-corner-nw" onPointerDown={e=>begin(e,selected,'resize')} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} aria-label="Resize selected object"/>
    <span className="ve-corner ve-corner-ne" onPointerDown={e=>begin(e,selected,'resize')} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}/>
    <span className="ve-corner ve-corner-sw" onPointerDown={e=>begin(e,selected,'resize')} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}/>
    <span className="ve-corner ve-corner-se" onPointerDown={e=>begin(e,selected,'resize')} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}/>
   </div>}
  </div>
  <div className="ve-frame-status">White frame = exported area · Outlined objects remain editable outside it</div>
 </div>;
}
