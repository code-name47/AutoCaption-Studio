// Shared, deterministic edit commands. Browser and bridge validate the same operations.
// No arbitrary JavaScript, file paths, URLs or browser DOM actions can be sent via AI edits.
import {TRACKS,accepts,newClip,clipEnd,clipLength,splitClip,addTransition,roundTime} from './editorCore.js';
import {detachAudioFromVideo,rippleDelete,applyAudioPreset} from './editorEnhancements.js';

const ASPECTS=['16:9','9:16','1:1'];
const TRANSITIONS=['none','crossfade','fade','wipe','slide','rise'];
const PROPERTY_RANGES={
 volume:[0,1],opacity:[0,1],scale:[.05,10],offsetX:[-300,300],offsetY:[-100,100],
 rotation:[-180,180],brightness:[.2,2],contrast:[.2,2],saturation:[0,3],
 fontSize:[1,500],positionY:[0,100],speed:[.1,4],pan:[-1,1],eqLow:[-18,18],eqMid:[-18,18],eqHigh:[-18,18],
 chromaTolerance:[.01,.9],chromaSoftness:[0,.5],textOutlineWidth:[0,12],textShadow:[0,1],hueRotate:[-180,180],blur:[0,20]
};
const COLORS=/^#[0-9a-fA-F]{6}$/;
const FONTS=['Arial','Verdana','Georgia','Impact','Tahoma'];
const MAX_TIME=6*60*60;
const finite=(n,min=0,max=MAX_TIME)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const failExtra=(a,allowed)=>{
 assert(a&&typeof a==='object'&&!Array.isArray(a),'Action must be an object');
 assert(Object.keys(a).every(k=>allowed.includes(k)),'Unexpected action field');
};
const clipBy=(p,id)=>{assert(typeof id==='string'&&id.length<=150,'Invalid clip ID');const clip=p.clips.find(c=>c.id===id);assert(clip,'Clip not found: '+id);return clip};
const compatible=(p,asset,trackId)=>{
 const track=(p.settings?.tracks||TRACKS).find(t=>t.id===trackId);
 assert(track&&accepts(asset,trackId),'Incompatible or unknown track: '+trackId);
};
const makeId=(p,prefix)=>{let n=p.clips.length+1;while(p.clips.some(c=>c.id===prefix+n))n++;return prefix+n};
const safeText=(text,max=3000)=>{assert(typeof text==='string'&&text.length>0&&text.length<=max,'Invalid text length');return text};
const copy=(p,delta)=>({...p,...delta});

/** The AI can inspect metadata and editable timeline objects, never video bytes or Drive credentials. */
export function editorProjectSnapshot({name,assets,clips,settings,tracks}){
 return {
  version:2,name:String(name||'Untitled project').slice(0,90),
  assets:assets.map(a=>({id:a.id,name:a.name,kind:a.kind,duration:a.duration})),
  clips:clips.map(c=>({...c})),
  settings:{aspect:settings.aspect||'16:9',fps:settings.fps||30,tracks:tracks||TRACKS}
 };
}

/** Pure reducer. Throws without modifying input if an operation is unsafe or invalid. */
export function applyEditorAction(project,action){
 assert(project?.version===2&&Array.isArray(project.clips)&&Array.isArray(project.assets),'Invalid editor project');
 assert(project.clips.length<=3000&&project.assets.length<=500,'Project too large');
 assert(action&&typeof action==='object'&&!Array.isArray(action),'Invalid action');
 const p=project,a=action;
 let updated,description,focus,selectedId;
 switch(a.type){
 case 'set_canvas':{
  failExtra(a,['type','aspect']);assert(ASPECTS.includes(a.aspect),'Unsupported canvas orientation');
  updated=copy(p,{settings:{...p.settings,aspect:a.aspect}});
  description='Set canvas to '+a.aspect;break;
 }
 case 'move_clip':{
  failExtra(a,['type','clip_id','start','track_id']);
  const c=clipBy(p,a.clip_id);assert(finite(a.start),'Invalid clip start');
  const track=a.track_id||c.trackId,asset=p.assets.find(x=>x.id===c.assetId)||{kind:c.kind};
  compatible(p,asset,track);
  updated=copy(p,{clips:p.clips.map(x=>x.id===c.id?{...x,trackId:track,start:roundTime(a.start)}:x)});
  description='Move '+c.id+' to '+roundTime(a.start)+'s on '+track;focus=a.start;selectedId=c.id;break;
 }
 case 'trim_clip':{
  failExtra(a,['type','clip_id','in_point','out_point']);
  const c=clipBy(p,a.clip_id);
  assert(c.kind!=='motion','Cannot trim recorded motion with AI yet');
  const begin=a.in_point??c.inPoint,end=a.out_point??c.outPoint;
  assert(finite(begin)&&finite(end)&&end>begin+.09,'Invalid source trim range');
  const asset=p.assets.find(x=>x.id===c.assetId);
  if(asset&&asset.kind!=='image')assert(end<=asset.duration+.05,'Trim exceeds source media duration');
  updated=copy(p,{clips:p.clips.map(x=>x.id===c.id?{...x,inPoint:roundTime(begin),outPoint:roundTime(end)}:x)});
  description='Trim '+c.id+' to source '+begin+'–'+end+'s';focus=c.start;selectedId=c.id;break;
 }
 case 'split_clip':{
  failExtra(a,['type','clip_id','time']);
  const c=clipBy(p,a.clip_id);assert(c.kind!=='motion','Cannot split an animation');
  assert(finite(a.time),'Invalid split time');
  const newId=makeId(p,'ai-split-');
  const parts=splitClip(c,a.time,newId);
  assert(parts,'Split must lie inside the clip');
  updated=copy(p,{clips:p.clips.flatMap(x=>x.id===c.id?parts:[x])});
  description='Split '+c.id+' at '+a.time+'s';focus=a.time;selectedId=newId;break;
 }
 case 'set_text':{
  failExtra(a,['type','clip_id','text']);
  const c=clipBy(p,a.clip_id);assert(c.kind==='text','Clip is not an editable text layer');
  safeText(a.text);
  updated=copy(p,{clips:p.clips.map(x=>x.id===c.id?{...x,text:a.text}:x)});
  description='Update text of '+c.id;focus=c.start;selectedId=c.id;break;
 }
 case 'add_text':{
  failExtra(a,['type','text','start','duration','track_id']);
  safeText(a.text);
  assert(finite(a.start)&&finite(a.duration,.1,60),'Invalid title timing');
  const track=a.track_id||'T1';
  assert(['T1','C1'].includes(track),'Text can be added only to Titles or Captions');
  compatible(p,{kind:'text'},track);
  const id=makeId(p,'ai-text-');
  const c=newClip({kind:'text',duration:a.duration,text:a.text},track,a.start,id);
  c.outPoint=roundTime(a.duration);c.assetId=null;c.text=a.text;
  c.fontSize=track==='C1'?30:52;c.positionY=track==='C1'?85:50;
  updated=copy(p,{clips:[...p.clips,c]});
  description='Add '+(track==='C1'?'subtitle':'title')+': '+a.text.slice(0,60);
  focus=a.start;selectedId=id;break;
 }
 case 'add_media':{
  failExtra(a,['type','asset_id','start','track_id']);
  assert(typeof a.asset_id==='string','Asset ID is required');
  const asset=p.assets.find(x=>x.id===a.asset_id);assert(asset,'Media must already be imported in this browser');
  assert(finite(a.start),'Invalid clip placement time');compatible(p,asset,a.track_id);
  const id=makeId(p,'ai-clip-');
  const c=newClip(asset,a.track_id,a.start,id);
  updated=copy(p,{clips:[...p.clips,c]});
  description='Place '+asset.name+' on '+a.track_id+' at '+a.start+'s';focus=a.start;selectedId=id;break;
 }
 case 'remove_clip':{
  failExtra(a,['type','clip_id']);const c=clipBy(p,a.clip_id);
  updated=copy(p,{clips:p.clips.filter(x=>x.id!==c.id)});
  description='Remove '+c.id;focus=c.start;selectedId='';break;
 }
 case 'style_captions':{
  failExtra(a,['type','font_size','last_font_size','position_y','rise_duration']);
  assert(finite(a.font_size,20,80),'Caption font size must be 20–80');
  assert(finite(a.last_font_size,20,90),'Closing caption font size must be 20–90');
  assert(finite(a.position_y,60,92),'Caption position must be 60–92%');
  assert(finite(a.rise_duration,.1,1),'Caption rise duration must be 0.1–1 seconds');
  const captions=p.clips.filter(c=>c.kind==='text'&&c.trackId==='C1');
  assert(captions.length>0,'No captions are present on C1');
  const last=captions.reduce((latest,c)=>c.start>latest.start?c:latest,captions[0]);
  updated=copy(p,{clips:p.clips.map(c=>c.kind==='text'&&c.trackId==='C1'?{
   ...c,fontSize:c.id===last.id?a.last_font_size:a.font_size,
   positionY:a.position_y,transitionIn:'rise',
   transitionDuration:roundTime(Math.min(a.rise_duration,clipLength(c)/2))
  }:c)});
  description='Enlarge '+captions.length+' captions and animate upward from below';
  focus=0;selectedId=last.id;break;
 }
 case 'set_transition':{
  failExtra(a,['type','clip_id','transition','duration']);
  const c=clipBy(p,a.clip_id);
  assert(c.kind!=='motion'&&TRANSITIONS.includes(a.transition),'Invalid transition');
  if(a.transition==='rise')assert(c.kind==='text','Rise from below applies only to text and captions');
  const duration=a.duration??.7;
  assert(finite(duration,.1,2),'Transition duration must be 0.1–2 seconds');
  updated=copy(p,{clips:addTransition(p.clips,c.id,a.transition,duration)});
  description='Apply '+a.transition+' to '+c.id;focus=c.start;selectedId=c.id;break;
 }
 case 'detach_audio':{
  failExtra(a,['type','clip_id','track_id']);
  const clip=clipBy(p,a.clip_id);
  assert(clip.kind==='video'&&!clip.trackId.startsWith('A'),'Select a visual video clip to detach');
  assert(!p.clips.some(c=>c.kind==='audio'&&c.linkedSourceId===clip.id),'Already detached');
  const track=a.track_id||'A1';
  assert((p.settings?.tracks||TRACKS).some(t=>t.id===track&&t.kind==='audio'),'Destination audio track not found');
  const newId=makeId(p,'ai-audio-');
  const next=detachAudioFromVideo(p.clips,clip.id,newId,track);
  updated=copy(p,{clips:next.clips});
  description='Detach audio from '+clip.id+' into '+track;focus=clip.start;selectedId=newId;break;
 }
 case 'ripple_delete':{
  failExtra(a,['type','clip_id']);const clip=clipBy(p,a.clip_id);
  updated=copy(p,{clips:rippleDelete(p.clips,clip.id)});
  description='Ripple delete '+clip.id+' and close the gap';focus=clip.start;selectedId='';break;
 }
 case 'audio_preset':{
  failExtra(a,['type','clip_id','preset']);
  const clip=clipBy(p,a.clip_id),result=applyAudioPreset(clip,a.preset);
  updated=copy(p,{clips:p.clips.map(c=>c.id===clip.id?result:c)});
  description='Apply '+a.preset+' audio mix to '+clip.id;focus=clip.start;selectedId=clip.id;break;
 }
 case 'set_clip_property':{
  failExtra(a,['type','clip_id','property','value']);const c=clipBy(p,a.clip_id);
  const property=a.property;assert(typeof property==='string','Invalid property');
  const range=Object.hasOwn(PROPERTY_RANGES,property)?PROPERTY_RANGES[property]:null;
  if(range)assert(finite(a.value,...range),'Invalid '+property+' value');
  else if(property==='muted'||property==='chromaKey')assert(typeof a.value==='boolean','Expected boolean');
  else if(property==='audioChannel')assert(['stereo','left','right'].includes(a.value),'Invalid audio channel');
  else if(['chromaColor','textOutlineColor'].includes(property))assert(typeof a.value==='string'&&COLORS.test(a.value),'Invalid color');
  else if(property==='fontColor')assert(c.kind==='text'&&typeof a.value==='string'&&COLORS.test(a.value),'Invalid font color');
  else if(property==='fontFamily')assert(c.kind==='text'&&FONTS.includes(a.value),'Invalid font family');
  else throw new Error('Property is not editable by AI');
  if(['fontSize','positionY','textOutlineColor','textOutlineWidth','textShadow'].includes(property))
   assert(c.kind==='text','Text property applies only to text clips');
  if(['audioChannel','pan','eqLow','eqMid','eqHigh'].includes(property))
   assert(['video','audio'].includes(c.kind),'Audio controls require audio/video media');
  if(['chromaKey','chromaColor','chromaTolerance','chromaSoftness'].includes(property))
   assert(['video','image'].includes(c.kind)&&!c.trackId.startsWith('A'),'Chroma key requires a visual clip');
  updated=copy(p,{clips:p.clips.map(x=>x.id===c.id?{...x,[property]:a.value}:x)});
  description='Set '+property+' of '+c.id+' to '+a.value;focus=c.start;selectedId=c.id;break;
 }
 default:throw new Error('Unknown AI edit action: '+String(a.type).slice(0,40));
 }
 assert(updated.clips.length<=3000,'Too many clips in project');
 return {project:updated,description,focus,selectedId};
}

export function previewEditorActions(project,actions){
 assert(Array.isArray(actions)&&actions.length>=1&&actions.length<=12,'Choose 1–12 editing operations');
 let current=project;const steps=[];
 for(const action of actions){
  const step=applyEditorAction(current,action);
  current=step.project;
  steps.push({description:step.description,focus:step.focus,selectedId:step.selectedId});
 }
 return {project:current,steps};
}

export const EDITOR_ACTION_DESCRIPTION=[
 'set_canvas: {type,aspect:"16:9"|"9:16"|"1:1"}',
 'move_clip: {type,clip_id,start,track_id?}',
 'trim_clip: {type,clip_id,in_point?,out_point?} (source seconds)',
 'split_clip: {type,clip_id,time} (timeline seconds)',
 'set_text: {type,clip_id,text}',
 'add_text: {type,text,start,duration,track_id?:"T1"|"C1"}',
 'add_media: {type,asset_id,start,track_id}',
 'remove_clip: {type,clip_id}',
 'ripple_delete: {type,clip_id} (remove and close following gap)',
 'detach_audio: {type,clip_id,track_id?} (mute original video and add synced audio clip)',
 'audio_preset: {type,clip_id,preset:"dialogue"|"music"|"flat"}',
 'set_transition: {type,clip_id,transition:"none"|"crossfade"|"fade"|"wipe"|"slide"|"rise",duration?}',
 'style_captions: {type,font_size,last_font_size,position_y,rise_duration} (styles all C1 captions with credits-style rise)',
 'set_clip_property: {type,clip_id,property,value}'
].join('; ');
