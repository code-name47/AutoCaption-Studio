// Pure timeline animation and overlap model shared by preview and exported video.
import {clipEnd,clipLength} from './editorCore.js';
export const MOTION_FIELDS=['offsetX','offsetY','scale','rotation','opacity','fontSize','positionY','volume','brightness','contrast','saturation'];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const captureMotion=c=>Object.fromEntries(MOTION_FIELDS.map(key=>[key,Number(c?.[key]??(key==='scale'||key==='opacity'||key==='volume'||key==='brightness'||key==='contrast'||key==='saturation'?1:0))]));
export function overlaps(clips){
 const byTrack=new Map();
 for(const c of clips)if(c.kind!=='motion'){
  if(!byTrack.has(c.trackId))byTrack.set(c.trackId,[]);
  byTrack.get(c.trackId).push(c);
 }
 const result=[];
 for(const [trackId,items] of byTrack){
  items.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
  for(let i=1;i<items.length;i++){
   const incoming=items[i],outgoing=items[i-1];
   const start=Math.max(outgoing.start,incoming.start),end=Math.min(clipEnd(outgoing),clipEnd(incoming));
   if(end-start>=.04)result.push({id:outgoing.id+':'+incoming.id,trackId,outgoingId:outgoing.id,incomingId:incoming.id,start,end,duration:end-start});
  }
 }
 return result;
}
export function overlapFor(clip,clips,time){
 return overlaps(clips).find(o=>time>=o.start&&time<=o.end&&(o.incomingId===clip.id||o.outgoingId===clip.id))||null;
}
export function overlapProgress(transition,time){return transition?clamp((time-transition.start)/Math.max(.001,transition.duration),0,1):null}
export function visualOverlapFactor(clip,clips,time){
 const o=overlapFor(clip,clips,time);if(!o)return 1;
 const p=overlapProgress(o,time);
 // The incoming clip alpha-dissolves over an opaque outgoing clip.
 return o.incomingId===clip.id?p:1;
}
export function audioOverlapFactor(clip,clips,time){
 const o=overlapFor(clip,clips,time);if(!o)return 1;
 const angle=overlapProgress(o,time)*Math.PI/2;
 // Equal-power crossfade: prevents a harsh volume dip at the midpoint.
 return o.incomingId===clip.id?Math.sin(angle):Math.cos(angle);
}
export function animateAt(keyframes,seconds){
 if(!Array.isArray(keyframes)||!keyframes.length)return {};
 const frames=keyframes.slice().sort((a,b)=>a.t-b.t);
 if(seconds<=frames[0].t)return {...frames[0].values};
 for(let i=1;i<frames.length;i++)if(seconds<=frames[i].t){
  const a=frames[i-1],b=frames[i],k=clamp((seconds-a.t)/Math.max(.001,b.t-a.t),0,1);
  const values={};for(const key of new Set([...Object.keys(a.values),...Object.keys(b.values)])){
   const u=a.values[key],v=b.values[key];values[key]=Number.isFinite(u)&&Number.isFinite(v)?u+(v-u)*k:(k<.5?u:v);
  }return values;
 }
 return {...frames.at(-1).values};
}
export function animationFor(clip,clips,time){
 const tracks=clips.filter(c=>c.kind==='motion'&&c.trackId===clip.trackId&&time>=c.start&&time<=clipEnd(c));
 if(!tracks.length)return null;
 // Prefer animations originally recorded for this clip, but allow reusable
 // animations placed on the same track to target any visual/audio clip there.
 const motion=tracks.filter(c=>c.targetClipId===clip.id).sort((a,b)=>b.start-a.start)[0]
   ||tracks.filter(c=>!clips.some(m=>m.id===c.targetClipId&&m.trackId===c.trackId&&time>=m.start&&time<clipEnd(m)))
        .sort((a,b)=>b.start-a.start)[0];
 if(!motion)return null;
 return animateAt(motion.keyframes,motion.inPoint+(time-motion.start)*(motion.speed||1));
}
export function resolvedClip(clip,clips,time){
 if(clip.kind==='motion')return clip;
 const values=animationFor(clip,clips,time);
 return values?{...clip,...values}:clip;
}
export function newMotionClip({id,trackId,targetClipId,start,end,keyframes}){
 const duration=Math.max(.12,end-start);
 return {id,trackId,targetClipId,assetId:null,kind:'motion',start:Math.max(0,start),
  inPoint:0,outPoint:duration,speed:1,transitionIn:'none',transitionDuration:0,
  keyframes:keyframes.map(k=>({t:clamp(k.t,0,duration),values:{...k.values}}))};
}
