// Pure editing model. No browser APIs: shared by the UI, tests and future AI actions.
export const TRACKS=[
 {id:'V3',label:'Video 3',kind:'video',z:30},
 {id:'V2',label:'Video 2',kind:'video',z:20},
 {id:'V1',label:'Video 1',kind:'video',z:10},
 {id:'T1',label:'Titles',kind:'text',z:40},
 {id:'C1',label:'Captions',kind:'text',z:50},
 {id:'A1',label:'Audio 1',kind:'audio',z:0},
 {id:'A2',label:'Audio 2',kind:'audio',z:0}
];
export const clipLength=c=>Math.max(0.05,((Number(c.outPoint)||0)-(Number(c.inPoint)||0))/Math.max(.1,Number(c.speed)||1));
export const clipEnd=c=>(Number(c.start)||0)+clipLength(c);
export const timelineDuration=clips=>Math.max(0,...clips.map(clipEnd));
export const trackFor=id=>TRACKS.find(x=>x.id===id)||(/^V[0-9]+$/.test(id)?{id,kind:'video',z:Number(id.slice(1))*10}: /^A[0-9]+$/.test(id)?{id,kind:'audio',z:0}:null);
export const accepts=(asset,track)=> {
 const k=trackFor(track)?.kind;
 return Boolean(k&&(k==='text'?['text','motion'].includes(asset?.kind):k==='audio'?['audio','video','motion'].includes(asset?.kind):asset?.kind!=='audio'&&asset?.kind!=='text'));
};
export function newClip(asset,trackId,start=0,id='clip-'+Math.random().toString(36).slice(2)){
 const length=asset?.kind==='image'?5:Math.max(.1,Number(asset?.duration)||5);
 return {id,assetId:asset?.id||null,trackId,kind:asset?.kind||'video',start:Math.max(0,start),
  inPoint:0,outPoint:length,speed:1,volume:1,muted:false,opacity:1,
  transitionIn:'none',transitionDuration:.7,fadeOut:0,
  scale:1,offsetX:0,offsetY:0,rotation:0,brightness:1,contrast:1,saturation:1,
  text:asset?.kind==='text'?(asset.text||'Your title'):'',fontSize:asset?.kind==='text'?48:36,
  fontColor:'#ffffff',fontFamily:'Arial',fontWeight:700,positionY:50};
}
export const roundTime=n=>Math.max(0,Math.round(n*100)/100);
export function snapTime(t,clips,excludeId,threshold=.16){
 const time=Math.max(0,t);const edges=[0];
 for(const c of clips)if(c.id!==excludeId){edges.push(c.start,clipEnd(c))}
 const hit=edges.reduce((best,e)=>Math.abs(e-time)<Math.abs(best-time)?e:best,Number.POSITIVE_INFINITY);
 return Number.isFinite(hit)&&Math.abs(hit-time)<=threshold?roundTime(hit):roundTime(time);
}
export function splitClip(c,time,newId){
 if(!c||time<=c.start+.08||time>=clipEnd(c)-.08)return null;
 const splitSource=c.inPoint+(time-c.start)*c.speed;
 return [{...c,outPoint:splitSource},{...c,id:newId,start:roundTime(time),inPoint:splitSource,transitionIn:'none',transitionDuration:0}];
}
export function trimClip(c,edge,delta,sourceDuration){
 const min=.1;
 if(edge==='start'){
  const n=Math.max(c.start*-1,Math.min(delta,clipLength(c)-min,(c.outPoint-min-c.inPoint)/c.speed));
  const inPoint=Math.max(0,c.inPoint+n*c.speed);
  const start=Math.max(0,c.start+n);
  return {...c,start:roundTime(start),inPoint:roundTime(inPoint)};
 }
 const cap=Number.isFinite(sourceDuration)&&sourceDuration>0?sourceDuration:c.outPoint;
 const next=Math.max(c.inPoint+min*c.speed,Math.min(cap,c.outPoint+delta*c.speed));
 return {...c,outPoint:roundTime(next)};
}
export function placeClip(clips,id,trackId,start,magnet=.16){
 return clips.map(c=>c.id===id?{...c,trackId,start:snapTime(start,clips,id,magnet)}:c);
}
export function activeClips(clips,time){
 return clips.filter(c=>c.kind!=='motion'&&time>=c.start-.001&&time<clipEnd(c)-.001)
 .sort((a,b)=>(trackFor(a.trackId)?.z||0)-(trackFor(b.trackId)?.z||0)||a.start-b.start);
}
export function transitionProgress(c,time){
 if(c.transitionIn==='none'||!c.transitionDuration)return 1;
 return Math.max(0,Math.min(1,(time-c.start)/c.transitionDuration));
}
export function renderOpacity(c,time){
 const incoming=transitionProgress(c,time);
 const fadeOut=c.fadeOut>0?Math.min(1,(clipEnd(c)-time)/c.fadeOut):1;
 return Math.max(0,Math.min(1,(c.opacity??1)*(c.transitionIn==='none'||c.transitionIn==='wipe'||c.transitionIn==='slide'?1:incoming)*fadeOut));
}
export function addTransition(clips,id,type,duration){
 const current=clips.find(c=>c.id===id);if(!current)return clips;
 const d=Math.max(.1,Math.min(2,Number(duration)||.7,clipLength(current)/2));
 if(type==='none')return clips.map(c=>c.id===id?{...c,transitionIn:'none'}:c);
 const previous=clips.filter(c=>c.id!==id&&c.kind!=='motion'&&c.trackId===current.trackId&&clipEnd(c)<=current.start+.1)
 .sort((a,b)=>clipEnd(b)-clipEnd(a))[0];
 const adjacent=previous&&Math.abs(clipEnd(previous)-current.start)<.2;
 const start=adjacent&&type!=='fade'?Math.max(previous.start+.05,current.start-d):current.start;
 return clips.map(c=>c.id===id?{...c,start:roundTime(start),transitionIn:type,transitionDuration:d}:c);
}
export const serializeProject=(name,assets,clips,settings={})=>({
 version:2,name,settings,
 assets:assets.map(({id,name,type,kind,duration,source,driveId,transcript})=>({id,name,type,kind,duration,source,driveId,transcript})),
 clips:clips.map(c=>({...c}))
});
export function isValidProject(p){
 return Boolean(p&&p.version===2&&typeof p.name==='string'&&Array.isArray(p.assets)&&Array.isArray(p.clips)&&p.assets.length<=500&&p.clips.length<=3000);
}
