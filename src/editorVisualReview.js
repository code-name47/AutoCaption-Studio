// Browser-only, opt-in preview frame sampler. The source videos never leave
// this device: only six low-resolution JPEG stills and optional RMS magnitudes
// are sent to the authenticated AI bridge when the user clicks Share.
import {activeClips,clipEnd,timelineDuration,transitionProgress} from './editorCore.js';
import {resolvedClip,visualClipOpacity,risingTextPosition} from './editorMotion.js';

const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const round=n=>Math.round(n*100)/100;

export function reviewSampleTimes(clips,maxFrames=6){
 const duration=timelineDuration(clips);
 if(!duration)return [];
 const videos=clips.filter(c=>c.kind==='video'&&!c.trackId.startsWith('A')).sort((a,b)=>a.start-b.start);
 const cuts=videos.slice(1).map(c=>c.start+Math.min(.24,(c.transitionDuration||.4)/2));
 const candidates=[Math.min(.6,duration*.15),Math.max(.05,duration-.4),...cuts,
  ...[.27,.5,.78,.12,.4,.64,.9].map(r=>duration*r)];
 const times=[];
 for(const candidate of candidates){
  const t=round(clamp(candidate,0,Math.max(0,duration-.04)));
  if(times.every(n=>Math.abs(n-t)>=Math.min(.32,duration/(maxFrames*2)))){
   times.push(t);if(times.length>=maxFrames)break;
  }
 }
 return times.sort((a,b)=>a-b);
}

// Best-effort text-to-transcript check. Does not assert word-level timestamp
// precision: Whisper browser output may contain only multi-second segments.
const words=value=>[...new Set(String(value||'').toLowerCase().match(/[a-z0-9']+/g)||[])].filter(w=>w.length>=3);
export function reviewTranscriptAlignment(clips,assets=[]){
 const byId=new Map(assets.map(a=>[a.id,a]));
 const captions=clips.filter(c=>c.kind==='text'&&c.trackId==='C1');
 const videos=clips.filter(c=>c.kind==='video'&&!c.trackId.startsWith('A'));
 const flags=[];let checked=0,missing=0;
 for(const caption of captions){
  const at=caption.start+(clipEnd(caption)-caption.start)/2;
  let best=null;
  for(const video of videos){
   if(at<video.start||at>clipEnd(video))continue;
   const source=byId.get(video.assetId);
   if(!source?.transcript?.length)continue;
   const begin=video.inPoint+(Math.max(caption.start,video.start)-video.start)*video.speed;
   const end=video.inPoint+(Math.min(clipEnd(caption),clipEnd(video))-video.start)*video.speed;
   const segments=source.transcript.filter(segment=>Number(segment.end)>=begin-.45&&Number(segment.start)<=end+.45);
   if(!segments.length)continue;
   const expected=new Set(words(segments.map(segment=>segment.text).join(' ')));
   const actual=words(caption.text),fraction=actual.length?actual.filter(w=>expected.has(w)).length/actual.length:1;
   if(!best||fraction>best.fraction)best={fraction,asset:source,actual};
  }
  if(!best){missing++;continue}
  checked++;
  if(best.actual.length>=2&&best.fraction<.36)
   flags.push('Possible transcript/caption mismatch near '+round(caption.start)+'s: "'+String(caption.text).slice(0,70)+'"');
 }
 return {checked,missing,flags:flags.slice(0,8)};
}

export function reviewTimelineNotes(clips,assets=[]){
 const notes=[],duration=timelineDuration(clips);
 const videos=clips.filter(c=>c.kind==='video'&&!c.trackId.startsWith('A'))
  .sort((a,b)=>a.start-b.start);
 const captions=clips.filter(c=>c.kind==='text'&&c.trackId==='C1').sort((a,b)=>a.start-b.start);
 for(let i=1;i<videos.length;i++){
  const previous=videos[i-1],current=videos[i];
  if(previous.trackId!==current.trackId)continue;
  const gap=current.start-clipEnd(previous);
  if(gap>.15)notes.push('Possible video gap: '+round(gap)+'s before '+round(current.start)+'s');
  else if(gap<-.1)notes.push('Video clips overlap by '+round(-gap)+'s around '+round(current.start)+'s');
 }
 for(let i=1;i<captions.length;i++){
  const lastEnd=clipEnd(captions[i-1]),start=captions[i].start;
  if(start-lastEnd>.15)notes.push('Caption gap of '+round(start-lastEnd)+'s at '+round(lastEnd)+'s');
  if(lastEnd-start>.12)notes.push('Caption overlap of '+round(lastEnd-start)+'s at '+round(start)+'s');
 }
 if(captions.length&&videos.length){
  const videoEnd=Math.max(...videos.map(clipEnd));
  const captionEnd=Math.max(...captions.map(clipEnd));
  if(videoEnd-captionEnd>.15)notes.push('Last caption ends '+round(videoEnd-captionEnd)+'s before the picture ends');
  if(captionEnd-videoEnd>.12)notes.push('Captions continue '+round(captionEnd-videoEnd)+'s beyond the video');
 }
 const transcriptAudit=reviewTranscriptAlignment(clips,assets);
 notes.push(...transcriptAudit.flags);
 if(captions.length&&transcriptAudit.checked===0)
  notes.push('Speech-to-caption alignment could not be checked: source transcripts are unavailable or do not overlap these cuts.');
 else if(transcriptAudit.checked>0)
  notes.push('Compared '+transcriptAudit.checked+' captions against source transcript segments; this is not word-accurate audio verification.');
  if(!captions.length)notes.push('No caption clips on the C1 track');
 if(!videos.length)notes.push('No video clips on the timeline');
 if(duration>600)notes.push('Timelines longer than 10 minutes are not supported by this preview sampler');
 return notes.slice(0,18);
}

const sleepForMedia=(video,event,timeout=8500)=>new Promise((resolve,reject)=>{
 let settled=false;
 const release=(error)=>{
  if(settled)return;settled=true;clearTimeout(timer);
  video.removeEventListener(event,onOk);video.removeEventListener('error',onError);
  error?reject(error):resolve();
 };
 const onOk=()=>release(),onError=()=>release(Error('Video could not be decoded'));
 const timer=setTimeout(()=>release(Error('Video frame timed out')),timeout);
 video.addEventListener(event,onOk,{once:true});
 video.addEventListener('error',onError,{once:true});
});

async function sourceNode(asset){
 if(!asset?.url)throw Error('Preview media is missing in this browser. Reopen the saved project.');
 if(asset.kind==='image'){
  const img=new Image();img.src=asset.url;await img.decode();return img;
 }
 const video=document.createElement('video');
 video.preload='auto';video.muted=true;video.playsInline=true;video.src=asset.url;
 if(video.readyState<1)await sleepForMedia(video,'loadedmetadata');
 return video;
}
async function sourceAt(video,seconds){
 if(!(video instanceof HTMLVideoElement))return;
 const point=clamp(seconds,0,Math.max(0,(video.duration||seconds)-.05));
 if(video.readyState>=2&&Math.abs(video.currentTime-point)<.04)return;
 const waiting=sleepForMedia(video,'seeked',8500);
 video.currentTime=point;
 await waiting;
 if(video.readyState<2)await sleepForMedia(video,'loadeddata',4000);
}
function fitImage(ctx,node,width,height){
 const w=node.videoWidth||node.naturalWidth||width,h=node.videoHeight||node.naturalHeight||height;
 const scale=Math.min(width/Math.max(1,w),height/Math.max(1,h));
 const dw=w*scale,dh=h*scale;
 ctx.drawImage(node,(width-dw)/2,(height-dh)/2,dw,dh);
}
function drawCaption(ctx,clip,width,height,time){
 ctx.save();
 const size=clamp(clip.fontSize??42,1,500)*width/1280;
 const lines=String(clip.text||'').split('\n');
 ctx.fillStyle=clip.fontColor||'#ffffff';
 ctx.font=(clip.fontWeight||700)+' '+Math.max(.5,size)+'px '+(clip.fontFamily||'Arial');
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.88)';ctx.shadowBlur=8;
 const lineHeight=Math.max(18,size*1.3),offset=(lines.length-1)*lineHeight/2;
 const y=risingTextPosition(clip,time)/100*height;
 for(let i=0;i<lines.length;i++)ctx.fillText(lines[i],width/2,y-offset+i*lineHeight,width*.92);
 ctx.restore();
}
async function paintFrame(ctx,clips,assetsById,nodes,time,width,height){
 ctx.save();ctx.fillStyle='#000000';ctx.fillRect(0,0,width,height);
 for(const original of activeClips(clips,time)){
  if(original.kind==='audio'||original.trackId.startsWith('A'))continue;
  const clip=resolvedClip(original,clips,time);
  const alpha=visualClipOpacity(clip,clips,time);
  if(alpha<=0)continue;
  let node=null;
  if(clip.kind==='video'||clip.kind==='image'){
   const asset=assetsById.get(clip.assetId);
   if(!asset?.url)continue;
   if(!nodes.has(asset.id))nodes.set(asset.id,await sourceNode(asset));
   node=nodes.get(asset.id);
   if(clip.kind==='video')await sourceAt(node,clip.inPoint+(time-clip.start)*clip.speed);
  }
  ctx.save();ctx.globalAlpha=alpha;
  const progress=transitionProgress(clip,time);
  if(clip.transitionIn==='wipe'){ctx.beginPath();ctx.rect(0,0,width*progress,height);ctx.clip()}
  if(clip.transitionIn==='slide')ctx.translate(width*(1-progress),0);
  ctx.translate(width/2,height/2);
  ctx.translate(width*(clip.offsetX||0)/100,height*(clip.offsetY||0)/100);
  ctx.rotate((clip.rotation||0)*Math.PI/180);
  ctx.scale(clip.scale||1,clip.scale||1);ctx.translate(-width/2,-height/2);
  ctx.filter='brightness('+(clip.brightness??1)+') contrast('+(clip.contrast??1)+') saturate('+(clip.saturation??1)+')';
  if(clip.kind==='text')drawCaption(ctx,clip,width,height,time);
  else if(node)fitImage(ctx,node,width,height);
  ctx.restore();
 }
 ctx.restore();
}

async function smallWaveform(assets,clips,duration){
 // Optional: never transmit raw PCM, and avoid decoding huge source files.
 const sources=new Map(),context=new (window.AudioContext||window.webkitAudioContext)();
 try{
  const media=clips.filter(c=>['video','audio'].includes(c.kind)&&!c.muted&&c.volume>0);
  for(const c of media){
   const asset=assets.find(a=>a.id===c.assetId);
   if(!asset?.file||asset.file.size>24*1024*1024)continue;
   if(sources.has(asset.id))continue;
   try{const decoded=await context.decodeAudioData(await asset.file.arrayBuffer());
    sources.set(asset.id,decoded.getChannelData(0));sources.set(asset.id+':rate',decoded.sampleRate);
   }catch{/* Audio codecs are not supported in every browser. Never block image sharing. */}
  }
  if(![...sources.keys()].some(k=>!k.endsWith(':rate')))return null;
  const samples=[];
  for(let i=0;i<72;i++){
   const t=duration*(i+.5)/72;
   let energy=0;
   for(const c of media){
    if(t<c.start||t>=clipEnd(c))continue;
    const pcm=sources.get(c.assetId),rate=sources.get(c.assetId+':rate');
    if(!pcm||!rate)continue;
    const tSource=c.inPoint+(t-c.start)*c.speed;
    const start=Math.floor(tSource*rate),end=Math.min(pcm.length,start+Math.floor(rate*.09));
    if(start<0||start>=end)continue;
    let square=0,count=0;
    for(let j=start;j<end;j+=Math.max(1,Math.floor(rate/700))){
     square+=pcm[j]*pcm[j];count++;
    }
    energy+=Math.sqrt(square/Math.max(1,count))*(c.volume??1);
   }
   samples.push(Math.round(clamp(energy,0,1)*1000)/1000);
  }
  return samples;
 }finally{await context.close().catch(()=>{})}
}

export async function captureVisualReview({assets,clips,settings}){
 const duration=timelineDuration(clips);
 if(!duration||duration>600)throw Error('Visual review supports non-empty timelines under 10 minutes.');
 const times=reviewSampleTimes(clips);
 const [width,height]=settings.aspect==='9:16'?[360,640]:settings.aspect==='1:1'?[480,480]:[640,360];
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{alpha:false});
 if(!ctx)throw Error('Canvas preview inspection is unavailable in this browser.');
 const nodes=new Map(),assetsById=new Map(assets.map(a=>[a.id,a]));
 const frames=[],notes=reviewTimelineNotes(clips,assets);
 try{
  for(const t of times){
   await paintFrame(ctx,clips,assetsById,nodes,t,width,height);
   let data='',quality=.74;
   do{
    data=canvas.toDataURL('image/jpeg',quality).split(',')[1]||'';
    quality-=.13;
   }while(data.length>145000&&quality>.2);
   if(!data||data.length>145000)throw Error('Preview JPEG exceeds the private sharing limit');
   const caption=activeClips(clips,t).filter(c=>c.kind==='text').map(c=>c.text).join(' / ');
   frames.push({time:t,width,height,mimeType:'image/jpeg',data,caption:caption.slice(0,200)});
  }
 }finally{
  for(const node of nodes.values())if(node instanceof HTMLVideoElement){
   node.pause();node.removeAttribute('src');node.load();
  }
 }
 const waveform=await smallWaveform(assets,clips,duration).catch(()=>null);
 if(!waveform)notes.push('Audio waveform unavailable in this browser; preview contains still frames only');
 return {frames,notes:notes.slice(0,18),waveform};
}
