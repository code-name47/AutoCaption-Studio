import {useCallback,useEffect,useRef,useState} from 'react';
import {applyEditorAction,previewEditorActions} from './aiEditCommands.js';

const WAIT_BETWEEN_STEPS=550;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** A visible, approval-gated local editing agent that polls only its own bridge session. */
export default function useLiveAIEditor({token,project,onStart,onStep,onRestore,onNotice,onExpired,canApply=true}){
 const context=useRef({project,onStart,onStep,onRestore,onNotice,onExpired,canApply});
 context.current={project,onStart,onStep,onRestore,onNotice,onExpired,canApply};
 const [review,setReview]=useState(null),[applying,setApplying]=useState(false);
 const [progress,setProgress]=useState(null),[error,setError]=useState('');
 const [recent,setRecent]=useState(null),[connected,setConnected]=useState(false);
 const tokenRef=useRef(token),busyRef=useRef(false),reviewRef=useRef(null);
 tokenRef.current=token;reviewRef.current=review;
 const projectString=JSON.stringify(project);
 const request=useCallback(async (path,init={})=>{
  const response=await fetch('/api/bridge'+path,{
   ...init,
   cache:'no-store',
   headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenRef.current,...init.headers}
  });
  let data;
  try{data=await response.json()}catch{data={error:'Bridge API is unavailable. Use the deployed application, not a Vite-only preview.'}}
  if(!response.ok){
   const err=new Error(data.error||'Bridge request failed');
   if(response.status===401)context.current.onExpired?.();
   throw err;
  }
  return data;
 },[]);
 // Publish the current editable state after local changes. No media bytes leave IndexedDB.
 useEffect(()=>{
  if(!token||busyRef.current)return;
  let cancelled=false;
  const handle=setTimeout(async()=>{
   try{
    const data=await request('/editor/snapshot',{method:'POST',body:JSON.stringify({project:context.current.project})});
    if(!cancelled){setConnected(Boolean(data.connected));setError('')}
   }catch(e){if(!cancelled){setConnected(false);setError(e.message)}}
  },200);
  return()=>{cancelled=true;clearTimeout(handle)};
 },[token,projectString,request]);
 // Heartbeat: keep the Google-owned browser visible to the ChatGPT connection.
 // Also refreshes the snapshot after local edits without transmitting any source footage.
 useEffect(()=>{
  if(!token)return;
  const tick=setInterval(async()=>{
   if(busyRef.current)return;
   try{
    const data=await request('/editor/snapshot',{method:'POST',body:JSON.stringify({project:context.current.project})});
    setConnected(Boolean(data.connected));
   }catch(e){setConnected(false);setError(e.message)}
  },5000);
  return()=>clearInterval(tick);
 },[token,request]);
 // Poll queued proposals. The browser stays interactive until the user explicitly approves.
 useEffect(()=>{
  if(!token){setReview(null);setConnected(false);setProgress(null);return}
  let cancelled=false,waiting=false;
  async function poll(){
   if(waiting||busyRef.current)return;waiting=true;
   try{
    const data=await request('/editor/pending');
    if(!cancelled){
     setReview(old=>{
      if(data.edit?.id===old?.id)return old;
      return data.edit||null;
     });
    }
   }catch(e){if(!cancelled)setError(e.message)}
   finally{waiting=false}
  }
  const timer=setInterval(poll,1200);poll();
  return()=>{cancelled=true;clearInterval(timer)};
 },[token,request]);
 const approve=useCallback(async()=>{
  const pending=reviewRef.current;
  if(!pending||busyRef.current)return;
  if(!context.current.canApply){setError('Finish recording, importing, or exporting before approving AI edits.');return}
  busyRef.current=true;setApplying(true);setError('');setProgress({index:0,total:pending.actions.length,description:'Confirming project version'});
  const original=context.current.project;
  let claimed=false,done=0;
  try{
   // Revalidate all steps atomically before touching the actual editor.
   previewEditorActions(original,pending.actions);
   const published=await request('/editor/snapshot',{method:'POST',body:JSON.stringify({project:original})});
   if(published.revision!==pending.baseRevision)throw Error('The timeline changed. Ask for a fresh AI proposal.');
   await request('/editor/edits/'+encodeURIComponent(pending.id)+'/review',{method:'POST',body:JSON.stringify({decision:'approve'})});
   claimed=true;
   context.current.onStart?.();
   let current=original;
   for(const action of pending.actions){
    const step=applyEditorAction(current,action);
    current=step.project;
    context.current.onStep(step);
    done++;
    setProgress({index:done,total:pending.actions.length,description:step.description});
    await request('/editor/edits/'+encodeURIComponent(pending.id)+'/progress',{
     method:'POST',body:JSON.stringify({status:'applying',progress:done})
    });
    // The playhead, preview and timeline repaint between each operation.
    if(done<pending.actions.length)await delay(WAIT_BETWEEN_STEPS);
   }
   // The busy guard prevents per-frame uploads. Publish the final state explicitly.
   await request('/editor/snapshot',{method:'POST',body:JSON.stringify({project:current})});
   await request('/editor/edits/'+encodeURIComponent(pending.id)+'/progress',{
    method:'POST',body:JSON.stringify({status:'complete',progress:done})
   });
   setRecent({id:pending.id,summary:pending.summary,before:original,after:current});
   setProgress({index:done,total:done,description:'All edits applied'});
   setReview(null);context.current.onNotice?.('AI edit applied. Review the timeline, then save the project.');
  }catch(e){
   if(claimed){
    context.current.onRestore(original);
    try{await request('/editor/edits/'+encodeURIComponent(pending.id)+'/progress',{
     method:'POST',body:JSON.stringify({status:'failed',progress:done,message:String(e.message).slice(0,280)})
    })}catch{}
   }
   setReview(null);setError(e.message);
   context.current.onNotice?.('AI edit stopped: '+e.message);
  }finally{busyRef.current=false;setApplying(false)}
 },[request]);
 const reject=useCallback(async()=>{
  const pending=reviewRef.current;
  if(!pending||busyRef.current)return;
  try{
   await request('/editor/edits/'+encodeURIComponent(pending.id)+'/review',{
    method:'POST',body:JSON.stringify({decision:'reject'})
   });
   setReview(null);setError('');context.current.onNotice?.('AI proposal rejected. No changes made.');
  }catch(e){setError(e.message)}
 },[request]);
 const demo=useCallback(async()=>{
  if(!tokenRef.current)return;
  try{setError('');const edit=await request('/editor/demo',{method:'POST',body:'{}'});setReview(edit)}
  catch(e){setError(e.message)}
 },[request]);
 const revert=useCallback(()=>{
  if(!recent||busyRef.current)return;
  if(JSON.stringify(context.current.project)!==JSON.stringify(recent.after)){
   setError('The project changed since this AI batch. Undo manually to avoid losing later edits.');return;
  }
  context.current.onStart?.();
  context.current.onRestore(recent.before);
  setRecent(null);setProgress(null);
  context.current.onNotice?.('Last AI edit batch reverted.');
 },[recent]);
 useEffect(()=>{if(!token){setReview(null);setError('');setRecent(null);setProgress(null)}},[token]);
 const dismiss=useCallback(()=>{if(!busyRef.current){setRecent(null);setError('');setProgress(null)}},[]);
 return {review,applying,progress,error,recent,connected,approve,reject,demo,revert,dismiss};
}
