// Real chroma keying for both preview and rendering. No AI model or API needed.
import {chromaOpacity} from './editorEnhancements.js';
export function parseKeyColor(value){
 const hex=/^#[0-9a-f]{6}$/i.test(value||'')?value:'#00ff00';
 return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
}
export function applyChromaToPixels(pixels,clip){
 if(!clip?.chromaKey)return pixels;
 const [kr,kg,kb]=parseKeyColor(clip.chromaColor);
 const tolerance=Number.isFinite(clip.chromaTolerance)?clip.chromaTolerance:.18;
 const softness=Number.isFinite(clip.chromaSoftness)?clip.chromaSoftness:.12;
 const data=pixels.data;
 for(let i=0;i<data.length;i+=4){
  if(data[i+3]===0)continue;
  const remaining=chromaOpacity(data[i],data[i+1],data[i+2],kr,kg,kb,tolerance,softness);
  data[i+3]=Math.round(data[i+3]*remaining);
  // Suppress green spill near partially-keyed edges.
  if(kg>kr*1.25&&kg>kb*1.25&&remaining<.95)
   data[i+1]=Math.min(data[i+1],Math.max(data[i],data[i+2])+20);
 }
 return pixels;
}
export function fitDrawImage(ctx,node,width,height){
 const w=node.videoWidth||node.naturalWidth||width,h=node.videoHeight||node.naturalHeight||height;
 const scale=Math.min(width/Math.max(w,1),height/Math.max(h,1)),dw=w*scale,dh=h*scale;
 ctx.drawImage(node,(width-dw)/2,(height-dh)/2,dw,dh);
}
export function renderKeyedImage(ctx,node,clip,width,height,cache){
 if(!clip?.chromaKey){fitDrawImage(ctx,node,width,height);return}
 const canvas=cache?.canvas||document.createElement('canvas');
 if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
 const back=cache?.context||canvas.getContext('2d',{willReadFrequently:true});
 if(!back)throw Error('Chroma key requires canvas 2D support');
 back.clearRect(0,0,width,height);
 fitDrawImage(back,node,width,height);
 const pixels=back.getImageData(0,0,width,height);
 back.putImageData(applyChromaToPixels(pixels,clip),0,0);
 ctx.drawImage(canvas,0,0,width,height);
}
