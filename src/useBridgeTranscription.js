import {useEffect,useRef} from 'react';
import {decodeMediaToMono16k} from './audio.js';

/**
 * Runs only the per-asset transcription jobs queued by the authenticated MCP
 * session. Audio and video bytes never leave the browser; only timestamped
 * transcript text is returned to the same user's private bridge session.
 */
export default function useBridgeTranscription({token,assetsRef,busy,onBusy,onSegments,onNotice}){
 const context=useRef({assetsRef,busy,onBusy,onSegments,onNotice});
 context.current={assetsRef,busy,onBusy,onSegments,onNotice};
 useEffect(()=>{
  if(!token)return;
  let stopped=false,working=false,worker=null;
  const request=async(path,init={})=>{
   const res=await fetch('/api/bridge'+path,{
    ...init,cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.error||'AI transcription bridge request failed');
   return data;
  };
  async function poll(){
   if(stopped||working||context.current.busy)return;
   working=true;
   let claimedId=null;
   try{
    const queue=await request('/jobs');
    const job=queue.jobs?.find(j=>j.action==='transcribe'&&j.asset_id);
    if(!job||stopped)return;
    const asset=context.current.assetsRef.current.find(a=>a.id===job.asset_id);
    await request('/jobs/'+encodeURIComponent(job.id)+'/claim',{method:'POST',body:'{}'});
    claimedId=job.id;
    if(!asset?.file||!['video','audio'].includes(asset.kind))throw Error('Media is not loaded in this browser. Reimport the original file.');
    if(asset.duration>600)throw Error('Transcription is limited to media under 10 minutes');
    context.current.onBusy(true);
    context.current.onNotice('AI: Preparing '+asset.name+' for local transcription…');
    const audio=await decodeMediaToMono16k(asset.file,message=>context.current.onNotice('AI: '+asset.name+' — '+message));
    if(stopped)throw Error('Browser connection closed during transcription');
    worker=new Worker(new URL('./transcription.worker.js',import.meta.url),{type:'module'});
    const transcript=await new Promise((resolve,reject)=>{
     worker.onerror=()=>reject(Error('Whisper transcription worker failed'));
     worker.onmessage=e=>{
      const msg=e.data||{};
      if(msg.type==='loading')context.current.onNotice('AI: Loading Whisper '+job.model+' model…');
      if(msg.type==='processing')context.current.onNotice('AI: Transcribing '+asset.name+'…');
      if(msg.type==='error')reject(Error(msg.message||'Whisper transcription failed'));
      if(msg.type==='complete')resolve(msg.result||{});
     };
     worker.postMessage({type:'transcribe',model:job.model||'base',audio:audio.buffer},[audio.buffer]);
    });
    const segments=(transcript.segments?.length?transcript.segments:
      [{start:0,end:asset.duration,text:transcript.text||''}])
      .map(seg=>({start:Number(seg.start),end:Number(seg.end),text:String(seg.text||'').trim()}))
      .filter(seg=>Number.isFinite(seg.start)&&Number.isFinite(seg.end)&&seg.start>=0&&seg.end>=seg.start);
    if(stopped)throw Error('Browser connection closed during transcription');
    await request('/jobs/'+encodeURIComponent(job.id)+'/result',{
     method:'POST',body:JSON.stringify({segments})
    });
    context.current.onSegments(asset.id,segments);
    context.current.onNotice('AI: Transcribed '+asset.name+' ('+segments.length+' timestamped segments). ChatGPT can now read it.');
   }catch(e){
    if(claimedId){
     try{await request('/jobs/'+encodeURIComponent(claimedId)+'/result',{
      method:'POST',body:JSON.stringify({error:String(e.message||e).slice(0,300)})
     })}catch{}
    }
    if(!stopped)context.current.onNotice('AI transcription: '+String(e.message||e));
   }finally{
    worker?.terminate();worker=null;
    if(claimedId)context.current.onBusy(false);
    working=false;
   }
  }
  const interval=setInterval(poll,1800);
  poll();
  return()=>{stopped=true;clearInterval(interval);worker?.terminate()};
 },[token]);
}
