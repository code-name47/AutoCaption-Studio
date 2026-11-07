import crypto from 'node:crypto';
import {Router} from 'express';
const router=Router();
const sessions=new Map();
const TTL=30*60*1000;
router.use((req,res,next)=>{res.set('Cache-Control','no-store');const origin=req.get('Origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Cross-origin bridge requests are disabled'})}catch{return res.status(403).json({error:'Invalid origin'})}}next()});
const id=()=>crypto.randomBytes(24).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const now=()=>Date.now();
function find(req,res,next){const key=req.get('Authorization')?.replace(/^Bearer /,'');const session=key&&sessions.get(hash(key));if(!session||session.expires<now()){return res.status(401).json({error:'Invalid or expired session'})}req.bridge=session;next()}
router.post('/session',(req,res)=>{const token=id();sessions.set(hash(token),{expires:now()+TTL,jobs:new Map()});res.set('Cache-Control','no-store').json({token,expiresInSeconds:TTL/1000})});
router.get('/jobs',find,(req,res)=>{res.set('Cache-Control','no-store').json({jobs:[...req.bridge.jobs.values()].filter(j=>j.status==='queued').map(({id,action,createdAt})=>({id,action,createdAt}))})});
router.post('/jobs',find,(req,res)=>{const action=req.body?.action;if(action!=='transcribe')return res.status(400).json({error:'Unsupported action'});if(req.bridge.jobs.size>=10)return res.status(429).json({error:'Job limit reached'});const job={id:id(),action,status:'queued',createdAt:now(),result:null};req.bridge.jobs.set(job.id,job);res.status(201).json({id:job.id,status:job.status})});
router.post('/jobs/:id/result',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});if(job.status!=='queued')return res.status(409).json({error:'Job already completed'});const segments=req.body?.segments;if(!Array.isArray(segments)||segments.length>5000||JSON.stringify(segments).length>1000000)return res.status(400).json({error:'Invalid transcript'});job.result=segments.map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text||'').slice(0,1000)}));job.status='complete';res.json({ok:true})});
router.get('/jobs/:id',find,(req,res)=>{const job=req.bridge.jobs.get(req.params.id);if(!job)return res.status(404).json({error:'Job not found'});res.set('Cache-Control','no-store').json(job)});
router.delete('/session',find,(req,res)=>{for(const [k,v] of sessions)if(v===req.bridge)sessions.delete(k);res.json({ok:true})});
setInterval(()=>{for(const [k,v] of sessions)if(v.expires<now())sessions.delete(k)},60000).unref();
export default router;
