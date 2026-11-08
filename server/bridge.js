import crypto from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {requireGoogleAccount,getGoogleAccount} from './google-auth.js';
import {mcpIdentity,oauthChallenge} from './mcp-oauth.js';
import {EDITOR_ACTION_DESCRIPTION} from '../src/aiEditCommands.js';
import {storeVisualReview,readVisualReview,clearVisualReview,visualReviewMcpContent} from './editorVisualReview.js';
import {visibleEditorSnapshot,publishEditorSnapshot,proposeEditorEdits,pendingEditorEdit,
 getEditorEdit,reviewEditorEdit,progressEditorEdit,demoEditorEdit} from './editorBridge.js';
const router=Router();
const sessions=new Map();
const TTL=30*60*1000;
const MAX_SESSIONS=500;
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.path==='/mcp')return next();const site=req.get('Sec-Fetch-Site');if(site==='cross-site')return res.status(403).json({error:'Cross-site bridge requests are disabled'});const origin=req.get('Origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Cross-origin bridge requests are disabled'})}catch{return res.status(403).json({error:'Invalid origin'})}}next()});
const id=()=>crypto.randomBytes(24).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
export function revokeBridgeSessionsForLogin(loginId){if(!loginId)return;for(const [key,session] of sessions){if(session.loginId===loginId)sessions.delete(key)}}
export function bridgeAccessAllowed(session,account,viaMcp=false){return Boolean(session&&session.expires>now()&&(viaMcp||Boolean(account&&account.userId===session.ownerId&&account.loginId===session.loginId)))}
function find(req,res,next){
 const auth=req.get('Authorization')||'';
 const key=auth.startsWith('Bearer ')?auth.slice(7):null;
 const session=key&&sessions.get(hash(key));
 if(req.path==='/mcp'){
  // OAuth access is tied to the Google identity; it cannot select another user's browser.
  const identity=key&&mcpIdentity(key);
  if(identity){
   const eligible=[...sessions.values()].filter(s=>s.ownerId===identity.ownerId&&s.expires>now()
    &&visibleEditorSnapshot(s).connected);
   req.bridge=eligible.length===1?eligible[0]:null;
   req.activeEditorCount=eligible.length;
   req.mcpIdentity=identity;
   return next();
  }
  // Preserve the short-lived bearer bridge for existing local integration clients.
  if(session&&session.expires>now()){req.bridge=session;req.activeEditorCount=1;return next()}
  return oauthChallenge(res);
 }
 if(!session||session.expires<=now())return res.status(401).json({error:'Invalid or expired session'});
 const account=getGoogleAccount(req);
 if(!bridgeAccessAllowed(session,account))return res.status(403).json({error:'Bridge session does not belong to this signed-in user'});
 req.bridge=session;next();
}
const TRANSCRIPTION_MODELS=new Set(['tiny','base','small']);
function queueTranscription(session,args){
 const snapshot=visibleEditorSnapshot(session);
 if(!snapshot.connected)throw Error('Connect the browser editor before requesting transcription');
 // Already-connected ChatGPT clients may cache the original no-argument
 // tool schema. In that case, enqueue the next imported video/audio without
 // a nonfailed job, in the user's visible Project Files order. This never
 // touches a different browser/account and never sends media bytes to MCP.
 const media=snapshot.project.assets.filter(a=>a.kind==='video'||a.kind==='audio');
 const model=args?.model??'base';
 if(!TRANSCRIPTION_MODELS.has(model))throw Error('Model must be tiny, base, or small');
 const pending=media.find(a=>Number.isFinite(a.duration)&&a.duration>0&&a.duration<=600&&
  ![...session.jobs.values()].some(j=>j.asset_id===a.id&&j.model===model&&j.status!=='failed'));
 const assetId=args?.asset_id??pending?.id;
 if(typeof assetId!=='string'||assetId.length>150)throw Error('No unqueued imported video or audio remains. Call list_transcriptions to inspect existing jobs.');
 const asset=snapshot.project.assets.find(a=>a.id===assetId);
 if(!asset||!['video','audio'].includes(asset.kind))throw Error('Transcription asset must be an imported video or audio file');
 if(!Number.isFinite(asset.duration)||asset.duration<=0||asset.duration>600)throw Error('Transcription supports media under 10 minutes');
 const existing=[...session.jobs.values()].find(j=>j.asset_id===assetId&&j.model===model&&j.status!=='failed');
 if(existing)return existing;
 if(session.jobs.size>=10)throw Error('Session job limit reached');
 const job={id:id(),action:'transcribe',asset_id:assetId,asset_name:asset.name,model,
  status:'queued',createdAt:now(),result:null};
 session.jobs.set(job.id,job);
 return job;
}
function finishTranscription(job,body){
 if(job.status!=='processing')throw Error('Job must be claimed by the connected browser before completion');
 if(typeof body?.error==='string'&&body.error.length){
  job.status='failed';job.error=body.error.slice(0,300);return;
 }
 const segments=body?.segments;
 if(!Array.isArray(segments)||segments.length>500||JSON.stringify(segments).length>120000||
  segments.some(s=>!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||
   s.start<0||s.end<s.start||s.end>601||typeof s.text!=='string'||s.text.length>1000))
  throw Error('Invalid transcription segments');
 job.result=segments.map(s=>({start:s.start,end:s.end,text:s.text}));
 job.status='complete';
}
const sessionLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many bridge sessions; retry later'}});
router.post('/session',sessionLimiter,requireGoogleAccount,(req,res)=>{if(sessions.size>=MAX_SESSIONS)return res.status(503).json({error:'Bridge capacity reached; retry later'});const token=id();sessions.set(hash(token),{ownerId:req.googleAccount.userId,loginId:req.googleAccount.loginId,expires:now()+TTL,jobs:new Map()});res.set('Cache-Control','no-store').json({token,expiresInSeconds:TTL/1000})});
router.get('/jobs',find,(req,res)=>{res.set('Cache-Control','no-store').json({jobs:[...req.bridge.jobs.values()].filter(j=>j.status==='queued').map(({id,action,asset_id,asset_name,model,createdAt})=>({id,action,asset_id,asset_name,model,createdAt}))})});
router.post('/jobs',find,(req,res)=>{try{
 if(req.body?.action!=='transcribe')return res.status(400).json({error:'Unsupported action'});
 const job=queueTranscription(req.bridge,req.body);
 return res.status(201).json({id:job.id,status:job.status,asset_id:job.asset_id});
}catch(e){return res.status(400).json({error:e.message})}});
router.post('/jobs/:id/claim',find,(req,res)=>{
 const job=req.bridge.jobs.get(req.params.id);
 if(!job)return res.status(404).json({error:'Job not found'});
 if(job.status!=='queued')return res.status(409).json({error:'Job already claimed or completed'});
 job.status='processing';job.claimedAt=now();
 return res.json({ok:true,asset_id:job.asset_id,model:job.model});
});
router.post('/jobs/:id/result',find,(req,res)=>{
 const job=req.bridge.jobs.get(req.params.id);
 if(!job)return res.status(404).json({error:'Job not found'});
 try{finishTranscription(job,req.body);return res.json({ok:true,status:job.status})}
 catch(e){return res.status(400).json({error:e.message})}
});
router.get('/jobs/:id',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});res.set('Cache-Control','no-store').json(job)});
// The browser syncs editable project metadata into its own short-lived session.
// AI proposals are never applied by the server; the signed-in browser must review them.
function safeRoute(handler){
 return (req,res)=>{try{return handler(req,res)}catch(e){return res.status(e.status||400).json({error:e.message||'Bridge request rejected'})}};
}
router.post('/editor/snapshot',find,safeRoute((req,res)=>{
 res.json(publishEditorSnapshot(req.bridge,req.body?.project));
}));
// A person must click Share preview frames in the paired browser. This is never
// triggered by an MCP tool or silently uploaded from a video file.
router.post('/editor/review',find,safeRoute((req,res)=>{
 res.status(201).json(storeVisualReview(req.bridge,req.body));
}));
router.delete('/editor/review',find,safeRoute((req,res)=>{
 res.json({cleared:clearVisualReview(req.bridge)});
}));
router.get('/editor/review',find,safeRoute((req,res)=>{
 const proof=readVisualReview(req.bridge);
 res.json({shared:Boolean(proof),expiresAt:proof?.expires||null,frames:proof?.frames.length||0});
}));
router.get('/editor/pending',find,safeRoute((req,res)=>{
 res.json(pendingEditorEdit(req.bridge));
}));
router.post('/editor/demo',find,safeRoute((req,res)=>{
 res.status(201).json(demoEditorEdit(req.bridge));
}));
router.post('/editor/edits/:id/review',find,safeRoute((req,res)=>{
 res.json(reviewEditorEdit(req.bridge,req.params.id,req.body?.decision));
}));
router.post('/editor/edits/:id/progress',find,safeRoute((req,res)=>{
 res.json(progressEditorEdit(req.bridge,req.params.id,req.body||{}));
}));
router.get('/editor/edits/:id',find,safeRoute((req,res)=>{
 res.json(getEditorEdit(req.bridge,req.params.id));
}));
// Stateless MCP JSON-RPC endpoint. Every request must carry the short-lived bridge bearer token.
// Source media is never uploaded through MCP. Only explicitly shared, downscaled still frames are returned by the optional private visual-review action.
router.post('/mcp',find,(req,res)=>{
 const body=req.body;
 if(!body||body.jsonrpc!=='2.0'||typeof body.method!=='string')return res.status(400).json({error:'Invalid JSON-RPC request'});
 const reply=(result)=>{if(body.id===undefined)return res.status(202).end();return res.json({jsonrpc:'2.0',id:body.id,result})};
 const fault=(code,message)=>res.json({jsonrpc:'2.0',id:body.id??null,error:{code,message}});
 res.set('MCP-Protocol-Version','2025-03-26');
 if(body.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'autocaption-studio',version:'0.1.0'}});
 if(body.method==='notifications/initialized')return res.status(202).end();
 if(body.method==='ping')return reply({});
 if(body.method==='tools/list')return reply({tools:[
  {name:'queue_transcription',description:'Transcribe an imported video or audio by asset_id in the paired browser using local Whisper. Choose the asset_id from get_editor_project. Results include timestamped dialogue segments for montage planning; no media bytes leave the browser. Browser must remain open.',inputSchema:{type:'object',properties:{asset_id:{type:'string'},model:{type:'string',enum:['tiny','base','small']}},required:['asset_id'],additionalProperties:false}},
  {name:'get_transcription',description:'Read the status and, when completed, the transcript of a job in this private session.',inputSchema:{type:'object',properties:{job_id:{type:'string'}},required:['job_id'],additionalProperties:false}},
  {name:'list_transcriptions',description:'List jobs for this private bridge session.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_editor_project',description:'Read current timeline clip metadata (no source video). If the user explicitly clicked Share preview frames, also return up to six user-approved, temporary downscaled JPEG preview images and timing diagnostics.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_editor_visual_review',description:'Read only the explicit user-shared, temporary preview JPEGs and timing diagnostics from the connected editor. Does not request or upload video. If none shared, instruct the user to click Share preview frames in their editor.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'propose_editor_edits',description:'Submit 1–12 validated edit commands for the user to review in the connected browser. NOTHING executes until the user clicks Approve. Commands: '+EDITOR_ACTION_DESCRIPTION,inputSchema:{type:'object',properties:{summary:{type:'string'},actions:{type:'array',minItems:1,maxItems:12,items:{type:'object',properties:{type:{type:'string'}},required:['type']}}},required:['summary','actions'],additionalProperties:false}},
  {name:'get_editor_edit_status',description:'Read whether an AI edit proposal is awaiting approval, applying step-by-step, completed, rejected, or stale.',inputSchema:{type:'object',properties:{edit_id:{type:'string'}},required:['edit_id'],additionalProperties:false}}

 ].map(tool=>({...tool,securitySchemes:[{type:'oauth2',scopes:tool.name==='propose_editor_edits'||tool.name==='queue_transcription'?['editor.read','editor.write']:['editor.read']}]}))});
 if(body.method!=='tools/call')return fault(-32601,'Method not found');
 if(!req.bridge)return reply({content:[{type:'text',text:JSON.stringify({error:req.activeEditorCount>1?
  'Multiple AutoCaption Studio windows are connected for your Google account. Disconnect all but one to choose the correct project.':
  'No active AutoCaption Studio window was found for your Google account. Open the editor, sign in with the same Google account and click Connect AI editing bridge.'})}],isError:true});
 const name=body.params?.name,args=body.params?.arguments||{};
 const output=(data,isError=false)=>reply({content:[{type:'text',text:JSON.stringify(data)}],isError});
 const wantsWrite=name==='queue_transcription'||name==='propose_editor_edits';
 if(wantsWrite&&req.mcpIdentity&&!req.mcpIdentity.scopes.includes('editor.write'))
  return output({error:'editor.write scope is required for this action. Reconnect ChatGPT with editing permissions.'},true);
 if(name==='queue_transcription'){
  try{
   const job=queueTranscription(req.bridge,args);
   return output({job_id:job.id,asset_id:job.asset_id,asset_name:job.asset_name,model:job.model,
    status:job.status,note:'Keep the paired browser open. The local Whisper worker will process this asset. Call get_transcription to check progress.'});
  }catch(e){return output({error:e.message},true)}
 }
 if(name==='get_transcription'){
  if(typeof args.job_id!=='string')return output({error:'job_id is required'},true);
  const job=req.bridge.jobs.get(args.job_id);
  return job?output(job):output({error:'Job not found in this session'},true);
 }
 if(name==='list_transcriptions')return output({jobs:[...req.bridge.jobs.values()].map(({id,status,asset_id,asset_name,model,createdAt,error})=>({id,status,asset_id,asset_name,model,createdAt,error}))});
 if(name==='get_editor_project'){
  const data=visibleEditorSnapshot(req.bridge);
  if(!data.connected)return output({error:'No active browser. Open AutoCaption Studio and connect this AI bridge to inspect the timeline.'},true);
  const content=[{type:'text',text:JSON.stringify({connected:true,revision:data.revision,project:data.project})},
   ...visualReviewMcpContent(req.bridge)];
  return reply({content,isError:false});
 }
 if(name==='get_editor_visual_review'){
  const content=visualReviewMcpContent(req.bridge);
  return content.length?reply({content,isError:false}):output({error:'No preview frames were shared. The user must click Share preview frames with ChatGPT in the connected editor. Frames are opt-in and expire after five minutes.'},true);
 }
 if(name==='propose_editor_edits'){
  try{
   const edit=proposeEditorEdits(req.bridge,args);
   return output({edit_id:edit.id,status:edit.status,summary:edit.summary,steps:edit.steps,note:'Waiting for user approval in the connected AutoCaption Studio browser. Check status using get_editor_edit_status.'});
  }catch(e){return output({error:e.message},true)}
 }
 if(name==='get_editor_edit_status'){
  if(typeof args.edit_id!=='string')return output({error:'edit_id is required'},true);
  try{return output(getEditorEdit(req.bridge,args.edit_id))}catch(e){return output({error:e.message},true)}
 }
 return output({error:'Unknown tool'},true);
});
router.delete('/session',find,(req,res)=>{for(const [k,v] of sessions)if(v===req.bridge)sessions.delete(k);res.json({ok:true})});
setInterval(()=>{for(const [k,v] of sessions)if(v.expires<now())sessions.delete(k)},60000).unref();
export default router;
