import {pipeline,env} from '@huggingface/transformers';
env.allowLocalModels=false;
let currentModel='',transcriber=null;
self.onmessage=async e=>{
 if(e.data?.type!=='transcribe')return;
 try{
  const model=['tiny','base','small'].includes(e.data.model)?e.data.model:'tiny';
  if(!transcriber||currentModel!==model){
   if(transcriber?.dispose)await transcriber.dispose();
   transcriber=null;currentModel='';
   self.postMessage({type:'loading',model});
   transcriber=await pipeline('automatic-speech-recognition','onnx-community/whisper-'+model,{device:'wasm',dtype:'q8',progress_callback:p=>{if(p.status==='progress'&&Number.isFinite(p.progress))self.postMessage({type:'download',progress:Math.round(p.progress),file:p.file||''})}});
   currentModel=model;
  }
  self.postMessage({type:'processing'});
  const audio=new Float32Array(e.data.audio);
  const output=await transcriber(audio,{chunk_length_s:20,stride_length_s:4,return_timestamps:true,task:'transcribe'});
  const segments=(output.chunks||[]).map(x=>({start:Number(x.timestamp?.[0]||0),end:Number(x.timestamp?.[1]??x.timestamp?.[0]??0),text:x.text||''}));
  self.postMessage({type:'complete',result:{text:output.text||'',segments}});
 }catch(err){self.postMessage({type:'error',message:String(err?.message||err)})}
};
