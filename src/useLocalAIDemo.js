import {useRef,useState,useCallback} from 'react';
import {applyEditorAction,previewEditorActions} from './aiEditCommands.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// This preview demonstrates the SAME editing reducer without requiring Google
// login, credentials, a remote AI client, or any network connection.
// It is a scripted sample command batch, NOT an autonomous AI agent.
export default function useLocalAIDemo({project,onStart,onStep,onRestore,onNotice,canApply,remoteActive}){
 const stateRef=useRef(null);
 const [review,setReview]=useState(null);
 const [applying,setApplying]=useState(false);
 const [progress,setProgress]=useState(null);
 const [recent,setRecent]=useState(null);
 const [error,setError]=useState('');
 const current=useRef({project,onStart,onStep,onRestore,onNotice,canApply,remoteActive});
 current.current={project,onStart,onStep,onRestore,onNotice,canApply,remoteActive};
 const queue=useCallback(()=>{
  const p=current.current.project;
  if(stateRef.current?.running||current.current.remoteActive){setError('Finish the current AI edit review before starting a sample.');return}
  if(!current.current.canApply){setError('Finish importing, recording, or exporting before starting the sample.');return}
  const actions=[];
  const first=p.clips.find(c=>c.kind!=='motion'&&c.trackId.startsWith('V'));
  if(first)actions.push({type:'move_clip',clip_id:first.id,start:5});
  actions.push({type:'set_canvas',aspect:p.settings.aspect==='9:16'?'16:9':'9:16'});
  actions.push({type:'add_text',text:'AI EDITED THIS VIDEO',track_id:'T1',start:5,duration:3});
  try{
   const preview=previewEditorActions(p,actions);
   const pending={id:'local-ai-demo',summary:'Sample AI command run (no login): change canvas and add a title'+(first?', move the first video clip to 5s':''),
     steps:preview.steps,actions};
   stateRef.current={before:p,after:preview.project,actions,running:false};
   setError('');setRecent(null);setProgress(null);setReview(pending);
   current.current.onNotice('Sample AI edit proposal ready. Review it in the editor.');
  }catch(e){setError(e.message)}
 },[]);
 const reject=useCallback(()=>{
  if(stateRef.current?.running)return;
  stateRef.current=null;setReview(null);setError('');
  current.current.onNotice('Sample AI edit rejected; timeline unchanged.');
 },[]);
 const approve=useCallback(async()=>{
  const proposed=stateRef.current;
  if(!proposed||proposed.running)return;
  if(!current.current.canApply){setError('Finish current media operations before approving.');return}
  if(JSON.stringify(proposed.before)!==JSON.stringify(current.current.project)){
   setError('Project changed after proposal. Reject and create a fresh sample.');return;
  }
  proposed.running=true;setReview(null);setApplying(true);setProgress({index:0,total:proposed.actions.length,description:'Starting sample AI edit'});
  try{
   current.current.onStart?.();
   let next=proposed.before;
   for(let i=0;i<proposed.actions.length;i++){
    const step=applyEditorAction(next,proposed.actions[i]);next=step.project;
    current.current.onStep?.(step);
    setProgress({index:i+1,total:proposed.actions.length,description:step.description});
    if(i<proposed.actions.length-1)await pause(650);
   }
   setRecent({id:'local-ai-demo',summary:'Sample AI edit completed - visible in the timeline',before:proposed.before,after:next});
   current.current.onNotice('Sample AI edit complete. Review or revert the changes.');
  }catch(e){
   current.current.onRestore?.(proposed.before);
   setError('Sample edit failed: '+e.message);
  }finally{stateRef.current=null;setApplying(false)}
 },[]);
 const revert=useCallback(()=>{
  if(!recent||applying)return;
  if(JSON.stringify(current.current.project)!==JSON.stringify(recent.after)){
   setError('You made changes after the sample. Undo manually so your new edits are preserved.');return;
  }
  current.current.onStart?.();
  current.current.onRestore?.(recent.before);
  setRecent(null);setProgress(null);setError('');
  current.current.onNotice?.('Sample AI edit reverted.');
 },[recent,applying]);
 const dismiss=useCallback(()=>{setError('');setRecent(null);setProgress(null)},[]);
 return {queue,review,applying,progress,recent,error,approve,reject,revert,dismiss};
}
