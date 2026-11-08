// Pure timeline animation and overlap model shared by preview and exported video.
import {clipEnd,renderOpacity,transitionProgress} from './editorCore.js';
export const MOTION_FIELDS=['offsetX','offsetY','scale','rotation','opacity','fontSize','positionY','volume','brightness','contrast','saturation','fontWeight','fontColor','fontFamily','text'];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Rise captions from below the bottom edge, then drift gently upward like credits.
 * Shared by interactive preview and browser export to ensure identical motion. */
export function risingTextPosition(clip,time){
 const final=Number.isFinite(clip.positionY)?clip.positionY:80;
 if(clip.kind!=='text'||clip.transitionIn!=='rise')return final;
 const elapsed=Math.max(0,time-clip.start);
 const length=Math.max(.1,clipEnd(clip)-clip.start);
 const intro=Math.min(length,Math.max(.1,Number(clip.transitionDuration)||.4));
 const eased=1-Math.pow(1-transitionProgress(clip,time),3);
 const drift=clamp((elapsed-intro)/Math.max(.1,length-intro),0,1);
 const target=final-3*drift;
 const from=Math.max(104,final+24);
 return from+(target-from)*eased;
}
export const captureMotion=c=>Object.fromEntries(MOTION_FIELDS.map(key=>[key,typeof c?.[key]==='string'?c[key]:Number(c?.[key]??(key==='scale'||key==='opacity'||key==='volume'||key==='brightness'||key==='contrast'||key==='saturation'?1:0))]));
const overlapCache=new WeakMap();
export function overlaps(clips){
 const cached=overlapCache.get(clips);if(cached)return cached;
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
 overlapCache.set(clips,result);
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

function blendColor(a,b,k){
 if(typeof a!=='string'||typeof b!=='string'||!/^#[0-9a-f]{6}$/i.test(a)||!/^#[0-9a-f]{6}$/i.test(b))return null;
 const rgb=x=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16));
 const u=rgb(a),v=rgb(b);
 return '#'+u.map((n,i)=>Math.round(n+(v[i]-n)*k).toString(16).padStart(2,'0')).join('');
}
export function animateAt(keyframes,seconds){
 if(!Array.isArray(keyframes)||!keyframes.length)return {};
 const frames=keyframes;
 if(seconds<=frames[0].t)return {...frames[0].values};
 for(let i=1;i<frames.length;i++)if(seconds<=frames[i].t){
  const a=frames[i-1],b=frames[i],k=clamp((seconds-a.t)/Math.max(.001,b.t-a.t),0,1);
  const values={};for(const key of new Set([...Object.keys(a.values),...Object.keys(b.values)])){
   const u=a.values[key],v=b.values[key];values[key]=Number.isFinite(u)&&Number.isFinite(v)?u+(v-u)*k:(blendColor(u,v,k)??(k<.5?u:v));
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
 if(motion.targetClipId!==clip.id){
  const top=clips.filter(c=>c.kind!=='motion'&&c.trackId===clip.trackId&&time>=c.start&&time<clipEnd(c))
   .sort((a,b)=>b.start-a.start||b.id.localeCompare(a.id))[0];
  if(top?.id!==clip.id)return null;
 }
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
  keyframes:keyframes.map(k=>({t:clamp(k.t,0,duration),values:{...k.values}})).sort((a,b)=>a.t-b.t)};
}

export function visualClipOpacity(clip,clips,time){
 const auto=overlapFor(clip,clips,time);
 const fadeEnd=clip.fadeOut>0?clamp((clipEnd(clip)-time)/clip.fadeOut,0,1):1;
 const base=auto?.incomingId===clip.id&&clip.transitionIn==='crossfade'
  ?clamp((clip.opacity??1)*fadeEnd,0,1)
  :renderOpacity(clip,time);
 return clamp(base*visualOverlapFactor(clip,clips,time),0,1);
}
export function audioClipGain(clip,clips,time){
 const auto=overlapFor(clip,clips,time);
 const fadeEnd=clip.fadeOut>0?clamp((clipEnd(clip)-time)/clip.fadeOut,0,1):1;
 const base=auto?.incomingId===clip.id&&clip.transitionIn==='crossfade'
  ?clamp((clip.opacity??1)*fadeEnd,0,1)
  :renderOpacity(clip,time);
 return clip.muted?0:clamp((clip.volume??1)*base*audioOverlapFactor(clip,clips,time),0,1);
}
