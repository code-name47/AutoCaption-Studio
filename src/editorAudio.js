// Web Audio routing shared by editor playback and exported recordings.
// Keeps real stereo channel isolation (as opposed to merely renaming tracks).
import {clipAudioConfig} from './editorEnhancements.js';

export function audioTrackEnabled(trackId,muted={},solo={}){
 const anySolo=Object.values(solo).some(Boolean);
 return !muted[trackId]&&(!anySolo||Boolean(solo[trackId]));
}

export function attachAudioGraph(context,element,destination,initialClip){
 const source=context.createMediaElementSource(element);
 const splitter=context.createChannelSplitter(2);
 const low=context.createBiquadFilter();low.type='lowshelf';low.frequency.value=180;
 const mid=context.createBiquadFilter();mid.type='peaking';mid.frequency.value=1250;mid.Q.value=.9;
 const high=context.createBiquadFilter();high.type='highshelf';high.frequency.value=5500;
 const panner=context.createStereoPanner();
 const gain=context.createGain();gain.gain.value=0;
 low.connect(mid);mid.connect(high);high.connect(panner);panner.connect(gain);gain.connect(destination);
 let currentChannel=null;
 function update(clip){
  const config=clipAudioConfig(clip);
  if(config.channel!==currentChannel){
   source.disconnect();splitter.disconnect();
   if(config.channel==='left'||config.channel==='right'){
    source.connect(splitter);
    splitter.connect(low,config.channel==='left'?0:1);
   }else source.connect(low);
   currentChannel=config.channel;
  }
  panner.pan.value=config.pan;
  low.gain.value=config.eqLow;mid.gain.value=config.eqMid;high.gain.value=config.eqHigh;
 }
 update(initialClip);
 return {
  gain,
  update,
  setGain(value){gain.gain.value=Number.isFinite(value)?Math.max(0,Math.min(2,value)):0},
  dispose(){try{source.disconnect();splitter.disconnect();low.disconnect();mid.disconnect();high.disconnect();panner.disconnect();gain.disconnect()}catch{}}
 };
}
