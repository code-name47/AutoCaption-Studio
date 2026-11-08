import React,{useEffect,useMemo,useRef,useState} from 'react';
import {getActiveClip,totalDuration} from './timeline.js';
const fmt=n=>{const s=Math.max(0,Math.floor(n||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
export default function ProjectEditor({batchItems=[],batchResults=[],onStatus}){
 const [assets,setAssets]=useState([]),[track,setTrack]=useState([]),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[selected,setSelected]=useState(''),[loading,setLoading]=useState(false);
 const video=useRef(null),fileInput=useRef(null),assetsRef=useRef([]),trackRef=useRef([]),timeRef=useRef(0),playingRef=useRef(false);
 const total=useMemo(()=>totalDuration(track,assets),[track,assets]);
 const active=getActiveClip(track,assets,time);
 const currentAsset=assets.find(a=>a.id===active?.assetId);
 useEffect(()=>{assetsRef.current=assets},[assets]);
 useEffect(()=>{trackRef.current=track},[track]);
 useEffect(()=>{timeRef.current=time},[time]);
 useEffect(()=>{playingRef.current=playing},[playing]);
 useEffect(()=>()=>{assetsRef.current.forEach(a=>URL.revokeObjectURL(a.url))},[]);
 function importFiles(files){const incoming=Array.from(files||[]).filter(f=>f.type.startsWith('video/')||f.type.startsWith('audio/')).map(f=>({id:crypto.randomUUID(),name:f.name,url:URL.createObjectURL(f),duration:0,type:f.type,transcript:[]}));setAssets(a=>[...a,...incoming]);onStatus?.(incoming.length+' files imported into Project Files');}
 async function importDrive(item){if(loading)return;setLoading(true);try{const r=await fetch('/auth/google/file/'+encodeURIComponent(item.id));if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'Drive download failed')}const blob=await r.blob();const result=batchResults.find(x=>x.id===item.id);const asset={id:crypto.randomUUID(),driveId:item.id,name:item.name,url:URL.createObjectURL(blob),duration:0,type:blob.type||item.mimeType,transcript:result?.segments||[]};setAssets(a=>[...a,asset]);onStatus?.('Imported '+item.name+' into Project Files')}catch(e){onStatus?.(e.message)}finally{setLoading(false)}}
 function addToTrack(asset){setTrack(t=>[...t,{id:crypto.randomUUID(),assetId:asset.id}]);setSelected(asset.id)}
 function seek(t){const n=Math.max(0,Math.min(total,t));timeRef.current=n;setTime(n);const found=getActiveClip(trackRef.current,assetsRef.current,n);if(video.current&&found){if(video.current.dataset.assetId===found.assetId){video.current.currentTime=found.localTime}else{video.current.pause();setPlaying(false)}}}
 function onVideoTime(e){const v=e.currentTarget;const clips=trackRef.current;const a=assetsRef.current;let start=0;for(const clip of clips){const asset=a.find(x=>x.id===clip.assetId);const duration=asset?.duration||0;if(clip.assetId===v.dataset.assetId){const t=start+Math.min(duration,v.currentTime);timeRef.current=t;setTime(t);return}start+=duration}}
 function nextClip(){const clips=trackRef.current;const a=assetsRef.current;const current=getActiveClip(clips,a,timeRef.current);const idx=clips.findIndex(c=>c.id===current?.id);if(idx>=0&&idx<clips.length-1){const elapsed=clips.slice(0,idx+1).reduce((n,c)=>n+(a.find(x=>x.id===c.assetId)?.duration||0),0);timeRef.current=elapsed;setTime(elapsed)}else{setPlaying(false)}}
 useEffect(()=>{const v=video.current;if(!v||!active)return;const target=Math.max(0,active.localTime);if(Math.abs(v.currentTime-target)>.4){try{v.currentTime=target}catch{}}if(playing)v.play().catch(()=>setPlaying(false));else v.pause()},[active?.assetId,active?.id,playing]);
 function moveClip(index,dir){const next=index+dir;if(next<0||next>=track.length)return;setTrack(t=>{const x=[...t];[x[index],x[next]]=[x[next],x[index]];return x});setTime(0);setPlaying(false)}
 const selectedAsset=assets.find(a=>a.id===selected);
 return <section className="project-editor" aria-label="Project files and video timeline">
  <div className="project-title"><h2>Project Files</h2><span>Media bin · local preview · editing timeline</span></div>
  <div className="project-grid">
   <aside className="project-bin">
    <div className="project-actions"><button onClick={()=>fileInput.current?.click()}>+ Import files</button><input ref={fileInput} type="file" multiple accept="video/*,audio/*" hidden onChange={e=>{importFiles(e.target.files);e.target.value=''}}/></div>
    {batchItems.length>0&&<details><summary>Selected Drive videos ({batchItems.length})</summary>{batchItems.map(item=><button key={item.id} disabled={loading} onClick={()=>importDrive(item)}>+ {item.name}</button>)}</details>}
    {assets.length===0?<p className="muted">Import media here or select multiple Google Drive videos in Commands.</p>:assets.map(a=><div className={'project-asset '+(selected===a.id?'chosen':'')} key={a.id}><button onClick={()=>{setSelected(a.id);if(!track.length)addToTrack(a)}} title="Select media">{a.name} <small>{a.duration?fmt(a.duration):'Reading duration…'}</small></button><button onClick={()=>addToTrack(a)} title="Append clip to timeline">+ Track</button></div>)}
    {assets.map(a=><video key={'metadata-'+a.id} src={a.url} preload="metadata" style={{display:'none'}} onLoadedMetadata={e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)&&d>0)setAssets(old=>old.map(x=>x.id===a.id&&x.duration!==d?{...x,duration:d}:x))}}/>)}
   </aside>
   <div className="project-monitor"><div className="project-screen">{currentAsset?<video key={currentAsset.id} data-asset-id={currentAsset.id} ref={video} src={currentAsset.url} controls={false} playsInline onTimeUpdate={onVideoTime} onEnded={nextClip}/>:<div className="project-placeholder">Add a clip to the timeline to preview your sequence</div>}</div>
    <div className="project-transport"><button disabled={!active} onClick={()=>setPlaying(v=>!v)}>{playing?'❚❚ Pause':'▶ Play'}</button><span>{fmt(time)} / {fmt(total)}</span><button disabled={!track.length} onClick={()=>{setPlaying(false);seek(0)}}>↶ Start</button></div>
    {selectedAsset&&<p className="muted">Selected: {selectedAsset.name}{selectedAsset.transcript.length?' · transcript available':''}</p>}
   </div>
  </div>
  <div className="project-timeline"><div className="project-timeline-head"><strong>Timeline · Video Track 1</strong><span>Click or drag the playhead to scrub</span></div><input type="range" aria-label="Timeline playhead" min="0" max={Math.max(total,.01)} step=".05" value={Math.min(time,total)} onChange={e=>{setPlaying(false);seek(Number(e.target.value))}} disabled={!total}/>
   <div className="project-clips">{track.length?track.map((clip,i)=>{const a=assets.find(x=>x.id===clip.assetId);return <div className={'project-clip '+(active?.id===clip.id?'active':'')} key={clip.id} style={{flexGrow:Math.max(1,a?.duration||1)}}><button className="clip-main" onClick={()=>{setPlaying(false);const start=track.slice(0,i).reduce((n,c)=>n+(assets.find(x=>x.id===c.assetId)?.duration||0),0);seek(start)}}>{i+1}. {a?.name||'Missing clip'} <small>{fmt(a?.duration)}</small></button><div className="clip-controls"><button onClick={()=>moveClip(i,-1)} disabled={!i} title="Move earlier">←</button><button onClick={()=>moveClip(i,1)} disabled={i===track.length-1} title="Move later">→</button><button onClick={()=>{setTrack(t=>t.filter(x=>x.id!==clip.id));setPlaying(false);setTime(0)}} title="Remove from track">×</button></div></div>}):<p className="muted">Your timeline is empty. Add videos from Project Files.</p>}</div>
  </div>
  <p className="muted">Timeline playback is a non-destructive preview. Combined video export, trims, transitions, and AI editing commands are not implemented yet. Files stay in this browser tab.</p>
 </section>;
}
