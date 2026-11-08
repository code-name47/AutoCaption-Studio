// Deterministic editing commands that require no paid API or cloud AI.
// Keep operations reversible via the editor's normal undo snapshot.
import {clipEnd,clipLength,roundTime} from './editorCore.js';

export const AUDIO_CHANNELS=['stereo','left','right'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);

export function detachAudioFromVideo(clips,id,newId,trackId='A1'){
 const clip=clips.find(c=>c.id===id);
 if(!clip||clip.kind!=='video'||clip.trackId.startsWith('A'))throw Error('Select a video clip to detach its audio.');
 if(!/^A[0-9]+$/.test(trackId))throw Error('Choose an audio track.');
 if(clips.some(c=>c.id===newId))throw Error('Duplicate clip identifier.');
 const audio={...clip,id:newId,kind:'audio',trackId,muted:false,
  audioChannel:'stereo',pan:0,transitionIn:'none',
  linkedSourceId:id};
 return {clips:[...clips.map(c=>c.id===id?{...c,muted:true}:c),audio],
  audioId:newId};
}

export function splitStereoAudio(clips,id,leftId,rightId,trackLeft='A1',trackRight='A2'){
 const clip=clips.find(c=>c.id===id);
 if(!clip||!['audio','video'].includes(clip.kind))throw Error('Select a video or audio clip.');
 if(clip.kind==='video'&&!clip.trackId.startsWith('A'))throw Error('Detach video audio first, then split its channels.');
 if(!/^A[0-9]+$/.test(trackLeft)||!/^A[0-9]+$/.test(trackRight)||trackLeft===trackRight)
  throw Error('Use two distinct audio tracks.');
 if(new Set([leftId,rightId,clip.id]).size!==3||clips.some(c=>c.id===leftId||c.id===rightId))
  throw Error('Duplicate clip identifiers.');
 const base={...clip,kind:'audio',transitionIn:'none',audioChannel:'stereo'};
 const left={...base,id:leftId,trackId:trackLeft,audioChannel:'left',pan:-1};
 const right={...base,id:rightId,trackId:trackRight,audioChannel:'right',pan:1};
 return {clips:[...clips.filter(c=>c.id!==id),left,right],leftId,rightId};
}

export function rippleDelete(clips,id){
 const target=clips.find(c=>c.id===id);
 if(!target)throw Error('Clip not found.');
 if(target.kind==='motion')throw Error('Remove an animation clip normally.');
 const from=target.start,until=clipEnd(target),amount=clipLength(target);
 // Treat overlapping edits conservatively: do not truncate media which spans
 // the removed interval, as doing so could destroy footage unexpectedly.
 if(clips.some(c=>c.id!==id&&c.kind!=='motion'&&c.start<until-.02&&clipEnd(c)>from+.02&&
    c.trackId===target.trackId))
  throw Error('Overlapping clips on this track: remove the overlap before ripple deleting.');
 return clips.filter(c=>c.id!==id).map(c=>c.start>=until-.015?{...c,start:roundTime(Math.max(0,c.start-amount))}:c);
}

export function applyAudioPreset(clip,name){
 if(!clip||!['video','audio'].includes(clip.kind))throw Error('Select a clip containing audio.');
 switch(name){
  case 'dialogue':return {...clip,eqLow:-3,eqMid:2,eqHigh:2,volume:.9};
  case 'music':return {...clip,eqLow:1.5,eqMid:0,eqHigh:1,volume:.65};
  case 'flat':return {...clip,eqLow:0,eqMid:0,eqHigh:0,pan:0,volume:1};
  default:throw Error('Unknown audio preset');
 }
}

export function clipAudioConfig(clip){
 return {channel:AUDIO_CHANNELS.includes(clip.audioChannel)?clip.audioChannel:'stereo',
  pan:finite(clip.pan)?Math.max(-1,Math.min(1,clip.pan)):0,
  eqLow:finite(clip.eqLow)?Math.max(-18,Math.min(18,clip.eqLow)):0,
  eqMid:finite(clip.eqMid)?Math.max(-18,Math.min(18,clip.eqMid)):0,
  eqHigh:finite(clip.eqHigh)?Math.max(-18,Math.min(18,clip.eqHigh)):0};
}

// Approximate per-pixel color-distance chroma mask. A soft edge and green-spill
// reduction preserve transparency for footage composited over lower video tracks.
export function chromaOpacity(r,g,b,keyR,keyG,keyB,tolerance=.25,softness=.12){
 const distance=Math.hypot(r-keyR,g-keyG,b-keyB)/(Math.sqrt(3)*255);
 const low=Math.max(0,tolerance-softness*.5);
 const high=Math.min(1,tolerance+softness*.5);
 if(high<=low)return distance>tolerance?1:0;
 const k=Math.max(0,Math.min(1,(distance-low)/(high-low)));
 return k*k*(3-2*k);
}

/** Keep detached audio's source timing in lockstep with the video when linked. */
export function syncLinkedAudio(clips,videoId){
 const source=clips.find(c=>c.id===videoId&&c.kind==='video'&&!c.trackId.startsWith('A'));
 if(!source)return clips;
 return clips.map(c=>c.linkedSourceId===videoId&&c.kind==='audio'?{
  ...c,start:source.start,inPoint:source.inPoint,outPoint:source.outPoint,speed:source.speed
 }:c);
}

/** Linked split: create a corresponding audio section for the new video half. */
export function splitLinkedVideoAudio(clips,videoId,parts,newAudioId){
 const original=clips.find(c=>c.id===videoId);
 if(!original||!parts?.length||parts.length!==2)return clips;
 const linked=clips.filter(c=>c.kind==='audio'&&c.linkedSourceId===videoId);
 if(!linked.length)return clips;
 const extra=linked.map((audio,i)=>({...audio,id:i===0?newAudioId:newAudioId+'-'+i,
  linkedSourceId:parts[1].id,start:parts[1].start,inPoint:parts[1].inPoint,
  outPoint:parts[1].outPoint,speed:parts[1].speed}));
 return [...syncLinkedAudio(clips,videoId),...extra];
}

export function removeLinkedWithVideo(clips,id){
 const target=clips.find(c=>c.id===id);
 if(target?.kind==='video'&&!target.trackId.startsWith('A'))
  return clips.filter(c=>c.id!==id&&c.linkedSourceId!==id);
 return clips.filter(c=>c.id!==id);
}
