import {activeClips,clipEnd,transitionProgress,timelineDuration,trackFor} from './editorCore.js';
import {resolvedClip,visualClipOpacity,audioClipGain,risingTextPosition} from './editorMotion.js';
import {attachAudioGraph,audioTrackEnabled} from './editorAudio.js';
import {renderKeyedImage} from './editorChroma.js';

const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
function supportedMime(){
 if(typeof MediaRecorder==='undefined')throw Error('MediaRecorder is unavailable in this browser.');
 const choices=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
 return choices.find(type=>MediaRecorder.isTypeSupported(type))||null;
}
function dimensions(aspect){
 if(aspect==='9:16')return [540,960];
 if(aspect==='1:1')return [720,720];
 return [1280,720];
}
function waitMedia(node,timeout=14000){
 return new Promise((resolve,reject)=>{
  if(node.readyState>=1)return resolve();
  let timer;
  const end=(error)=>{clearTimeout(timer);node.removeEventListener('loadedmetadata',ok);node.removeEventListener('error',bad);error?reject(error):resolve()};
  const ok=()=>end(),bad=()=>end(Error('Cannot decode a source media file during export.'));
  node.addEventListener('loadedmetadata',ok);node.addEventListener('error',bad);timer=setTimeout(()=>end(Error('Media loading timed out during export.')),timeout);
 });
}
function fitDraw(ctx,node,width,height){
 const w=node.videoWidth||node.naturalWidth||width,h=node.videoHeight||node.naturalHeight||height;
 const scale=Math.min(width/Math.max(w,1),height/Math.max(h,1)),dw=w*scale,dh=h*scale;
 ctx.drawImage(node,(width-dw)/2,(height-dh)/2,dw,dh);
}
function paintText(ctx,clip,width,height){
 ctx.save();
 const size=clamp(clip.fontSize??42,1,500)*width/1280;
 const lines=String(clip.text||'').split('\n');
 ctx.fillStyle=clip.fontColor||'#ffffff';
 ctx.font=(clip.fontWeight||700)+' '+Math.max(.5,size)+'px '+(clip.fontFamily||'Arial');
 ctx.textAlign='center';ctx.textBaseline='middle';
 ctx.shadowColor='rgba(0,0,0,'+(clip.textShadow??.9)+')';ctx.shadowBlur=8;
 ctx.strokeStyle=clip.textOutlineColor||'#000000';ctx.lineWidth=(clip.textOutlineWidth||0)*width/1280;ctx.lineJoin='round';
 const lineHeight=Math.max(18,size*1.3),offset=(lines.length-1)*lineHeight/2;
 for(let i=0;i<lines.length;i++){
  const y=(clip.positionY??50)/100*height-offset+i*lineHeight;
  if(ctx.lineWidth>0)ctx.strokeText(lines[i],width/2,y,width*.92);
  ctx.fillText(lines[i],width/2,y,width*.92);
 }
 ctx.restore();
}
function paintClip(ctx,clip,node,time,width,height,clips,chromaCaches){
 const alpha=visualClipOpacity(clip,clips,time);
 if(alpha<=0)return;
 ctx.save();ctx.globalAlpha=alpha;
 const progress=transitionProgress(clip,time);
 if(clip.transitionIn==='wipe'){ctx.beginPath();ctx.rect(0,0,width*progress,height);ctx.clip()}
 if(clip.transitionIn==='slide')ctx.translate(width*(1-progress),0);
 ctx.translate(width/2,height/2);
 ctx.translate(width*(clip.offsetX||0)/100,height*(clip.offsetY||0)/100);
 ctx.rotate((clip.rotation||0)*Math.PI/180);
 ctx.scale(clip.scale||1,clip.scale||1);
 ctx.translate(-width/2,-height/2);
 ctx.filter='brightness('+(clip.brightness??1)+') contrast('+(clip.contrast??1)+') saturate('+(clip.saturation??1)+') hue-rotate('+(clip.hueRotate??0)+'deg) blur('+(clip.blur??0)+'px)';
 if(clip.kind==='text')paintText(ctx,clip.transitionIn==='rise'?{...clip,positionY:risingTextPosition(clip,time)}:clip,width,height);
 else if(node&&(clip.kind==='image'||node.readyState>=2))try{
  if(clip.chromaKey){
   let cache=chromaCaches.get(clip.id);
   if(!cache){const canvas=document.createElement('canvas');cache={canvas,context:canvas.getContext('2d',{willReadFrequently:true})};chromaCaches.set(clip.id,cache)}
   renderKeyedImage(ctx,node,clip,width,height,cache);
  }else fitDraw(ctx,node,width,height);
 }catch(e){console.warn('Export compositing error:',e.message)}
 ctx.restore();
}
export async function renderProjectToWebM({assets,clips,settings={},trackMuted={},trackSolo={},onProgress=()=>{}}){
 const duration=timelineDuration(clips);
 if(duration<=0)throw Error('The timeline is empty.');
 if(duration>600)throw Error('This browser renderer currently supports timelines up to 10 minutes.');
 if(typeof document==='undefined'||typeof HTMLCanvasElement==='undefined'||!HTMLCanvasElement.prototype.captureStream)throw Error('Canvas stream export is not supported in this browser.');
 const mime=supportedMime();if(!mime)throw Error('WebM recording is not supported in this browser. Try current Chrome or Edge.');
 const [width,height]=dimensions(settings.aspect);
 const fps=clamp(Number(settings.fps)||30,15,30);
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('Canvas rendering is unavailable.');
 const elements=new Map(),audioNodes=new Map(),chromaCaches=new Map();let audioContext=null,audioDestination=null,stream=null,recorder=null,raf=0;
 try{
  const playable=clips.filter(c=>c.kind==='video'||c.kind==='audio');
  for(const clip of playable){
   const asset=assets.find(a=>a.id===clip.assetId);
   if(!asset?.url)continue;
   const element=document.createElement('video');element.src=asset.url;element.preload='auto';element.playsInline=true;
   element.crossOrigin='anonymous';element.volume=1;
   await waitMedia(element);
   elements.set(clip.id,element);
  }
  const imageMap=new Map();
  for(const clip of clips.filter(c=>c.kind==='image')){
   const asset=assets.find(a=>a.id===clip.assetId);if(!asset?.url)continue;
   if(imageMap.has(clip.assetId))continue;
   const img=new Image();img.src=asset.url;await img.decode();imageMap.set(clip.assetId,img);
  }
  stream=canvas.captureStream(fps);
  if(elements.size){
   try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(AudioContextClass){
     audioContext=new AudioContextClass();audioDestination=audioContext.createMediaStreamDestination();
     for(const [id,element] of elements){
      const clip=clips.find(c=>c.id===id);
      const route=attachAudioGraph(audioContext,element,audioDestination,clip);
      audioNodes.set(id,route);
     }
     for(const tr of audioDestination.stream.getAudioTracks())stream.addTrack(tr);
     await audioContext.resume();
    }
   }catch(error){console.warn('Audio mixing unavailable for browser export',error);audioNodes.clear()}
  }
  const chunks=[];
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4_000_000});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const finished=new Promise((resolve,reject)=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:mime}));recorder.onerror=e=>reject(Error(e?.error?.message||'WebM recording failed'))});
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
  recorder.start(1000);
  const started=performance.now();
  await new Promise((resolve,reject)=>{
   let last=0;
   const frame=(now)=>{
    try{
     const elapsed=(now-started)/1000,t=Math.min(duration,elapsed);
     ctx.save();ctx.fillStyle='#000000';ctx.fillRect(0,0,width,height);
     const active=activeClips(clips,t);
     const activeIds=new Set(active.map(c=>c.id));
     for(const [id,element] of elements){
      const clip=clips.find(c=>c.id===id),enabled=activeIds.has(id);
      if(!enabled){if(!element.paused)element.pause();audioNodes.get(id)?.setGain(0);continue}
      const desired=clamp(clip.inPoint+(t-clip.start)*clip.speed,clip.inPoint,clip.outPoint);
      if(Math.abs(element.currentTime-desired)>.25){try{element.currentTime=desired}catch{}}
      element.playbackRate=clamp(clip.speed||1,.25,4);
      const route=audioNodes.get(id);
      if(route){const current=resolvedClip(clip,clips,t);route.update(current);route.setGain(audioTrackEnabled(clip.trackId,trackMuted,trackSolo)?audioClipGain(current,clips,t):0)}
      if(element.paused)element.play().catch(()=>{});
     }
     for(const clip of active){
      if(clip.kind==='audio'||clip.trackId.startsWith('A'))continue;
      const node=clip.kind==='image'?imageMap.get(clip.assetId):elements.get(clip.id);
      paintClip(ctx,resolvedClip(clip,clips,t),node,t,width,height,clips,chromaCaches);
     }
     ctx.restore();
     if(now-last>250){onProgress(t/duration);last=now}
     if(elapsed>=duration){onProgress(1);resolve();return}
     raf=requestAnimationFrame(frame);
    }catch(e){reject(e)}
   };
   raf=requestAnimationFrame(frame);
  });
  recorder.stop();
  const result=await finished;
  if(!result.size)throw Error('The browser produced an empty recording.');
  return result;
 }finally{
  if(raf)cancelAnimationFrame(raf);
  if(recorder?.state==='recording')try{recorder.stop()}catch{}
  for(const element of elements.values()){element.pause();element.removeAttribute('src');element.load()}
  if(stream)for(const track of stream.getTracks())track.stop();
  for(const route of audioNodes.values())route.dispose();
  if(audioContext)await audioContext.close().catch(()=>{});
 }
}
