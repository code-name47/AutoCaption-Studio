// Preview thumbnails are generated from already imported local object URLs.
// Nothing is sent to an external thumbnail service.
export async function makeMediaThumbnail(url,kind){
 if(!url)return '';
 if(kind==='image')return url;
 if(kind!=='video')return '';
 return new Promise(resolve=>{
  const video=document.createElement('video');video.preload='auto';video.muted=true;video.playsInline=true;
  let done=false,timer;
  const finish=(data='')=>{if(done)return;done=true;clearTimeout(timer);video.removeAttribute('src');video.load();resolve(data)};
  const capture=()=>{
   try{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const ctx=canvas.getContext('2d');if(!ctx||!video.videoWidth||!video.videoHeight)return finish();
    ctx.fillStyle='#0b1422';ctx.fillRect(0,0,160,90);
    const scale=Math.min(160/video.videoWidth,90/video.videoHeight);
    const w=video.videoWidth*scale,h=video.videoHeight*scale;
    ctx.drawImage(video,(160-w)/2,(90-h)/2,w,h);
    finish(canvas.toDataURL('image/jpeg',.6));
   }catch{finish()}
  };
  video.onloadeddata=()=>{if(video.duration>.5){video.onseeked=capture;try{video.currentTime=Math.min(1,video.duration*.2)}catch{capture()}}else capture()};
  video.onerror=()=>finish();
  timer=setTimeout(()=>finish(),7000);video.src=url;
 });
}
