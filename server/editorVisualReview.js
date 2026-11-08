// User-initiated, private, short-lived visual proof for the ChatGPT editor bridge.
// No Drive tokens, source video, or source audio are accepted on this endpoint.
import {visibleEditorSnapshot} from './editorBridge.js';

const reviews=new Map();
export const VISUAL_REVIEW_TTL_MS=5*60*1000;
const MAX_REVIEWS=24; // Upper bound RAM even when many browser sessions are connected.
const MAX_TOTAL_BYTES=640*1024;
const MAX_FRAME_BYTES=110*1024;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;

function purge(){
 const t=Date.now();
 for(const [session,review] of reviews)if(review.expires<=t||session.expires<=t)reviews.delete(session);
}

export function storeVisualReview(session,body){
 purge();
 const snapshot=visibleEditorSnapshot(session);
 if(!snapshot.connected)throw failure('Connect the AI editor before sharing preview frames',409);
 if(body?.revision!==snapshot.revision)throw failure('The editor changed. Retry visual review with the current timeline.',409);
 if(!Array.isArray(body.frames)||body.frames.length<1||body.frames.length>6)
  throw failure('Share between 1 and 6 preview frames');
 if(!Array.isArray(body.notes)||body.notes.length>18||body.notes.some(s=>typeof s!=='string'||s.length>240))
  throw failure('Invalid timeline diagnostics');
 if(body.waveform!==null&&body.waveform!==undefined&&
  (!Array.isArray(body.waveform)||body.waveform.length>96||
   body.waveform.some(n=>!finite(n,0,1))))
  throw failure('Invalid private audio energy summary');
 let total=0;
 const frames=body.frames.map((f,i)=>{
  if(!f||!finite(f.time,0,36000)||!Number.isInteger(f.width)||!Number.isInteger(f.height)||
   f.width<16||f.height<16||f.width>640||f.height>640||
   f.mimeType!=='image/jpeg'||typeof f.data!=='string'||
   f.data.length<40||f.data.length>Math.ceil(MAX_FRAME_BYTES*4/3)+4||
   !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data))
   throw failure('Invalid JPEG preview frame '+(i+1));
  const buffer=Buffer.from(f.data,'base64');
  if(buffer.length>MAX_FRAME_BYTES||buffer.length<100||
   buffer[0]!==0xff||buffer[1]!==0xd8||buffer[2]!==0xff||
   buffer.at(-2)!==0xff||buffer.at(-1)!==0xd9)
   throw failure('Invalid or oversized JPEG preview frame '+(i+1));
  total+=buffer.length;
  if(total>MAX_TOTAL_BYTES)throw failure('Preview images exceed the private review limit',413);
  return {time:f.time,width:f.width,height:f.height,data:buffer.toString('base64'),
   caption:typeof f.caption==='string'?f.caption.slice(0,200):''};
 });
 const maxTimelineTime=Math.max(0,...(snapshot.project?.clips||[])
  .map(c=>(Number(c.start)||0)+(Number(c.outPoint)-Number(c.inPoint))/Math.max(.1,Number(c.speed)||1)));
 if(frames.some(f=>f.time>maxTimelineTime+0.2))
  throw failure('A preview timestamp is outside the timeline');
 for(let i=1;i<frames.length;i++)if(frames[i].time<=frames[i-1].time)
  throw failure('Preview times must be in ascending order');
 if(!reviews.has(session)&&reviews.size>=MAX_REVIEWS)reviews.delete(reviews.keys().next().value);
 const review={revision:snapshot.revision,createdAt:Date.now(),expires:Date.now()+VISUAL_REVIEW_TTL_MS,
  frames,notes:body.notes,waveform:body.waveform??null,bytes:total};
 reviews.delete(session);reviews.set(session,review);
 return {shared:true,frames:frames.length,expiresInSeconds:VISUAL_REVIEW_TTL_MS/1000,bytes:total,
  notes:review.notes,waveformAvailable:review.waveform!==null};
}

export function readVisualReview(session){
 purge();
 const entry=reviews.get(session);
 if(!entry)return null;
 const snapshot=visibleEditorSnapshot(session);
 if(entry.revision!==snapshot.revision||!snapshot.connected){reviews.delete(session);return null}
 return entry;
}

export function clearVisualReview(session){const had=reviews.has(session);reviews.delete(session);return had}

export function visualReviewMcpContent(session){
 const review=readVisualReview(session);
 if(!review)return [];
 const info={visual_review:{shared_at:review.createdAt,expires_at:review.expires,
  revision:review.revision,notes:review.notes,
  waveform_rms:review.waveform,
  frame_times:review.frames.map(f=>f.time),
  note:'User explicitly shared six or fewer downscaled preview frames. These are only sampled stills, not a full video or audio stream. Review the images for visual issues; do not claim that spoken words are verified from these images.'}};
 const content=[{type:'text',text:JSON.stringify(info)}];
 for(const frame of review.frames){
  content.push({type:'text',text:JSON.stringify({preview_frame_at_seconds:frame.time,
   width:frame.width,height:frame.height,caption_at_frame:frame.caption})});
  content.push({type:'image',mimeType:'image/jpeg',data:frame.data});
 }
 return content;
}
