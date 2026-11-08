export async function decodeMediaToMono16k(file,onProgress){
  const buffer=await file.arrayBuffer();
  const context=new (window.AudioContext||window.webkitAudioContext)();
  let decoded;
  try{
    onProgress?.('Decoding media audio…');
    decoded=await context.decodeAudioData(buffer);
    const length=Math.ceil(decoded.duration*16000);
    if(!length||!Number.isFinite(length))throw Error('Unable to read audio duration');
    if(decoded.duration>600)throw Error('For this initial local version, choose a clip under 10 minutes.');
    const offline=new OfflineAudioContext(1,length,16000);
    const source=offline.createBufferSource();
    source.buffer=decoded;
    source.connect(offline.destination);
    source.start();
    onProgress?.('Converting audio to 16 kHz…');
    const rendered=await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }catch(err){
    if(err?.name==='EncodingError'||/decode|format|codec/i.test(err?.message||''))throw Error('This browser could not decode the audio in this video. Try MP3, WAV, or a video with AAC audio. More codecs will be supported later.');
    throw err;
  }finally{await context.close().catch(()=>{})}
}
