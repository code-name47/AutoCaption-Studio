// Browser-local audio waveform analysis: real PCM amplitudes, no upload or AI key.
const BINS=160;
export async function audioPeaksFromFile(file,maxBytes=24*1024*1024){
 if(!file||file.size>maxBytes) return null;
 const AudioCtx=window.AudioContext||window.webkitAudioContext;
 if(!AudioCtx)return null;
 const context=new AudioCtx();
 try{
  const buffer=await context.decodeAudioData(await file.arrayBuffer());
  if(!Number.isFinite(buffer.duration)||buffer.duration<=0||buffer.duration>600)return null;
  const length=buffer.length,channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
  const result=[];
  for(let i=0;i<BINS;i++){
   const from=Math.floor(length*i/BINS),to=Math.min(length,Math.ceil(length*(i+1)/BINS));
   if(from>=to){result.push(0);continue}
   const stride=Math.max(1,Math.floor((to-from)/800));
   let peak=0;
   for(let j=from;j<to;j+=stride){
    for(const pcm of channels)peak=Math.max(peak,Math.abs(pcm[j]||0));
   }
   result.push(Math.round(Math.min(1,peak)*1000)/1000);
  }
  return result;
 }catch{return null}
 finally{await context.close().catch(()=>{})}
}

export function waveformLines(peaks,inPoint,outPoint,sourceDuration,bars=56){
 if(!Array.isArray(peaks)||!peaks.length||!Number.isFinite(sourceDuration)||sourceDuration<=0)return '';
 const n=Math.max(2,Math.min(120,Math.floor(bars)));
 const commands=[];
 for(let i=0;i<n;i++){
  const time=inPoint+(i+.5)/n*(outPoint-inPoint);
  const index=Math.max(0,Math.min(peaks.length-1,Math.floor(time/sourceDuration*peaks.length)));
  const amplitude=Math.max(.03,Math.min(1,Number(peaks[index])||0));
  const x=Math.round(i*1000/n)/10,span=12*amplitude;
  commands.push('M'+x.toFixed(1)+' '+(15-span).toFixed(1)+'V'+(15+span).toFixed(1));
 }
 return commands.join(' ');
}

export function recommendedPeakGain(peaks,oldVolume=1){
 if(!Array.isArray(peaks)||!peaks.length)throw Error('Audio peaks are unavailable. Try a supported WAV or AAC audio file.');
 const peak=Math.max(...peaks);
 if(!Number.isFinite(peak)||peak<.001)throw Error('The source appears silent.');
 return Math.round(Math.min(2,Math.max(.05,.93/peak))*100)/100;
}
