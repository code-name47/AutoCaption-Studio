import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {decodeMediaToMono16k} from './audio.js';
import {TRACKS,accepts,newClip,clipEnd,clipLength,activeClips,splitClip,trimClip,placeClip,addTransition,serializeProject,isValidProject,timelineDuration} from './editorCore.js';
import {saveBrowserProject,loadBrowserProject} from './projectStorage.js';
import EditorPreview from './EditorPreview.jsx';
import EditorTimeline from './EditorTimeline.jsx';
import EditorInspector from './EditorInspector.jsx';
import PanelSplitter from './PanelSplitter.jsx';
import useLiveAIEditor from './useLiveAIEditor.js';
import useBridgeTranscription from './useBridgeTranscription.js';
import useLocalAIDemo from './useLocalAIDemo.js';
import AIReviewPanel from './AIReviewPanel.jsx';
import {editorProjectSnapshot} from './aiEditCommands.js';
import {renderProjectToWebM} from './editorExport.js';
import {makeMediaThumbnail} from './mediaThumbnails.js';
import {audioPeaksFromFile,recommendedPeakGain} from './mediaWaveform.js';
import {captureVisualReview,reviewTimelineNotes} from './editorVisualReview.js';
import {captureMotion,newMotionClip} from './editorMotion.js';
import {detachAudioFromVideo,splitStereoAudio,rippleDelete,applyAudioPreset,syncLinkedAudio,splitLinkedVideoAudio,removeLinkedWithVideo} from './editorEnhancements.js';
import './editorWorkspace.css';

const uid=()=>globalThis.crypto?.randomUUID?.()||'id-'+Math.random().toString(36).slice(2);
const blankSettings={aspect:'16:9',fps:30};
const freshPanelLayout=()=>({left:300,inspector:280,timeline:Math.round((typeof window==='undefined'?900:window.innerHeight)*.37)});
function loadPanelLayout(){
 const defaults=freshPanelLayout();
 try{
  const parsed=JSON.parse(window.localStorage.getItem('acs_editor_panels_v1')||'null');
  return parsed&&['left','inspector','timeline'].every(k=>Number.isFinite(parsed[k]))?{left:Math.max(210,parsed.left),inspector:Math.max(220,parsed.inspector),timeline:Math.max(200,parsed.timeline)}:defaults;
 }catch{return defaults}
}
const clampPanel=(n,low,high)=>Math.max(low,Math.min(high,n));
const TYPE_MIMES='video/mp4,video/webm,video/quicktime,video/x-matroska,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm';
const timeLabel=s=>{const n=Math.max(0,Number(s)||0);return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')+'.'+String(Math.floor(n%1*10))};
function fileKind(file){
 if(file.type?.startsWith('video/'))return 'video';
 if(file.type?.startsWith('audio/'))return 'audio';
 if(file.type?.startsWith('image/'))return 'image';
 const n=file.name?.toLowerCase()||'';
 if(/\.(mp4|mov|webm|mkv|m4v)$/.test(n))return 'video';
 if(/\.(mp3|wav|ogg|m4a)$/.test(n))return 'audio';
 if(/\.(png|jpg|jpeg|gif|webp)$/.test(n))return 'image';
 return null;
}
async function measureMedia(blob,url,kind){
 if(kind==='image')return 5;
 return new Promise(resolve=>{
  const element=document.createElement(kind==='audio'?'audio':'video');
  let done=false;const finish=n=>{if(done)return;done=true;clearTimeout(timer);element.removeAttribute('src');element.load();resolve(Number.isFinite(n)&&n>0?n:5)};
  const timer=setTimeout(()=>finish(5),12000);
  element.preload='metadata';element.onloadedmetadata=()=>finish(element.duration);
  element.onerror=()=>finish(5);element.src=url;
 });
}
function captionData(clips){
 return clips.filter(c=>c.trackId==='C1'&&c.kind==='text').sort((a,b)=>a.start-b.start)
 .map(c=>({start:c.start,end:clipEnd(c),text:c.text.trim()})).filter(c=>c.text);
}
function stamp(time,separator=','){const ms=Math.max(0,Math.round(time*1000));return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+separator+String(ms%1000).padStart(3,'0')}
function formatCaptions(segs,ext){
 if(ext==='txt')return segs.map(s=>s.text).join(' ');
 if(ext==='vtt')return 'WEBVTT\n\n'+segs.map(s=>stamp(s.start,'.')+' --> '+stamp(s.end,'.')+'\n'+s.text+'\n').join('\n');
 return segs.map((s,i)=>String(i+1)+'\n'+stamp(s.start)+' --> '+stamp(s.end)+'\n'+s.text+'\n').join('\n');
}
function downloadText(data,name){const url=URL.createObjectURL(new Blob([data],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000)}
async function pickerConfig(){
 const res=await fetch('/auth/google/picker-config');const data=await res.json();if(!res.ok)throw Error(data.error||'Please connect Google Drive');return data;
}
async function openPicker(config,callback){
 if(!window.gapi)await new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src='https://apis.google.com/js/api.js';tag.onload=resolve;tag.onerror=()=>reject(Error('Google Picker script could not load'));document.head.appendChild(tag)});
 await new Promise((resolve,reject)=>window.gapi.load('picker',{callback:resolve,onerror:reject}));
 const view=new window.google.picker.DocsView(window.google.picker.ViewId.DOCS).setMimeTypes(TYPE_MIMES).setIncludeFolders(true);
 const builder=new window.google.picker.PickerBuilder().addView(view).enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
  .setOAuthToken(config.accessToken).setDeveloperKey(config.apiKey).setOrigin(window.location.origin).setCallback(data=>{
   if(data.action===window.google.picker.Action.PICKED)callback(data.docs||[]);
  });
 if(config.appId)builder.setAppId(config.appId);
 builder.build().setVisible(true);
}
const TABS=[
 {id:'media',label:'Media',icon:'▣'},
 {id:'captions',label:'Captions',icon:'▤'},
 {id:'titles',label:'Titles',icon:'T'},
 {id:'transitions',label:'Transitions',icon:'◈'},
 {id:'audio',label:'Audio',icon:'♫'},
 {id:'export',label:'Export',icon:'⇧'},
 {id:'ai',label:'Connect',icon:'⌘'}
];
const TRANSITIONS=[{id:'none',label:'Hard cut'},{id:'crossfade',label:'Cross dissolve'},{id:'fade',label:'Fade in'},{id:'wipe',label:'Wipe reveal'},{id:'slide',label:'Slide right'},{id:'rise',label:'Rise from below'}];
export default function EditorWorkspace(){
 const [name,setName]=useState('Untitled project'),[settings,setSettings]=useState(blankSettings),[tracks,setTracks]=useState(TRACKS),
 [assets,setAssets]=useState([]),[clips,setClips]=useState([]),[selectedId,setSelectedId]=useState(''),[selectedAssetId,setSelectedAssetId]=useState(''),
 [sourceViewer,setSourceViewer]=useState(false),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),
 [zoom,setZoom]=useState(36),[viewZoom,setViewZoom]=useState(70),[panelLayout,setPanelLayout]=useState(loadPanelLayout),[timelineExpanded,setTimelineExpanded]=useState(false),[tab,setTab]=useState('media'),[inspectorOpen,setInspectorOpen]=useState(true),
 [trackMuted,setTrackMuted]=useState({}),[trackSolo,setTrackSolo]=useState({}),[status,setStatus]=useState('Ready'),[busy,setBusy]=useState(false),
 [model,setModel]=useState('tiny'),[googleAccount,setGoogleAccount]=useState(''),[bridgeToken,setBridgeToken]=useState(''),
 [rendering,setRendering]=useState(false),[renderProgress,setRenderProgress]=useState(0),[historyVersion,setHistoryVersion]=useState(0),[recordingTrackId,setRecordingTrackId]=useState(''),[visualReviewBusy,setVisualReviewBusy]=useState(false),[visualReviewInfo,setVisualReviewInfo]=useState(null),[showCaptionAudit,setShowCaptionAudit]=useState(false);
 const editorMain=useRef(null),beforeExpand=useRef(null),input=useRef(null),audioInput=useRef(null),assetRef=useRef([]),fileImportActive=useRef(false),transcriptionWorker=useRef(null);
 const timeRef=useRef(0),playRef=useRef(false),past=useRef([]),future=useRef([]),clipsRef=useRef([]),recording=useRef(null);
 const currentClip=clips.find(c=>c.id===selectedId);
 const currentAsset=assets.find(a=>a.id===currentClip?.assetId);
 const selectedAsset=assets.find(a=>a.id===selectedAssetId);
 const length=useMemo(()=>timelineDuration(clips),[clips]);
 const captionAuditNotes=useMemo(()=>reviewTimelineNotes(clips,assets),[clips,assets]);
 useEffect(()=>{document.body.classList.add('ve-app-mode');return()=>{document.body.classList.remove('ve-app-mode');document.body.classList.remove('ve-is-resizing')}},[]);
 useEffect(()=>{try{window.localStorage.setItem('acs_editor_panels_v1',JSON.stringify(panelLayout))}catch{}},[panelLayout]);
 function resizeLeft(delta){
  setPanelLayout(old=>{
   const width=editorMain.current?.clientWidth||window.innerWidth;
   const inspectorUsed=inspectorOpen&&window.innerWidth>900?old.inspector+7:0;
   const max=Math.max(210,width-inspectorUsed-7-14-290);
   return {...old,left:clampPanel(old.left+delta,210,max)};
  });
 }
 function resizeInspector(delta){
  setPanelLayout(old=>{
   const width=editorMain.current?.clientWidth||window.innerWidth;
   return {...old,inspector:clampPanel(old.inspector-delta,220,Math.max(220,width-old.left-7-7-14-290))};
  });
 }
 function resizeTimeline(delta){
  setTimelineExpanded(false);
  setPanelLayout(old=>({...old,timeline:clampPanel(old.timeline-delta,200,Math.max(200,window.innerHeight-56-21-8-150))}));
 }
 function toggleTimelineSize(){
  if(timelineExpanded){
   setPanelLayout(old=>({...old,timeline:beforeExpand.current??freshPanelLayout().timeline}));
   setTimelineExpanded(false);
  }else{
   beforeExpand.current=panelLayout.timeline;
   setPanelLayout(old=>({...old,timeline:clampPanel(Math.round(window.innerHeight*.62),200,Math.max(200,window.innerHeight-56-21-8-150))}));
   setTimelineExpanded(true);
  }
 }
 function resetPanelLayout(){setPanelLayout(freshPanelLayout());setTimelineExpanded(false)}

 useEffect(()=>{assetRef.current=assets;clipsRef.current=clips},[assets,clips]);
 useEffect(()=>()=>{transcriptionWorker.current?.terminate();for(const a of assetRef.current)if(a.url)URL.revokeObjectURL(a.url)},[]);
 useEffect(()=>{fetch('/auth/google/me').then(r=>r.json()).then(d=>{if(d.connected)setGoogleAccount(d.email||'Connected')}).catch(()=>{})},[]);
 useEffect(()=>{playRef.current=playing},[playing]);
 useEffect(()=>{timeRef.current=time},[time]);
 const note=useCallback((message)=>setStatus(String(message)),[]);
 function record(){past.current.push(clipsRef.current.map(c=>({...c})));if(past.current.length>80)past.current.shift();future.current=[];setHistoryVersion(v=>v+1)}
 function undo(){if(!past.current.length)return;future.current.push(clipsRef.current);const previous=past.current.pop();setClips(previous);setHistoryVersion(v=>v+1);note('Undo');}
 function redo(){if(!future.current.length)return;past.current.push(clipsRef.current);setClips(future.current.pop());setHistoryVersion(v=>v+1);note('Redo');}
 function seek(next){setPlaying(false);setSourceViewer(false);const t=Math.max(0,Math.min(length,Number(next)||0));timeRef.current=t;setTime(t);}
 useEffect(()=>{
  if(!playing)return;
  const began=performance.now(),from=timeRef.current;let animation=0,previous=0;
  function frame(now){const next=from+(now-began)/1000;if(next>=length){timeRef.current=Math.max(0,length-.01);setTime(timeRef.current);if(recording.current)stopRecording();setPlaying(false);return}
   if(now-previous>28){timeRef.current=next;setTime(next);previous=now}animation=requestAnimationFrame(frame)}
  animation=requestAnimationFrame(frame);return()=>cancelAnimationFrame(animation);
 },[playing,length]);
 function togglePlay(){if(sourceViewer){setSourceViewer(false);setPlaying(true);return}if(!clips.length){note('Add a clip to a track to play the timeline.');return}if(timeRef.current>=length-.05){setTime(0);timeRef.current=0}setPlaying(v=>!v)}
 function removeClip(id){if(clipsRef.current.find(c=>c.id===id)?.locked){note('Unlock this clip before deleting it.');return}if(recording.current?.targetClipId===id)stopRecording();record();setClips(cs=>removeLinkedWithVideo(cs,id));if(selectedId===id)setSelectedId('');setPlaying(false)}
 function updateClip(id,patch){if(clipsRef.current.find(c=>c.id===id)?.locked&&!(Object.keys(patch).length===1&&patch.locked===false)){
  note('Unlock this clip before editing it.');return
 }if(recording.current?.targetClipId!==id)record();setClips(cs=>{
   const source=cs.find(c=>c.id===id);
   const preserve=source?.kind==='audio'&&source.linkedSourceId&&
    ['start','inPoint','outPoint','speed'].some(k=>Object.hasOwn(patch,k));
   const changed=cs.map(c=>c.id===id?{...c,...patch,...(preserve?{linkedSourceId:null}:{})}:c);
   return source?.kind==='video'&&['start','inPoint','outPoint','speed'].some(k=>Object.hasOwn(patch,k))?syncLinkedAudio(changed,id):changed;
  });if(recording.current?.targetClipId===id)captureKeyframe(id,patch)}

 // Recording is non-destructive: edits become timed keyframes in a reusable
 // purple motion clip; the original object's values are restored on Stop.
 function captureKeyframe(id,patch){
  const session=recording.current;if(!session||session.targetClipId!==id)return;
  const underlying=clipsRef.current.find(c=>c.id===id);
  if(!underlying)return;
  const t=Math.max(0,Math.min(600,timeRef.current-session.start));
  const values={...captureMotion(underlying),...patch};
  const last=session.keyframes.at(-1);
  if(last&&Math.abs(last.t-t)<.012)session.keyframes[session.keyframes.length-1]={t,values};
  else session.keyframes.push({t,values});
  if(session.keyframes.length>2400)session.keyframes.splice(1,1);
 }
 function stopRecording(){
  const session=recording.current;if(!session)return;
  recording.current=null;
  setRecordingTrackId('');setPlaying(false);
  const end=Math.max(session.start+.12,timeRef.current);
  if(session.keyframes.length<2){note('Recording stopped with no changes. No animation created.');return}
  const last=session.keyframes.at(-1).values;
  session.keyframes.push({t:Math.max(.12,end-session.start),values:{...last}});
  const motion=newMotionClip({id:uid(),trackId:session.trackId,targetClipId:session.targetClipId,start:session.start,end,keyframes:session.keyframes});
  setClips(cs=>[...cs.map(c=>c.id===session.targetClipId?{...c,...session.initial}:c),motion]);
  note('Animation recorded: '+session.keyframes.length+' keyframes, '+(end-session.start).toFixed(2)+'s. Drag the purple motion clip to reuse it.');
 }
 function toggleRecord(trackId){
  if(recording.current){if(recording.current.trackId===trackId){stopRecording();return}stopRecording()}
  const current=clipsRef.current;
  const selected=current.find(c=>c.id===selectedId&&c.trackId===trackId&&c.kind!=='motion');
  const target=selected||current.filter(c=>c.trackId===trackId&&c.kind!=='motion')
    .find(c=>timeRef.current>=c.start&&timeRef.current<clipEnd(c));
  if(!target){note('Select a clip on '+trackId+' and position the playhead inside it before recording.');return}
  const start=timeRef.current>=target.start&&timeRef.current<clipEnd(target)?timeRef.current:target.start;
  record();recording.current={trackId,targetClipId:target.id,start,initial:captureMotion(target),keyframes:[{t:0,values:captureMotion(target)}]};
  timeRef.current=start;setTime(start);setSelectedId(target.id);setSourceViewer(false);setRecordingTrackId(trackId);setPlaying(true);
  note('Recording '+trackId+' — drag or resize in the preview, or change Inspector values. Press ■ to stop.');
 }
 function transformStart(id){if(clipsRef.current.find(c=>c.id===id)?.locked)return;if(recording.current?.targetClipId!==id)record()}
 function transformLive(id,patch){
  if(clipsRef.current.find(c=>c.id===id)?.locked)return;
  setClips(cs=>cs.map(c=>c.id===id?{...c,...patch}:c));
  captureKeyframe(id,patch);
 }
 function duplicateClip(id){
  const original=clipsRef.current.find(c=>c.id===id);if(!original)return;
  record();const duplicate={...original,id:uid(),start:clipEnd(original)+.1,
   ...(original.kind==='motion'?{keyframes:original.keyframes?.map(k=>({t:k.t,values:{...k.values}}))}: {})};
  setClips(cs=>{
   const linked=original.kind==='video'?cs.filter(c=>c.kind==='audio'&&c.linkedSourceId===id):[];
   return [...cs,duplicate,...linked.map(c=>({...c,id:uid(),linkedSourceId:duplicate.id,start:duplicate.start}))];
  });setSelectedId(duplicate.id);note('Duplicated clip'+(original.kind==='video'?' and its linked audio':'')+'. Drag it wherever you want.');
 }
 function removeTrack(trackId){
  if(['T1','C1'].includes(trackId)){note('The dedicated Titles and Captions tracks cannot be removed.');return}
  if(tracks.filter(t=>t.kind==='video').length<=1&&tracks.find(t=>t.id===trackId)?.kind==='video'){note('At least one video track must remain.');return}
  const affected=clipsRef.current.filter(c=>c.trackId===trackId);
  if(affected.length&&!window.confirm('Remove '+trackId+' and all '+affected.length+' clips on it?'))return;
  if(recording.current?.trackId===trackId)stopRecording();
  record();setTracks(ts=>ts.filter(t=>t.id!==trackId));setClips(cs=>cs.filter(c=>c.trackId!==trackId));note(trackId+' removed');
 }

 function detachAudio(id){
  const source=clipsRef.current.find(c=>c.id===id);
  if(!source||source.kind!=='video'||source.trackId.startsWith('A')){note('Select a video clip on a video track.');return}
  if(clipsRef.current.some(c=>c.linkedSourceId===id&&c.kind==='audio')){
   note('Audio is already detached for this clip.');return
  }
  let trackId=tracks.find(t=>t.kind==='audio')?.id;
  if(!trackId){
   trackId='A1';setTracks(ts=>[...ts,{id:trackId,label:'Audio 1',kind:'audio',z:0}]);
  }
  const audioId=uid();
  try{
   const result=detachAudioFromVideo(clipsRef.current,id,audioId,trackId);
   record();setClips(result.clips);setSelectedId(audioId);setSourceViewer(false);
   note('Detached audio to '+trackId+'; the original picture stays aligned and silent.');
  }catch(e){note(e.message)}
 }
 async function separateStereoChannels(id){
  const source=clipsRef.current.find(c=>c.id===id);
  if(!source||source.kind!=='audio'){note('Detach the audio from a video clip, or select an audio clip first.');return}
  const asset=assets.find(a=>a.id===source.assetId);
  if(!asset?.file){note('Original audio is missing. Reopen or import the media.');return}
  if(asset.file.size>80*1024*1024){note('This file exceeds the 80 MB channel-inspection limit. Use a smaller audio file.');return}
  if(busy)return;
  setBusy(true);
  try{
   const Ctx=window.AudioContext||window.webkitAudioContext;
   if(!Ctx)throw Error('Audio decoding is unavailable in this browser.');
   const ctx=new Ctx();let channels;
   try{channels=(await ctx.decodeAudioData(await asset.file.arrayBuffer())).numberOfChannels}
   catch{throw Error('This browser could not decode stereo channel information from this media. Try importing its audio as WAV or AAC.')}
   finally{await ctx.close().catch(()=>{})}
   if(channels<2)throw Error('The selected recording is mono. It has no separate left and right channels.');
   let first=tracks.find(t=>t.kind==='audio')?.id||'A1';
   let second=tracks.filter(t=>t.kind==='audio'&&t.id!==first)[0]?.id;
   if(!second){
    const number=tracks.reduce((m,t)=>t.id.startsWith('A')?Math.max(m,Number(t.id.slice(1))):m,0)+1;
    if(number>12)throw Error('Create a second audio track after removing an unused track.');
    second='A'+number;
    setTracks(ts=>[...ts,{id:second,label:'Audio '+number,kind:'audio',z:0}]);
   }
   const result=splitStereoAudio(clipsRef.current,id,uid(),uid(),first,second);
   record();setClips(result.clips);setSelectedId(result.leftId);setPlaying(false);
   note('Split true stereo left and right into '+first+' and '+second+'. Their channels are isolated in preview and export.');
  }catch(e){note(e.message)}
  finally{setBusy(false)}
 }
 function rippleRemove(id){
  if(clipsRef.current.find(c=>c.id===id)?.locked){note('Unlock this clip before ripple deleting.');return}
  try{const updated=rippleDelete(clipsRef.current,id);
   record();setClips(updated);setSelectedId('');setPlaying(false);
   note('Ripple removed clip and shifted subsequent clips earlier.');
  }catch(e){note(e.message)}
 }
 function audioPreset(id,preset){
  try{const next=applyAudioPreset(clipsRef.current.find(c=>c.id===id),preset);
   updateClip(id,{eqLow:next.eqLow,eqMid:next.eqMid,eqHigh:next.eqHigh,volume:next.volume,pan:next.pan??0});
   note('Applied '+preset+' audio mix preset.');
  }catch(e){note(e.message)}
 }
 function placeAsset(assetId,trackId,at){
  const a=assets.find(x=>x.id===assetId);
  if(!a||!accepts(a,trackId)){note('This media type cannot be placed on that track.');return}
  record();const c=newClip(a,trackId,at,uid());setClips(cs=>[...cs,c]);setSelectedId(c.id);setSourceViewer(false);note(a.name+' added to '+trackId);
 }
 function moveClip(id,trackId,at){const c=clips.find(x=>x.id===id);if(c?.locked){note('Unlock the clip before moving it.');return}const asset=assets.find(a=>a.id===c?.assetId);
  if(!c||!accepts(asset||{kind:c.kind},trackId)){note('Incompatible track type');return}
  record();setClips(cs=>{
   let result=placeClip(cs,id,trackId,at,8/zoom);
   if(c.kind==='video')result=syncLinkedAudio(result,id);
   if(c.kind==='audio'&&c.linkedSourceId){
    result=result.map(x=>x.id===id?{...x,linkedSourceId:null}:x);
   }
   return result;
  });setSelectedId(id);setSourceViewer(false)}
 function split(id){const c=clips.find(x=>x.id===id);if(c?.locked){note('Unlock the clip before splitting it.');return}if(c?.kind==='motion'){note('To split an animation, duplicate it and trim the copies.');return}const parts=splitClip(c,timeRef.current,uid());if(!parts){note('Move the playhead inside the selected clip before splitting.');return}record();setClips(cs=>{
   const split=cs.flatMap(x=>x.id===id?parts:[x]);
   return c.kind==='video'?splitLinkedVideoAudio(split,id,parts,uid()):split;
  });setSelectedId(parts[1].id);note('Clip split at '+timeLabel(timeRef.current))}
 function trim(id,edge,delta,original){if(original.locked)return;const asset=assets.find(x=>x.id===original.assetId);
  setClips(cs=>{
   const updated=cs.map(c=>c.id===id?trimClip(original,edge,delta,asset?.duration):c);
   return original.kind==='video'?syncLinkedAudio(updated,id):updated;
  });
 }
 function transition(id,type,duration){if(clips.find(c=>c.id===id)?.locked){note('Unlock clip before changing transitions.');return}if(clips.find(c=>c.id===id)?.kind==='motion'){note('Transitions apply to media, not motion clips.');return}record();setClips(cs=>addTransition(cs,id,type,duration));setSelectedId(id);note(type==='none'?'Transition removed':type+' transition applied')}
 function addTrack(kind){const prefix=kind==='audio'?'A':'V',count=tracks.filter(t=>t.id.startsWith(prefix)).length;if(count>=12){note('Maximum 12 '+kind+' tracks');return}const number=tracks.reduce((m,t)=>t.id.startsWith(prefix)?Math.max(m,Number(t.id.slice(1))):m,0)+1;const track={id:prefix+number,label:(kind==='audio'?'Audio ':'Video ')+number,kind,z:kind==='audio'?0:number*10};setTracks(old=>kind==='audio'?[...old,track]:[track,...old]);note('Added '+track.label)}
 function normalizeAudio(id){
  const clip=clipsRef.current.find(c=>c.id===id);
  const asset=assets.find(a=>a.id===clip?.assetId);
  try{
   if(!clip||!['audio','video'].includes(clip.kind))throw Error('Choose an audio or video clip');
   const gain=recommendedPeakGain(asset?.waveform,clip.volume);
   updateClip(id,{volume:gain});
   note('Peak normalized clip: gain '+gain.toFixed(2)+'× (peak analysis, not LUFS).');
  }catch(e){note(e.message)}
 }
 function populateWaveforms(items){
  for(const item of items)if(['audio','video'].includes(item.kind)&&item.file&&!item.waveform){
   audioPeaksFromFile(item.file).then(peaks=>{
    if(peaks?.length)setAssets(current=>current.map(a=>a.id===item.id?{...a,waveform:peaks}:a));
   }).catch(()=>{});
  }
 }
 function populateThumbnails(items){
  for(const a of items)makeMediaThumbnail(a.url,a.kind).then(thumb=>{
   if(thumb)setAssets(current=>current.map(x=>x.id===a.id?{...x,thumbnail:thumb}:x));
  }).catch(()=>{});
 }
 function addTitle(text='Your title',trackId='T1',seconds=3){
  const asset={id:uid(),name:text.slice(0,30),kind:'text',duration:seconds,text,type:'text/plain',source:'generated',transcript:[]};
  const c=newClip(asset,trackId,timeRef.current,uid());c.text=text;c.outPoint=seconds;c.fontSize=trackId==='C1'?30:52;c.positionY=trackId==='C1'?85:50;
  record();setAssets(a=>[...a,asset]);setClips(cs=>[...cs,c]);setSelectedId(c.id);setSourceViewer(false);note('Text layer added');
 }
 async function importFiles(files,source='local',driveIds={}){
  const accepted=Array.from(files||[]).filter(x=>fileKind(x));if(!accepted.length){note('Choose a supported video, audio or image file.');return}
  if(fileImportActive.current)return;fileImportActive.current=true;setBusy(true);
  try{const collected=[];for(let i=0;i<accepted.length;i++){
   const f=accepted[i];if(f.size>150*1024*1024){note('Skipping '+f.name+': exceeds 150 MB');continue}
   note('Importing '+(i+1)+'/'+accepted.length+': '+f.name);
   const url=URL.createObjectURL(f),kind=fileKind(f);
   const duration=await measureMedia(f,url,kind);
   collected.push({id:uid(),name:f.name,kind,type:f.type||'',duration,source,driveId:driveIds[f.name]||null,file:f,url,transcript:[]});
  }
  setAssets(a=>[...a,...collected]);populateThumbnails(collected);populateWaveforms(collected);if(collected.length)setSelectedAssetId(collected[0].id);
  note(collected.length+' files added to Project Files. Drag them to a track.');
  }catch(e){note(e.message||'Media import failed')}finally{fileImportActive.current=false;setBusy(false)}
 }
 async function importFromDrive(){
  try{const config=await pickerConfig();await openPicker(config,async docs=>{
   const videos=docs.filter(d=>d.id&&typeof d.mimeType==='string'&&(d.mimeType.startsWith('video/')||d.mimeType.startsWith('audio/'))).slice(0,30);
   if(!videos.length){note('Choose one or more video or audio files.');return}
   if(fileImportActive.current){note('An import is already in progress.');return}
   fileImportActive.current=true;setBusy(true);const collected=[];
   try{for(let i=0;i<videos.length;i++){
    const d=videos[i];note('Downloading Drive media '+(i+1)+'/'+videos.length+': '+d.name);
    try{const r=await fetch('/auth/google/file/'+encodeURIComponent(d.id));
     if(!r.ok){const problem=await r.json().catch(()=>({}));throw Error(problem.error||'Drive file not accessible')}
     const blob=await r.blob();const f=new File([blob],d.name||'drive-video',{type:blob.type||d.mimeType});
     const kind=fileKind(f),url=URL.createObjectURL(f),duration=await measureMedia(f,url,kind);
     collected.push({id:uid(),name:f.name,kind,type:f.type,duration,source:'drive',driveId:d.id,file:f,url,transcript:[]});
    }catch(e){note('Skipped '+d.name+': '+e.message)}
   }
   setAssets(a=>[...a,...collected]);populateWaveforms(collected);if(collected.length)setSelectedAssetId(collected[0].id);note(collected.length+' Drive files added. Drag them onto the timeline.');
   }finally{fileImportActive.current=false;setBusy(false)}
  })}catch(e){note(e.message)}
 }
 async function logoutGoogle(){const r=await fetch('/auth/google/logout',{method:'POST'});if(!r.ok){note('Could not disconnect Google');return}setGoogleAccount('');setBridgeToken('');note('Google disconnected. Existing loaded media remains in this local project.')}
 async function connectAI(){try{const r=await fetch('/api/bridge/session',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not connect');setBridgeToken(d.token);setTab('ai');note('AI bridge connected. Approve proposed edits in this browser.');}catch(e){note(e.message)}}
 async function shareVisualReview(){
  if(!bridgeToken||!ai.connected||visualReviewBusy||busy||rendering||!clips.length)return;
  setVisualReviewBusy(true);setPlaying(false);
  note('Capturing six small preview frames locally for your connected ChatGPT session…');
  try{
   // Synchronize the exact project revision before uploading opt-in stills.
   const synced=await fetch('/api/bridge/editor/snapshot',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+bridgeToken},
    body:JSON.stringify({project:aiProject})});
   const syncResult=await synced.json();
   if(!synced.ok)throw Error(syncResult.error||'Cannot synchronize the current timeline');
   const proof=await captureVisualReview({assets,clips,settings});
   const response=await fetch('/api/bridge/editor/review',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+bridgeToken},
    body:JSON.stringify({...proof,revision:syncResult.revision})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Cannot share this visual review');
   setVisualReviewInfo({frames:result.frames,notes:result.notes,expiresAt:Date.now()+result.expiresInSeconds*1000,waveformAvailable:result.waveformAvailable});
   note('Shared '+result.frames+' preview frames with your connected AI for five minutes. Ask ChatGPT to inspect them.');
  }catch(e){note('Visual review: '+e.message)}
  finally{setVisualReviewBusy(false)}
 }
 async function clearVisualReview(){
  if(!bridgeToken)return;
  try{const response=await fetch('/api/bridge/editor/review',{method:'DELETE',headers:{Authorization:'Bearer '+bridgeToken}});
   if(!response.ok)throw Error('Could not clear preview frames');
   setVisualReviewInfo(null);note('Shared preview frames revoked.');
  }catch(e){note(e.message)}
 }
 async function transcribeSelected(){
  const asset=selectedAsset||currentAsset;
  if(!asset?.file||!['video','audio'].includes(asset.kind)){note('Select a video or audio file in Project Files first.');return}
  if(busy)return;setBusy(true);note('Preparing audio for '+asset.name);
  try{
   const audio=await decodeMediaToMono16k(asset.file,message=>note(message));
   const w=new Worker(new URL('./transcription.worker.js',import.meta.url),{type:'module'});
   transcriptionWorker.current?.terminate();transcriptionWorker.current=w;
   const transcript=await new Promise((resolve,reject)=>{
    w.onerror=()=>reject(Error('Whisper worker failed'));
    w.onmessage=e=>{const m=e.data;if(m.type==='loading')note('Loading '+m.model+' Whisper model…');if(m.type==='processing')note('Transcribing '+asset.name);if(m.type==='error')reject(Error(m.message));if(m.type==='complete')resolve(m.result)};
    w.postMessage({type:'transcribe',model,audio:audio.buffer},[audio.buffer]);
   });
   const segs=transcript.segments?.length?transcript.segments:[{start:0,end:asset.duration,text:transcript.text||''}];
   setAssets(a=>a.map(x=>x.id===asset.id?{...x,transcript:segs}:x));setSelectedAssetId(asset.id);
   note('Transcribed '+asset.name+'. Add captions to the subtitle track.');
  }catch(e){note(e.message)}finally{transcriptionWorker.current?.terminate();transcriptionWorker.current=null;setBusy(false)}
 }
 async function transcribeAll(){
  if(busy)return;
  const queue=assets.filter(a=>a.file&&['video','audio'].includes(a.kind)&&!(a.transcript?.length));
  if(!queue.length){note('No untranscribed project videos found.');return}
  const worker=new Worker(new URL('./transcription.worker.js',import.meta.url),{type:'module'});
  transcriptionWorker.current=worker;setBusy(true);
  let succeeded=0;const failed=[];
  try{
   for(let index=0;index<queue.length;index++){
    const item=queue[index],prefix=(index+1)+'/'+queue.length+' · '+item.name+' — ';
    try{
     note(prefix+'decoding audio…');
     const audio=await decodeMediaToMono16k(item.file,message=>note(prefix+message));
     const transcript=await new Promise((resolve,reject)=>{
      worker.onerror=()=>reject(Error('Whisper worker failed'));
      worker.onmessage=e=>{const m=e.data;if(m.type==='loading')note(prefix+'loading '+m.model+' model…');
       if(m.type==='processing')note(prefix+'transcribing…');
       if(m.type==='error')reject(Error(m.message));
       if(m.type==='complete')resolve(m.result)};
      worker.postMessage({type:'transcribe',model,audio:audio.buffer},[audio.buffer]);
     });
     const segments=transcript.segments?.length?transcript.segments:[{start:0,end:item.duration,text:transcript.text||''}];
     setAssets(all=>all.map(a=>a.id===item.id?{...a,transcript:segments}:a));succeeded++;
    }catch(e){failed.push(item.name+' ('+e.message+')');}
   }
   note('Batch completed: '+succeeded+'/'+queue.length+' videos transcribed'+(failed.length?'. Failed: '+failed.slice(0,3).join('; '):'.'));
  }finally{worker.terminate();if(transcriptionWorker.current===worker)transcriptionWorker.current=null;setBusy(false)}
 }
 function addCaptionsFromAsset(){
  const asset=selectedAsset||currentAsset;
  if(!asset?.transcript?.length){note('Transcribe a selected media file first.');return}
  const targets=clips.filter(c=>c.assetId===asset.id);
  if(!targets.length){note('Add the video to a timeline track first.');return}
  const captions=[];for(const target of targets){
   for(const seg of asset.transcript){
    const startSource=Math.max(target.inPoint,Number(seg.start)),endSource=Math.min(target.outPoint,Number(seg.end));
    if(endSource<=startSource||!seg.text?.trim())continue;
    const start=target.start+(startSource-target.inPoint)/target.speed;
    const dur=(endSource-startSource)/target.speed;
    const caption=newClip({id:null,kind:'text',text:seg.text,duration:dur},'C1',start,uid());
    caption.text=seg.text.trim();caption.outPoint=Math.max(.1,dur);caption.fontSize=30;caption.positionY=86;caption.fontWeight=700;caption.transitionIn='none';captions.push(caption);
   }
  }
  if(!captions.length){note('No caption segments overlap the clips currently on the timeline.');return}
  record();setClips(c=>[...c,...captions]);setTab('captions');note('Added '+captions.length+' subtitle segments to the Captions track.');
 }
 async function saveProject(){
  if(busy||rendering)return;setBusy(true);note('Saving project and media to this browser…');
  try{const metadata=serializeProject(name,assets,clips,{...settings,tracks,trackMuted,trackSolo});await saveBrowserProject(metadata,assets);note('Project saved in this browser. It is not uploaded to the cloud.')}
  catch(e){note('Save failed: '+(e?.name==='QuotaExceededError'?'Browser storage quota exceeded. Try a smaller project.':e.message))}finally{setBusy(false)}
 }
 async function loadProject(){
  if(busy)return;setBusy(true);
  try{const p=await loadBrowserProject();if(!p){note('No saved project found in this browser.');return}
   if(!isValidProject(p))throw Error('Saved project format is invalid');
   setPlaying(false);for(const a of assetRef.current)if(a.url)URL.revokeObjectURL(a.url);
   setAssets(p.assets);populateThumbnails(p.assets.filter(a=>a.url));populateWaveforms(p.assets.filter(a=>a.file&&!a.waveform));setClips(p.clips);setName(p.name);
   setSettings({aspect:p.settings?.aspect||'16:9',fps:Number(p.settings?.fps)||30});
   setTracks(Array.isArray(p.settings?.tracks)&&p.settings.tracks.length?p.settings.tracks:TRACKS);
   setTrackMuted(p.settings?.trackMuted||{});setTrackSolo(p.settings?.trackSolo||{});
   setSelectedId('');setSelectedAssetId('');setSourceViewer(false);setRecordingTrackId('');recording.current=null;setTime(0);timeRef.current=0;past.current=[];future.current=[];
   note('Saved project loaded'+(p.assets.some(x=>x.missing)?'. Some media must be reimported.':'.'));
  }catch(e){note('Could not load project: '+e.message)}finally{setBusy(false)}
 }
 function downloadCaptions(ext){
  const data=captionData(clips);
  if(!data.length){note('No subtitles in the C1 track. Transcribe a clip or add a caption first.');return}
  downloadText(formatCaptions(data,ext),name.replace(/[^a-z0-9_-]+/gi,'_')+'.'+ext);note(ext.toUpperCase()+' exported');
 }
 async function exportWebm(){
  if(rendering||!clips.some(c=>['video','image','text'].includes(c.kind))){note('Add visual clips to the timeline before exporting.');return}
  setPlaying(false);setRendering(true);setRenderProgress(0);note('Preparing WebM render. Keep this tab open.');
  try{const blob=await renderProjectToWebM({assets,clips,settings,trackMuted,trackSolo,onProgress:p=>setRenderProgress(p)});
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name.replace(/[^a-z0-9_-]+/gi,'_')+'.webm';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   note('WebM video rendered. Verify audio and transitions before sharing.');
  }catch(e){note('WebM export failed: '+e.message)}finally{setRendering(false)}
 }
 function handleShortcut(e){const target=e.target;if(target&&(target.closest('input,textarea,select,[contenteditable="true"]')))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return}
  if(e.code==='Space'){e.preventDefault();togglePlay();return}
  if(e.key==='Delete'||e.key==='Backspace'){if(selectedId){e.preventDefault();removeClip(selectedId)}return}
  if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey&&selectedId){e.preventDefault();split(selectedId)}
 }
 const keysRef=useRef(null);keysRef.current=handleShortcut;
 useEffect(()=>{const listener=e=>keysRef.current?.(e);window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener)},[]);
 const trackMute=t=>setTrackMuted(m=>({...m,[t]:!m[t]}));
 const trackSoloToggle=t=>setTrackSolo(m=>({...m,[t]:!m[t]}));
 const aiProject=useMemo(()=>editorProjectSnapshot({name,assets,clips,settings,tracks}),[name,assets,clips,settings,tracks]);
 // ChatGPT can request transcription by asset ID. The audio never leaves this
 // browser: local Whisper returns only the timestamped dialogue to the bridge.
 useBridgeTranscription({
  token:bridgeToken,assetsRef:assetRef,busy,onBusy:setBusy,
  onSegments:(assetId,segments)=>setAssets(current=>current.map(a=>a.id===assetId?{...a,transcript:segments}:a)),
  onNotice:note
 });
 const ai=useLiveAIEditor({
  token:bridgeToken,project:aiProject,canApply:!busy&&!rendering&&!recordingTrackId,
  onStart:()=>{setPlaying(false);setSourceViewer(false);record()},
  onStep:step=>{
   setClips(step.project.clips);
   setSettings(current=>({...current,aspect:step.project.settings.aspect}));
   setSelectedId(step.selectedId||'');
   if(typeof step.focus==='number'){timeRef.current=step.focus;setTime(step.focus)}
   setSourceViewer(false);
   note('AI: '+step.description);
  },
  onRestore:previous=>{
   setClips(previous.clips);
   setSettings(current=>({...current,aspect:previous.settings.aspect}));
   setSelectedId('');timeRef.current=0;setTime(0);
  },
  onNotice:note,onExpired:()=>{setBridgeToken('');note('AI bridge expired. Reconnect to continue.')}
 });
 const localDemo=useLocalAIDemo({
  project:aiProject,canApply:!busy&&!rendering&&!recordingTrackId,
  remoteActive:!!ai.review||ai.applying,
  onStart:()=>{setPlaying(false);setSourceViewer(false);record()},
  onStep:step=>{
   setClips(step.project.clips);
   setSettings(old=>({...old,aspect:step.project.settings.aspect}));
   setSelectedId(step.selectedId||'');
   if(typeof step.focus==='number'){timeRef.current=step.focus;setTime(step.focus)}
   note('Sample AI: '+step.description);
  },
  onRestore:previous=>{
   setClips(previous.clips);
   setSettings(old=>({...old,aspect:previous.settings.aspect}));
   setSelectedId('');timeRef.current=0;setTime(0);
  },
  onNotice:note
 });
 const shownAI=ai.review||ai.applying?ai:
  (localDemo.review||localDemo.applying||localDemo.recent||localDemo.error)?localDemo:ai;
 return <div className={'ve-shell'+(ai.applying||localDemo.applying?' ve-ai-busy':'')}>
  <header className="ve-topbar">
   <div className="ve-logo"><span>◉</span> AUTOCAPTION <b>STUDIO</b><small>EDIT</small></div>
   <div className="ve-top-separator"/>
   <input className="ve-project-name" aria-label="Project name" value={name} onChange={e=>setName(e.target.value.slice(0,90))}/>
   <span className="ve-top-state" title={status}>{status}</span>
   <div className="ve-top-actions">
    <button title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
    <button title="Redo (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
    {bridgeToken&&<button className="ve-ai-top-indicator" title="Open AI editing controls" onClick={()=>setTab('ai')}>● AI {ai.applying?'editing':ai.review?'review':'linked'}</button>}
    <button title="Reset editor panel sizes" onClick={resetPanelLayout}>Reset panels</button>
    <button onClick={saveProject} disabled={busy||rendering}>Save</button>
    <button className="ve-accent-btn" onClick={()=>setTab('export')}>Export</button>
    <a href="/?classic=1" title="Original transcription and batch-processing view">Classic</a>
   </div>
  </header>
  <div className="ve-main" ref={editorMain} style={{'--ve-left-width':panelLayout.left+'px','--ve-inspector-width':panelLayout.inspector+'px'}}>

   <aside className="ve-left">
    <nav className="ve-side-tabs" aria-label="Editor panels">{TABS.map(t=><button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)} title={t.label}><span>{t.icon}</span><small>{t.label}</small></button>)}</nav>
    <div className="ve-left-content" onDragOver={e=>{if(Array.from(e.dataTransfer.types||[]).includes("Files"))e.preventDefault()}} onDrop={e=>{if(e.dataTransfer.files?.length){e.preventDefault();importFiles(e.dataTransfer.files)}}}>
    {tab==='media'&&<><div className="ve-pane-heading"><b>Project Files</b><small>{assets.length} assets</small></div>
     <div className="ve-media-actions"><button className="ve-accent-btn" onClick={()=>input.current?.click()}>+ Import media</button><button onClick={importFromDrive} disabled={busy}>Google Drive</button></div>
     {!googleAccount&&<a href="/auth/google/start" className="ve-connect-hint">Connect Google Drive to import cloud videos</a>}
     <p className="ve-hint">Drag a file onto a video or audio track. Click a file to preview it.</p>
     <div className="ve-media-items">{assets.length===0?<div className="ve-empty-bin">No media yet. Import videos, audio, or images to begin.</div>:assets.map(a=><div key={a.id} className={'ve-media-item '+(selectedAssetId===a.id?'selected':'')} draggable
      onDragStart={e=>{e.dataTransfer.setData('application/x-acs-asset',a.id);e.dataTransfer.effectAllowed='copyMove'}}
      onClick={()=>{setSelectedAssetId(a.id);setSourceViewer(true);setPlaying(false)}}>
       <div className="ve-media-icon">{a.thumbnail?<img src={a.thumbnail} alt=""/>:a.kind==='audio'?'♫':a.kind==='image'?'▧':'▶'}</div><div className="ve-media-info"><strong title={a.name}>{a.name}</strong><small>{a.kind} · {timeLabel(a.duration)}{a.transcript?.length?' · captions':''}</small></div>
       <button title="Add to timeline" onClick={e=>{e.stopPropagation();placeAsset(a.id,a.kind==='audio'?'A1':'V1',timelineDuration(clips))}}>+</button>
      </div>)}</div>
    </>}
    {tab==='captions'&&<><div className="ve-pane-heading"><b>AI Captions</b><small>Whisper, local</small></div>
      <p className="ve-hint">Select a video in Project Files or on the timeline. Transcription runs in your browser and supports clips under 10 minutes.</p>
      <p className="ve-selected-name">{(selectedAsset||currentAsset)?.name||'No file selected'}</p>
      <label className="ve-stacked-field"><span>Model</span><select value={model} disabled={busy} onChange={e=>setModel(e.target.value)}><option value="tiny">Whisper Tiny (fastest)</option><option value="base">Whisper Base</option><option value="small">Whisper Small (slower)</option></select></label>
      <button className="ve-wide-btn ve-accent-btn" disabled={busy||!((selectedAsset||currentAsset)?.file)} onClick={transcribeSelected}>{busy?'Working…':'Transcribe selected media'}</button>
      <button className="ve-wide-btn" disabled={busy||!assets.some(a=>['video','audio'].includes(a.kind)&&!a.transcript?.length)} onClick={transcribeAll}>Transcribe all project videos</button>
      <button className="ve-wide-btn" onClick={addCaptionsFromAsset} disabled={!(selectedAsset||currentAsset)?.transcript?.length}>Place subtitles on C1 track</button>
      <button className="ve-wide-btn" data-testid="run-caption-audit" disabled={!clips.length} onClick={()=>setShowCaptionAudit(v=>!v)}>{showCaptionAudit?'Hide timeline timing report':'Check caption timing and gaps'}</button>
      {showCaptionAudit&&<div className="ve-note" data-testid="caption-audit-report"><strong>Timeline timing review</strong><ul>{captionAuditNotes.length?captionAuditNotes.map((n,i)=><li key={i}>{n}</li>):<li>No structural timing gaps detected.</li>}</ul><small>Transcript matches are approximate; audio must still be reviewed by ear.</small></div>}
      <p className="ve-note">You can trim and edit each subtitle on the timeline and in the inspector.</p>
    </>}
    {tab==='titles'&&<><div className="ve-pane-heading"><b>Titles & Text</b><small>Overlays</small></div>
       <p className="ve-hint">Add editable titles at the playhead. Titles use the T1 track and appear over video.</p>
       {[{title:'Center title',text:'YOUR TITLE',duration:4},{title:'Lower third',text:'Name · Role',duration:4},{title:'Heading',text:'Your next chapter',duration:3}].map(p=><button className="ve-palette-item" key={p.title} onClick={()=>addTitle(p.text,'T1',p.duration)}><span className="ve-title-example">{p.text}</span><small>{p.title}</small></button>)}
       <button className="ve-wide-btn" onClick={()=>addTitle('Add caption text','C1',2)}>+ Manual subtitle</button>
    </>}
    {tab==='transitions'&&<><div className="ve-pane-heading"><b>Transitions</b><small>Drag onto clips</small></div><p className="ve-hint">Drag a transition onto an incoming clip, or select a clip first and click an effect. Cross dissolve overlaps adjacent clips automatically.</p>
      {TRANSITIONS.map(t=><button draggable onDragStart={e=>{e.dataTransfer.setData('application/x-acs-transition',t.id)}} className="ve-palette-item" key={t.id} onClick={()=>selectedId?transition(selectedId,t.id,.7):note('Select a timeline clip first')}><span className="ve-transition-swatch">{t.id==='none'?'▮▮':t.id==='crossfade'?'◩':t.id==='fade'?'◐':t.id==='wipe'?'▧':'⇥'}</span><strong>{t.label}</strong></button>)}
    </>}
    {tab==='audio'&&<><div className="ve-pane-heading"><b>Audio</b><small>Mix & edit</small></div>
      <button className="ve-wide-btn ve-accent-btn" onClick={()=>audioInput.current?.click()}>+ Import audio</button><p className="ve-hint">Drag audio into A1 or A2. Use Inspector to adjust volume or mute a clip. Track mute buttons sit beside each timeline lane.</p>
      {assets.filter(a=>a.kind==='audio').map(a=><div key={a.id} className="ve-media-item" draggable onDragStart={e=>e.dataTransfer.setData('application/x-acs-asset',a.id)}><span>♫</span><strong>{a.name}</strong><button onClick={()=>placeAsset(a.id,'A1',timeRef.current)}>+</button></div>)}
    </>}
    {tab==='export'&&<><div className="ve-pane-heading"><b>Export & Project</b><small>Browser local</small></div>
      <button className="ve-wide-btn ve-accent-btn" disabled={rendering||busy} onClick={exportWebm}>{rendering?'Rendering '+Math.round(renderProgress*100)+'%':'Render WebM video'}</button>
      {rendering&&<progress className="ve-progress" max="100" value={Math.round(renderProgress*100)}/>}
      <p className="ve-note">WebM export renders in real time in this browser. Keep the tab open; codec, audio, and performance support vary by device. Verify the result.</p>
      <h4>Subtitles</h4><div className="ve-format-row">{['srt','vtt','txt'].map(ext=><button key={ext} onClick={()=>downloadCaptions(ext)}>{ext.toUpperCase()}</button>)}</div>
      <h4>Project</h4><button className="ve-wide-btn" onClick={saveProject} disabled={busy}>Save project to this browser</button><button className="ve-wide-btn" onClick={loadProject} disabled={busy}>Open saved browser project</button><p className="ve-note">Projects and source files are stored on this browser/device using IndexedDB, not in Google Drive.</p>
    </>}
    {tab==='ai'&&<><div className="ve-pane-heading"><b>Integrations</b><small>Early access</small></div>
       <p className="ve-hint">First try a visible sample AI edit. It uses the real editing engine without sign-in. Then connect an AI client to propose your own edits; approvals happen on-screen.</p>
       <button className="ve-wide-btn ve-accent-btn" data-testid="run-local-ai-demo" disabled={busy||rendering||localDemo.applying||!!localDemo.review||!!ai.review||ai.applying} onClick={localDemo.queue}>Try sample AI edit now - no login</button>
       <p className="ve-note">This sample is a scripted edit sequence, not a connected ChatGPT session. It changes the real timeline and can be rejected or reverted.</p>
      {googleAccount?<><div className="ve-connected">● Google: {googleAccount}</div><button className="ve-wide-btn" onClick={importFromDrive}>Import Drive videos</button><button className="ve-wide-btn" onClick={logoutGoogle}>Disconnect Google</button></>:<a className="ve-wide-link" href="/auth/google/start">Connect Google account</a>}
      <hr/><button className="ve-wide-btn ve-accent-btn" onClick={connectAI} disabled={!!bridgeToken||!googleAccount}>{bridgeToken?'● AI editing bridge connected':'Connect AI editing bridge'}</button>
      {bridgeToken&&<>
       <div className="ve-ai-connected">● {ai.connected?'Browser synced and ready':'Connecting browser to AI bridge…'}</div>
       <label className="ve-stacked-field"><span>Remote MCP endpoint</span><input readOnly aria-label="AI MCP server URL" value={window.location.origin+'/api/bridge/mcp'}/></label>
       <button className="ve-wide-btn" onClick={()=>navigator.clipboard.writeText(window.location.origin+'/api/bridge/mcp')}>Copy MCP server URL</button>
       <button className="ve-wide-btn" disabled={!ai.connected||ai.applying||!!ai.review} onClick={ai.demo}>Test live AI editing (approval required)</button>
       <hr/>
       <h4>Visual & timing review</h4>
       <p className="ve-note">Optional: explicitly share up to six small screenshots of the real video composition with your connected AI. Frames may show people or private content. Only short-lived JPEG previews, caption timing notes, and optional audio energy measurements are shared—not your original video, audio, or Drive credentials. Expires from our bridge after 5 minutes or any timeline change. Images already delivered to ChatGPT may remain in that conversation under your ChatGPT data settings; revoking here does not delete those copies.</p>
       <button className="ve-wide-btn ve-accent-btn" data-testid="share-ai-visual-review" disabled={!ai.connected||visualReviewBusy||busy||rendering||ai.applying||!clips.length} onClick={shareVisualReview}>{visualReviewBusy?'Preparing local preview frames…':'Share 6 preview frames with ChatGPT'}</button>
       {visualReviewInfo&&<div className="ve-note" data-testid="ai-visual-review-status"><strong>Preview frames shared:</strong> {visualReviewInfo.frames} still images. {visualReviewInfo.waveformAvailable?'Audio energy summary included.':'Audio energy summary unavailable.'}<ul>{visualReviewInfo.notes.map((n,i)=><li key={i}>{n}</li>)}</ul><button className="ve-wide-btn" onClick={clearVisualReview}>Revoke shared preview frames</button></div>}
       <p className="ve-note"><strong>Connect this to ChatGPT:</strong> In ChatGPT Plugins, choose + → Add custom MCP server. Enter the endpoint above, choose OAuth, and authorize with the <strong>same Google account</strong>. Install the resulting AutoCaption Studio plugin and select it in your next chat message. No session token needs to be copied into ChatGPT.</p>
       <p className="ve-note">Keep this editor tab open. The browser editing bridge currently expires after 30 minutes, so reconnect here if editing stops.</p>
       <button className="ve-wide-btn" onClick={async()=>{try{await fetch('/api/bridge/session',{method:'DELETE',headers:{Authorization:'Bearer '+bridgeToken}})}finally{setBridgeToken('');note('AI editing bridge disconnected')}}}>Disconnect AI bridge</button>
      </>}
      <p className="ve-note">AI edits never run automatically. You approve or reject each batch, then watch the timeline update. This browser connection alone does not connect the current ChatGPT chat; a compatible remote MCP connector is required.</p>
    </>}
    </div>
   </aside>
   <PanelSplitter label="Resize Project Files panel" value={panelLayout.left} min={210} max={750} onResize={resizeLeft} onReset={()=>setPanelLayout(p=>({...p,left:300}))}/>
   <section className="ve-monitor-panel"><div className="ve-monitor-head"><strong>{sourceViewer?'Source viewer':'Program monitor'}</strong>
  <div className="ve-monitor-aspect" aria-label="Canvas orientation">{['16:9','9:16','1:1'].map(a=><button key={a} aria-pressed={settings.aspect===a} title={a==='16:9'?'Landscape':a==='9:16'?'Portrait':'Square'} onClick={()=>setSettings(s=>({...s,aspect:a}))}>{a}</button>)}</div>
  <label className="ve-view-zoom">Canvas <input aria-label="Canvas view zoom" type="range" min="30" max="160" step="5" value={viewZoom} onChange={e=>setViewZoom(Number(e.target.value))}/>{viewZoom}%</label>
  {recordingTrackId&&<span className="ve-recording-banner">● REC {recordingTrackId}</span>}
  <span>{settings.fps} fps</span><button onClick={()=>setSourceViewer(false)} disabled={!sourceViewer}>Timeline preview</button></div>
     <div className="ve-monitor-area">{sourceViewer&&selectedAsset?.url?
       (selectedAsset.kind==='image'?<img className="ve-source-player" alt={selectedAsset.name} src={selectedAsset.url}/>:selectedAsset.kind==='audio'?<audio className="ve-source-audio" src={selectedAsset.url} controls/>:<video key={selectedAsset.id} className="ve-source-player" controls src={selectedAsset.url}/>)
       :<EditorPreview assets={assets} clips={clips} time={time} playing={playing} selectedId={selectedId} onSelect={id=>{setSelectedId(id);const clip=clips.find(c=>c.id===id);if(clip?.assetId)setSelectedAssetId(clip.assetId);setSourceViewer(false)}} aspect={settings.aspect} viewZoom={viewZoom} trackMuted={trackMuted} trackSolo={trackSolo} onTransformStart={transformStart} onTransform={transformLive} onTransformEnd={()=>{}}/>}
     </div><div className="ve-transport"><button onClick={()=>seek(0)} title="Go to start">⏮</button><button className="ve-play" onClick={togglePlay}>{playing?'❚❚':'▶'}</button><button onClick={()=>seek(Math.min(length,time+5))} title="Skip 5 seconds">⏭</button><span>{timeLabel(time)} / {timeLabel(length)}</span><div className="ve-transport-fill"/><span className="ve-status-mini">{playing?'PLAY':'EDIT'}</span></div>
   </section>
   {inspectorOpen&&<PanelSplitter label="Resize Inspector panel" value={panelLayout.inspector} min={220} max={700} onResize={resizeInspector} onReset={()=>setPanelLayout(p=>({...p,inspector:280}))}/>}
   {inspectorOpen&&<EditorInspector clip={currentClip} asset={currentAsset} settings={settings} onSettings={setSettings} onPatch={updateClip} onTransition={transition} onSplit={split} onDelete={removeClip} onDetachAudio={detachAudio} onSplitStereo={separateStereoChannels} onRippleDelete={rippleRemove} onAudioPreset={audioPreset} onNormalizeAudio={normalizeAudio} time={time}/>}
   <button className="ve-inspector-toggle" onClick={()=>setInspectorOpen(v=>!v)} title={inspectorOpen?'Hide inspector':'Show inspector'}>{inspectorOpen?'›':'‹'}</button>
  </div>
  <PanelSplitter axis="horizontal" label="Resize timeline height" value={panelLayout.timeline} min={200} max={850} onResize={resizeTimeline} onReset={()=>{setTimelineExpanded(false);setPanelLayout(p=>({...p,timeline:freshPanelLayout().timeline}))}}/>
  <EditorTimeline panelHeight={panelLayout.timeline} expanded={timelineExpanded} onToggleExpanded={toggleTimelineSize} tracks={tracks} clips={clips} assets={assets} time={time} zoom={zoom} setZoom={setZoom} onSeek={seek} onSelect={id=>{setSelectedId(id);setSourceViewer(false);const item=clipsRef.current.find(c=>c.id===id);if(item&&item.kind!=='motion'&&(timeRef.current<item.start||timeRef.current>=clipEnd(item))){timeRef.current=item.start+.01;setTime(timeRef.current);setPlaying(false)}}} selectedId={selectedId} onPlace={placeAsset} onMove={moveClip} onTrim={trim} onTrimStart={record} onTransition={transition} onRemove={removeClip} onSplit={split} onDuplicate={duplicateClip} onDetachAudio={detachAudio} onSplitStereo={separateStereoChannels} onRippleDelete={rippleRemove} onAddTitle={trackId=>addTitle("New text",trackId,3)} onPatch={updateClip} onAddTrack={addTrack} onRemoveTrack={removeTrack} trackMuted={trackMuted} trackSolo={trackSolo} onToggleTrackMute={trackMute} onToggleTrackSolo={trackSoloToggle} recordingTrackId={recordingTrackId} onToggleRecord={toggleRecord} onOpenInspector={id=>{setSelectedId(id);setInspectorOpen(true)}}/>
  <AIReviewPanel review={shownAI.review} applying={shownAI.applying} progress={shownAI.progress} recent={shownAI.recent} error={shownAI.error}
    onApprove={shownAI.approve} onReject={shownAI.reject} onRevert={shownAI.revert} onDismiss={shownAI.dismiss}/>
  <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={e=>{importFiles(e.target.files);e.target.value=''}}/>
  <input ref={audioInput} type="file" multiple hidden accept="audio/*" onChange={e=>{importFiles(e.target.files);e.target.value=''}}/>
  <div className="ve-shortcuts">SPACE play/pause · S split · DEL remove · CTRL+Z undo · Drag preview to move/resize · Overlap clips to crossfade · ● Record motion</div>
 </div>;
}
