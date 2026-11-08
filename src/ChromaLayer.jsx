import React,{useEffect,useRef} from 'react';
import {renderKeyedImage} from './editorChroma.js';

// Small, real chroma-key compositor for browser preview. Original video
// remains a playback/audio source but is not drawn behind the keyed canvas.
export default function ChromaLayer({clip,sourceUrl,getMedia,playing,stageSize,style,onPointerDown,onPointerMove,onPointerUp,onPointerCancel,selected}){
 const canvas=useRef(null),latest=useRef(null);
 latest.current={clip,getMedia,stageSize};
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const width=Math.max(16,stageSize.w||720),height=Math.max(16,stageSize.h||405);
  const ratio=Math.min(1,640/Math.max(width,height));
  element.width=Math.max(16,Math.round(width*ratio));
  element.height=Math.max(16,Math.round(height*ratio));
  const ctx=element.getContext('2d',{alpha:true});
  if(!ctx)return;
  const work=document.createElement('canvas');
  const cache={canvas:work,context:work.getContext('2d',{willReadFrequently:true})};
  let frame=0,disposed=false,still=null,source=null;
  const draw=()=>{
   if(disposed)return;
   const selected=latest.current;
   const current=source||selected.getMedia?.();
   if(!current)return;
   if(current instanceof HTMLVideoElement&&current.readyState<2)return;
   if(current instanceof HTMLImageElement&&!current.complete)return;
   try{
    ctx.clearRect(0,0,element.width,element.height);
    renderKeyedImage(ctx,current,selected.clip,element.width,element.height,cache);
   }catch(e){console.warn('Chroma preview:',e.message)}
  };
  if(clip.kind==='image'){
   still=new Image();
   still.onload=()=>{source=still;draw()};
   still.src=sourceUrl;
   if(still.complete){source=still;draw()}
  }
  const video=clip.kind!=='image'?getMedia?.():null;
  video?.addEventListener('seeked',draw);
  video?.addEventListener('loadeddata',draw);
  const loop=()=>{draw();frame=requestAnimationFrame(loop)};
  if(playing)frame=requestAnimationFrame(loop);
  else frame=requestAnimationFrame(draw);
  return ()=>{disposed=true;cancelAnimationFrame(frame);
   video?.removeEventListener('seeked',draw);video?.removeEventListener('loadeddata',draw);
   if(still){still.onload=null;still.src=''}
  };
 },[clip.id,clip.kind,clip.chromaKey,clip.chromaColor,clip.chromaTolerance,clip.chromaSoftness,sourceUrl,playing,stageSize.w,stageSize.h]);
 return <canvas ref={canvas} className={'ve-stage-layer ve-chroma-layer '+(selected?'ve-selected-layer':'')}
  style={style} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
  onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}/>;
}
