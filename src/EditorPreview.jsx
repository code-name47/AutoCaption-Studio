import React,{useEffect,useMemo,useRef} from 'react';
import {activeClips,clipEnd,renderOpacity,transitionProgress,trackFor} from './editorCore.js';

const between=(n,a,b)=>Math.min(b,Math.max(a,n));
function layerStyle(clip,time){
 const progress=transitionProgress(clip,time),opacity=renderOpacity(clip,time);
 const style={opacity,zIndex:trackFor(clip.trackId)?.z||1,
  transform:'translate('+clip.offsetX+'%, '+clip.offsetY+'%) scale('+clip.scale+') rotate('+clip.rotation+'deg)',
  filter:'brightness('+clip.brightness+') contrast('+clip.contrast+') saturate('+clip.saturation+')'};
 if(clip.transitionIn==='wipe')style.clipPath='inset(0 '+((1-progress)*100)+'% 0 0)';
 if(clip.transitionIn==='slide')style.transform='translateX('+((1-progress)*100)+'%) '+style.transform;
 return style;
}
export default function EditorPreview({assets,clips,time,playing,onSelect,selectedId,aspect='16:9',trackMuted={}}){
 const nodes=useRef(new Map());
 const visible=useMemo(()=>activeClips(clips,time),[clips,time]);
 const visibleIds=visible.map(c=>c.id).join(',');
 useEffect(()=>{
  for(const [id,element] of nodes.current){
   const clip=clips.find(c=>c.id===id),asset=assets.find(a=>a.id===clip?.assetId);
   const isActive=clip&&time>=clip.start&&time<clipEnd(clip)&&asset?.url;
   if(!isActive){element.pause();continue}
   const target=between(clip.inPoint+(time-clip.start)*clip.speed,clip.inPoint,clip.outPoint);
   if(element.readyState>=1&&Math.abs(element.currentTime-target)>.3){try{element.currentTime=target}catch{}}
   element.playbackRate=between(clip.speed,.25,4);
   const alpha=renderOpacity(clip,time);
   element.volume=between(trackMuted[clip.trackId]||clip.muted?0:(clip.volume??1)*alpha,0,1);
   if(playing){if(element.paused)element.play().catch(()=>{})}else if(!element.paused)element.pause();
  }
 },[time,playing,visibleIds,clips,assets]);
 useEffect(()=>()=>{for(const el of nodes.current.values())el.pause()},[]);
 const style=aspect==='9:16'?{aspectRatio:'9 / 16',maxWidth:'min(100%, 330px)'}:aspect==='1:1'?{aspectRatio:'1 / 1',maxWidth:'min(100%, 550px)'}:{aspectRatio:'16 / 9'};
 return <div className="ve-stage-frame" style={style}>
  <div className="ve-stage-checker"><span>PREVIEW</span></div>
  {visible.map(clip=>{
   const asset=assets.find(a=>a.id===clip.assetId),position=layerStyle(clip,time);
   const active=clip.id===selectedId;
   if(clip.kind==='text')return <div key={clip.id} onClick={()=>onSelect(clip.id)} className={'ve-stage-text '+(active?'ve-selected-layer':'')} style={{
    ...position,top:clip.positionY+'%',left:'50%',transform:'translate(-50%,-50%) '+position.transform,
    fontSize:'clamp(14px, '+Math.max(1,clip.fontSize/15)+'vw, '+clip.fontSize+'px)',
    fontFamily:clip.fontFamily,color:clip.fontColor,fontWeight:clip.fontWeight,
    textAlign:'center',whiteSpace:'pre-wrap'}}>{clip.text}</div>;
   if(!asset?.url)return null;
   if(clip.kind==='image')return <img key={clip.id} onClick={()=>onSelect(clip.id)} className={'ve-stage-layer '+(active?'ve-selected-layer':'')} src={asset.url} style={position} alt={asset.name}/>;
   const audioOnly=clip.trackId.startsWith('A')||clip.kind==='audio';
   return <video key={clip.id} ref={el=>{if(el)nodes.current.set(clip.id,el);else nodes.current.delete(clip.id)}}
    onClick={()=>onSelect(clip.id)}
    onLoadedMetadata={e=>{const el=e.currentTarget;if(Math.abs(el.currentTime-(clip.inPoint+(time-clip.start)*clip.speed))>.2)el.currentTime=Math.max(0,clip.inPoint+(time-clip.start)*clip.speed);if(playing)el.play().catch(()=>{})}}
    src={asset.url} playsInline preload="auto" controls={false} className={'ve-stage-layer '+(audioOnly?'ve-hidden-audio ':'')+(active?'ve-selected-layer':'')} style={position}/>;
  })}
  {!visible.some(c=>c.kind!=='audio'&&!c.trackId.startsWith('A'))&&<div className="ve-empty-stage">{clips.length?'No visual clips at this time':'Drag videos onto the timeline to start editing'}</div>}
 </div>;
}
