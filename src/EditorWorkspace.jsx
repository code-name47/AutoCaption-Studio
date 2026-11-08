import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {decodeMediaToMono16k} from './audio.js';
import {TRACKS,accepts,newClip,clipEnd,clipLength,activeClips,splitClip,trimClip,placeClip,addTransition,serializeProject,isValidProject,timelineDuration} from './editorCore.js';
import {saveBrowserProject,loadBrowserProject} from './projectStorage.js';
import EditorPreview from './EditorPreview.jsx';
import EditorTimeline from './EditorTimeline.jsx';
import EditorInspector from './EditorInspector.jsx';
import {renderProjectToWebM} from './editorExport.js';
import {makeMediaThumbnail} from './mediaThumbnails.js';
import './editorWorkspace.css';

const uid=()=>globalThis.crypto?.randomUUID?.()||'id-'+Math.random().toString(36).slice(2);
const blankSettings={aspect:'16:9',fps:30};
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
const TRANSITIONS=[{id:'none',label:'Hard cut'},{id:'crossfade',label:'Cross dissolve'},{id:'fade',label:'Fade in'},{id:'wipe',label:'Wipe reveal'},{id:'slide',label:'Slide right'}];
export default function EditorWorkspace(){
 const [name,setName]=useState('Untitled project'),[settings,setSettings]=useState(blankSettings),[tracks,setTracks]=useState(TRACKS),
 [assets,setAssets]=useState([]),[clips,setClips]=useState([]),[selectedId,setSelectedId]=useState(''),[selectedAssetId,setSelectedAssetId]=useState(''),
 [sourceViewer,setSourceViewer]=useState(false),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),
 [zoom,setZoom]=useState(36),[tab,setTab]=useState('media'),[inspectorOpen,setInspectorOpen]=useState(true),
 [trackMuted,setTrackMuted]=useState({}),[status,setStatus]=useState('Ready'),[busy,setBusy]=useState(false),
 [model,setModel]=useState('tiny'),[googleAccount,setGoogleAccount]=useState(''),[bridgeToken,setBridgeToken]=useState(''),
 [rendering,setRendering]=useState(false),[renderProgress,setRenderProgress]=useState(0),[historyVersion,setHistoryVersion]=useState(0);
 const input=useRef(null),audioInput=useRef(null),assetRef=useRef([]),fileImportActive=useRef(false),transcriptionWorker=useRef(null);
 const timeRef=useRef(0),playRef=useRef(false),past=useRef([]),future=useRef([]),clipsRef=useRef([]);
 const currentClip=clips.find(c=>c.id===selectedId);
 const currentAsset=assets.find(a=>a.id===currentClip?.assetId);
 const selectedAsset=assets.find(a=>a.id===selectedAssetId);
 const length=useMemo(()=>timelineDuration(clips),[clips]);
 useEffect(()=>{document.body.classList.add('ve-app-mode');return()=>document.body.classList.remove('ve-app-mode')},[]);
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
  function frame(now){const next=from+(now-began)/1000;if(next>=length){setTime(Math.max(0,length-.01));setPlaying(false);return}
   if(now-previous>28){timeRef.current=next;setTime(next);previous=now}animation=requestAnimationFrame(frame)}
  animation=requestAnimationFrame(frame);return()=>cancelAnimationFrame(animation);
 },[playing,length]);
 function togglePlay(){if(sourceViewer){setSourceViewer(false);setPlaying(true);return}if(!clips.length){note('Add a clip to a track to play the timeline.');return}if(timeRef.current>=length-.05){setTime(0);timeRef.current=0}setPlaying(v=>!v)}
 function removeClip(id){record();setClips(cs=>cs.filter(c=>c.id!==id));if(selectedId===id)setSelectedId('');setPlaying(false)}
 function updateClip(id,patch){record();setClips(cs=>cs.map(c=>c.id===id?{...c,...patch}:c))}
 function placeAsset(assetId,trackId,at){
  const a=assets.find(x=>x.id===assetId);
  if(!a||!accepts(a,trackId)){note('This media type cannot be placed on that track.');return}
  record();const c=newClip(a,trackId,at,uid());setClips(cs=>[...cs,c]);setSelectedId(c.id);setSourceViewer(false);note(a.name+' added to '+trackId);
 }
 function moveClip(id,trackId,at){const c=clips.find(x=>x.id===id);const asset=assets.find(a=>a.id===c?.assetId);if(!c||!accepts(asset||{kind:c.kind},trackId)){note('Incompatible track type');return}record();setClips(cs=>placeClip(cs,id,trackId,at,8/zoom));setSelectedId(id);setSourceViewer(false)}
 function split(id){const c=clips.find(x=>x.id===id);const parts=splitClip(c,timeRef.current,uid());if(!parts){note('Move the playhead inside the selected clip before splitting.');return}record();setClips(cs=>cs.flatMap(x=>x.id===id?parts:[x]));setSelectedId(parts[1].id);note('Clip split at '+timeLabel(timeRef.current))}
 function trim(id,edge,delta,original){const asset=assets.find(x=>x.id===original.assetId);setClips(cs=>cs.map(c=>c.id===id?trimClip(original,edge,delta,asset?.duration):c))}
 function transition(id,type,duration){record();setClips(cs=>addTransition(cs,id,type,duration));setSelectedId(id);note(type==='none'?'Transition removed':type+' transition applied')}
 function addTrack(kind){const prefix=kind==='audio'?'A':'V',count=tracks.filter(t=>t.id.startsWith(prefix)).length;if(count>=12){note('Maximum 12 '+kind+' tracks');return}const number=tracks.reduce((m,t)=>t.id.startsWith(prefix)?Math.max(m,Number(t.id.slice(1))):m,0)+1;const track={id:prefix+number,label:(kind==='audio'?'Audio ':'Video ')+number,kind,z:kind==='audio'?0:number*10};setTracks(old=>kind==='audio'?[...old,track]:[track,...old]);note('Added '+track.label)}
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
  setAssets(a=>[...a,...collected]);populateThumbnails(collected);if(collected.length)setSelectedAssetId(collected[0].id);
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
   setAssets(a=>[...a,...collected]);if(collected.length)setSelectedAssetId(collected[0].id);note(collected.length+' Drive files added. Drag them onto the timeline.');
   }finally{fileImportActive.current=false;setBusy(false)}
  })}catch(e){note(e.message)}
 }
 async function logoutGoogle(){const r=await fetch('/auth/google/logout',{method:'POST'});if(!r.ok){note('Could not disconnect Google');return}setGoogleAccount('');setBridgeToken('');note('Google disconnected. Existing loaded media remains in this local project.')}
 async function connectAI(){try{const r=await fetch('/api/bridge/session',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not connect');setBridgeToken(d.token);note('Temporary AI bridge session created. External editor tools are not enabled yet.')}catch(e){note(e.message)}}
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
  try{const metadata=serializeProject(name,assets,clips,{...settings,tracks,trackMuted});await saveBrowserProject(metadata,assets);note('Project saved in this browser. It is not uploaded to the cloud.')}
  catch(e){note('Save failed: '+(e?.name==='QuotaExceededError'?'Browser storage quota exceeded. Try a smaller project.':e.message))}finally{setBusy(false)}
 }
 async function loadProject(){
  if(busy)return;setBusy(true);
  try{const p=await loadBrowserProject();if(!p){note('No saved project found in this browser.');return}
   if(!isValidProject(p))throw Error('Saved project format is invalid');
   setPlaying(false);for(const a of assetRef.current)if(a.url)URL.revokeObjectURL(a.url);
   setAssets(p.assets);populateThumbnails(p.assets.filter(a=>a.url));setClips(p.clips);setName(p.name);
   setSettings({aspect:p.settings?.aspect||'16:9',fps:Number(p.settings?.fps)||30});
   setTracks(Array.isArray(p.settings?.tracks)&&p.settings.tracks.length?p.settings.tracks:TRACKS);
   setTrackMuted(p.settings?.trackMuted||{});
   setSelectedId('');setSelectedAssetId('');setSourceViewer(false);setTime(0);timeRef.current=0;past.current=[];future.current=[];
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
  try{const blob=await renderProjectToWebM({assets,clips,settings,trackMuted,onProgress:p=>setRenderProgress(p)});
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
 return <div className="ve-shell">
  <header className="ve-topbar">
   <div className="ve-logo"><span>◉</span> AUTOCAPTION <b>STUDIO</b><small>EDIT</small></div>
   <div className="ve-top-separator"/>
   <input className="ve-project-name" aria-label="Project name" value={name} onChange={e=>setName(e.target.value.slice(0,90))}/>
   <span className="ve-top-state" title={status}>{status}</span>
   <div className="ve-top-actions">
    <button title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
    <button title="Redo (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>
    <button onClick={saveProject} disabled={busy||rendering}>Save</button>
    <button className="ve-accent-btn" onClick={()=>setTab('export')}>Export</button>
    <a href="/?classic=1" title="Original transcription and batch-processing view">Classic</a>
   </div>
  </header>
  <div className="ve-main">
   <aside className="ve-left">
    <nav className="ve-side-tabs" aria-label="Editor panels">{TABS.map(t=><button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)} title={t.label}><span>{t.icon}</span><small>{t.label}</small></button>)}</nav>
    <div className="ve-left-content">
    {tab==='media'&&<><div className="ve-pane-heading"><b>Project Files</b><small>{assets.length} assets</small></div>
     <div className="ve-media-actions"><button className="ve-accent-btn" onClick={()=>input.current?.click()}>+ Import media</button><button onClick={importFromDrive} disabled={busy}>Google Drive</button></div>
     <p className="ve-hint">Drag a file onto a video or audio track. Click a file to preview it.</p>
     <div className="ve-media-items">{assets.length===0?<div className="ve-empty-bin">No media yet. Import videos, audio, or images to begin.</div>:assets.map(a=><div key={a.id} className={'ve-media-item '+(selectedAssetId===a.id?'selected':'')} draggable
      onDragStart={e=>{e.dataTransfer.setData('application/x-acs-asset',a.id);e.dataTransfer.effectAllowed='copy'}}
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
      <button className="ve-wide-btn" onClick={addCaptionsFromAsset} disabled={!(selectedAsset||currentAsset)?.transcript?.length}>Place subtitles on C1 track</button>
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
      <p className="ve-hint">Connect Google Drive for media import. Connecting an AI assistant to edit the timeline will require additional OAuth authorization and a secure edit-command API.</p>
      {googleAccount?<><div className="ve-connected">● Google: {googleAccount}</div><button className="ve-wide-btn" onClick={importFromDrive}>Import Drive videos</button><button className="ve-wide-btn" onClick={logoutGoogle}>Disconnect Google</button></>:<a className="ve-wide-link" href="/auth/google/start">Connect Google account</a>}
      <hr/><button className="ve-wide-btn" onClick={connectAI} disabled={!!bridgeToken}>{bridgeToken?'Temporary bridge active':'Create test MCP bridge session'}</button>
      {bridgeToken&&<button className="ve-wide-btn" onClick={()=>navigator.clipboard.writeText(bridgeToken)}>Copy private session token</button>}
      <p className="ve-note">The existing experimental MCP bridge supports transcription jobs only. It cannot control this editor yet. Never share a session token publicly.</p>
    </>}
    </div>
   </aside>
   <section className="ve-monitor-panel"><div className="ve-monitor-head"><strong>{sourceViewer?'Source viewer':'Program monitor'}</strong><span>{settings.aspect} · {settings.fps} fps</span><button onClick={()=>setSourceViewer(false)} disabled={!sourceViewer}>Timeline preview</button></div>
     <div className="ve-monitor-area">{sourceViewer&&selectedAsset?.url?
       (selectedAsset.kind==='image'?<img className="ve-source-player" alt={selectedAsset.name} src={selectedAsset.url}/>:selectedAsset.kind==='audio'?<audio className="ve-source-audio" src={selectedAsset.url} controls/>:<video key={selectedAsset.id} className="ve-source-player" controls src={selectedAsset.url}/>)
       :<EditorPreview assets={assets} clips={clips} time={time} playing={playing} selectedId={selectedId} onSelect={id=>{setSelectedId(id);const clip=clips.find(c=>c.id===id);if(clip?.assetId)setSelectedAssetId(clip.assetId);setSourceViewer(false)}} aspect={settings.aspect} trackMuted={trackMuted}/>}
     </div><div className="ve-transport"><button onClick={()=>seek(0)} title="Go to start">⏮</button><button className="ve-play" onClick={togglePlay}>{playing?'❚❚':'▶'}</button><button onClick={()=>seek(Math.min(length,time+5))} title="Skip 5 seconds">⏭</button><span>{timeLabel(time)} / {timeLabel(length)}</span><div className="ve-transport-fill"/><span className="ve-status-mini">{playing?'PLAY':'EDIT'}</span></div>
   </section>
   {inspectorOpen&&<EditorInspector clip={currentClip} asset={currentAsset} settings={settings} onSettings={setSettings} onPatch={updateClip} onTransition={transition} onSplit={split} onDelete={removeClip} time={time}/>}
   <button className="ve-inspector-toggle" onClick={()=>setInspectorOpen(v=>!v)} title={inspectorOpen?'Hide inspector':'Show inspector'}>{inspectorOpen?'›':'‹'}</button>
  </div>
  <EditorTimeline tracks={tracks} clips={clips} assets={assets} time={time} zoom={zoom} setZoom={setZoom} onSeek={seek} onSelect={id=>{setSelectedId(id);setSourceViewer(false)}} selectedId={selectedId} onPlace={placeAsset} onMove={moveClip} onTrim={trim} onTrimStart={record} onTransition={transition} onRemove={removeClip} onAddTrack={addTrack} trackMuted={trackMuted} onToggleTrackMute={trackMute}/>
  <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={e=>{importFiles(e.target.files);e.target.value=''}}/>
  <input ref={audioInput} type="file" multiple hidden accept="audio/*" onChange={e=>{importFiles(e.target.files);e.target.value=''}}/>
  <div className="ve-shortcuts">SPACE play/pause · S split · DEL remove · CTRL+Z undo · Drag clip edges to trim</div>
 </div>;
}
