import crypto from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {requireGoogleAccount,getGoogleAccount} from './google-auth.js';
const router=Router();
const sessions=new Map();
const TTL=30*60*1000;
const MAX_SESSIONS=500;
router.use((req,res,next)=>{res.set('Cache-Control','no-store');const site=req.get('Sec-Fetch-Site');if(site==='cross-site')return res.status(403).json({error:'Cross-site bridge requests are disabled'});const origin=req.get('Origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Cross-origin bridge requests are disabled'})}catch{return res.status(403).json({error:'Invalid origin'})}}next()});
const id=()=>crypto.randomBytes(24).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
function find(req,res,next){const auth=req.get('Authorization')||'';const key=auth.startsWith('Bearer ')?auth.slice(7):null;const session=key&&sessions.get(hash(key));if(!session||session.expires<now()){return res.status(401).json({error:'Invalid or expired session'})}if(req.path!=='/mcp'&&req.method!=='OPTIONS'){const account=getGoogleAccount(req);if(!account||account.userId!==session.ownerId)return res.status(403).json({error:'Bridge session does not belong to this signed-in user'});}req.bridge=session;next()}
const sessionLimiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many bridge sessions; retry later'}});
router.post('/session',sessionLimiter,requireGoogleAccount,(req,res)=>{if(sessions.size>=MAX_SESSIONS)return res.status(503).json({error:'Bridge capacity reached; retry later'});const token=id();sessions.set(hash(token),{ownerId:req.googleAccount.userId,expires:now()+TTL,jobs:new Map()});res.set('Cache-Control','no-store').json({token,expiresInSeconds:TTL/1000})});
router.get('/jobs',find,(req,res)=>{res.set('Cache-Control','no-store').json({jobs:[...req.bridge.jobs.values()].filter(j=>j.status==='queued').map(({id,action,createdAt})=>({id,action,createdAt}))})});
router.post('/jobs',find,(req,res)=>{const action=req.body?.action;if(action!=='transcribe')return res.status(400).json({error:'Unsupported action'});if(req.bridge.jobs.size>=10)return res.status(429).json({error:'Job limit reached'});const job={id:id(),action,status:'queued',createdAt:now(),result:null};req.bridge.jobs.set(job.id,job);res.status(201).json({id:job.id,status:job.status})});
router.post('/jobs/:id/result',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});if(job.status!=='queued')return res.status(409).json({error:'Job already completed'});const segments=req.body?.segments;if(!Array.isArray(segments)||segments.length>5000||JSON.stringify(segments).length>1000000||segments.some(s=>!s||!Number.isFinite(Number(s.start))||!Number.isFinite(Number(s.end))||Number(s.start)<0||Number(s.end)<Number(s.start)||typeof s.text!=='string'))return res.status(400).json({error:'Invalid transcript'});job.result=segments.map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text||'').slice(0,1000)}));job.status='complete';res.json({ok:true})});
router.get('/jobs/:id',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});res.set('Cache-Control','no-store').json(job)});
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
  {name:'list_transcriptions',description:'List jobs for this private bridge session.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
 ]});
 if(body.method!=='tools/call')return fault(-32601,'Method not found');
 const name=body.params?.name,args=body.params?.arguments||{};
 const output=(data,isError=false)=>reply({content:[{type:'text',text:JSON.stringify(data)}],isError});
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
 return output({error:'Unknown tool'},true);
});
router.delete('/session',find,(req,res)=>{for(const [k,v] of sessions)if(v===req.bridge)sessions.delete(k);res.json({ok:true})});
setInterval(()=>{for(const [k,v] of sessions)if(v.expires<now())sessions.delete(k)},60000).unref();
export default router;
