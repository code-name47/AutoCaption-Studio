import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
let transcriber;
async function load(){
  if(transcriber)return transcriber;
  const options = { device: 'wasm', dtype: 'q8', progress_callback: p => {
    if(p.status==='progress' && Number.isFinite(p.progress))self.postMessage({type:'download',progress:Math.round(p.progress),file:p.file||''});
    if(p.status==='ready')self.postMessage({type:'model-ready'});
  }};
  transcriber=await pipeline('automatic-speech-recognition','onnx-community/whisper-tiny',options);
  return transcriber;
}
self.onmessage=async e=>{
  if(e.data?.type!=='transcribe')return;
  try{
    self.postMessage({type:'loading'});
    const pipe=await load();
    self.postMessage({type:'processing'});
    const audio=new Float32Array(e.data.audio);
    const output=await pipe(audio,{chunk_length_s:20,stride_length_s:4,return_timestamps:true,task:'transcribe'});
    const segments=(output.chunks||[]).map(x=>({start:Number(x.timestamp?.[0]||0),end:Number(x.timestamp?.[1]??x.timestamp?.[0]??0),text:x.text||''}));
    self.postMessage({type:'complete',result:{text:output.text||'',segments}});
  }catch(err){self.postMessage({type:'error',message:String(err?.message||err)})}
};
