import crypto from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {requireGoogleAccount,getGoogleAccount} from './google-auth.js';
import {mcpIdentity,oauthChallenge} from './mcp-oauth.js';
import {EDITOR_ACTION_DESCRIPTION} from '../src/aiEditCommands.js';
import {visibleEditorSnapshot,publishEditorSnapshot,proposeEditorEdits,pendingEditorEdit,
 getEditorEdit,reviewEditorEdit,progressEditorEdit,demoEditorEdit} from './editorBridge.js';
const router=Router();
const sessions=new Map();
const TTL=30*60*1000;
const MAX_SESSIONS=500;
router.use((req,res,next)=>{res.set('Cache-Control','no-store');const site=req.get('Sec-Fetch-Site');if(site==='cross-site')return res.status(403).json({error:'Cross-site bridge requests are disabled'});const origin=req.get('Origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Cross-origin bridge requests are disabled'})}catch{return res.status(403).json({error:'Invalid origin'})}}next()});
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
const sessionLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many bridge sessions; retry later'}});
router.post('/session',sessionLimiter,requireGoogleAccount,(req,res)=>{if(sessions.size>=MAX_SESSIONS)return res.status(503).json({error:'Bridge capacity reached; retry later'});const token=id();sessions.set(hash(token),{ownerId:req.googleAccount.userId,loginId:req.googleAccount.loginId,expires:now()+TTL,jobs:new Map()});res.set('Cache-Control','no-store').json({token,expiresInSeconds:TTL/1000})});
router.get('/jobs',find,(req,res)=>{res.set('Cache-Control','no-store').json({jobs:[...req.bridge.jobs.values()].filter(j=>j.status==='queued').map(({id,action,createdAt})=>({id,action,createdAt}))})});
router.post('/jobs',find,(req,res)=>{const action=req.body?.action;if(action!=='transcribe')return res.status(400).json({error:'Unsupported action'});if(req.bridge.jobs.size>=10)return res.status(429).json({error:'Job limit reached'});const job={id:id(),action,status:'queued',createdAt:now(),result:null};req.bridge.jobs.set(job.id,job);res.status(201).json({id:job.id,status:job.status})});
router.post('/jobs/:id/result',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});if(job.status!=='queued')return res.status(409).json({error:'Job already completed'});const segments=req.body?.segments;if(!Array.isArray(segments)||segments.length>5000||JSON.stringify(segments).length>1000000||segments.some(s=>!s||!Number.isFinite(Number(s.start))||!Number.isFinite(Number(s.end))||Number(s.start)<0||Number(s.end)<Number(s.start)||typeof s.text!=='string'))return res.status(400).json({error:'Invalid transcript'});job.result=segments.map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text||'').slice(0,1000)}));job.status='complete';res.json({ok:true})});
router.get('/jobs/:id',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});res.set('Cache-Control','no-store').json(job)});
// The browser syncs editable project metadata into its own short-lived session.
// AI proposals are never applied by the server; the signed-in browser must review them.
function safeRoute(handler){
 return (req,res)=>{try{return handler(req,res)}catch(e){return res.status(e.status||400).json({error:e.message||'Bridge request rejected'})}};
}
router.post('/editor/snapshot',find,safeRoute((req,res)=>{
 res.json(publishEditorSnapshot(req.bridge,req.body?.project));
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
// No media is uploaded through MCP: the paired browser must already have a local file selected.
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
  {name:'queue_transcription',description:'Queue a local Whisper transcription for the media already selected in the paired AutoCaption Studio browser. Browser must remain open.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_transcription',description:'Read the status and, when completed, the transcript of a job in this private session.',inputSchema:{type:'object',properties:{job_id:{type:'string'}},required:['job_id'],additionalProperties:false}},
  {name:'list_transcriptions',description:'List jobs for this private bridge session.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_editor_project',description:'Read the project metadata currently visible in the connected AutoCaption Studio editor (timeline clips, media names, track IDs, and canvas). Does not read media bytes. Browser must remain open.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
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
  if(req.bridge.jobs.size>=10)return output({error:'Session job limit reached'},true);
  const job={id:id(),action:'transcribe',status:'queued',createdAt:now(),result:null};
  req.bridge.jobs.set(job.id,job);
  return output({job_id:job.id,status:job.status,note:'Keep the paired browser open with a video selected. Call get_transcription to check progress.'});
 }
 if(name==='get_transcription'){
  if(typeof args.job_id!=='string')return output({error:'job_id is required'},true);
  const job=req.bridge.jobs.get(args.job_id);
  return job?output(job):output({error:'Job not found in this session'},true);
 }
 if(name==='list_transcriptions')return output({jobs:[...req.bridge.jobs.values()].map(({id,status,createdAt})=>({id,status,createdAt}))});
 if(name==='get_editor_project'){
  const data=visibleEditorSnapshot(req.bridge);
  return data.connected?output({connected:true,revision:data.revision,project:data.project}):output({error:'No active browser. Open AutoCaption Studio and connect this AI bridge to inspect the timeline.'},true);
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
