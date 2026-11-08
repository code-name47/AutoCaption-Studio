// OAuth 2.1 authorization-code + PKCE gateway for ChatGPT's remote MCP plugin.
// Google is the identity provider; this short-lived broker ONLY grants access
// to the same Google user's live, approval-gated browser editor.
// State is intentionally in-memory for the MVP; do not use multiple server replicas.
import crypto from 'node:crypto';
import express,{Router} from 'express';
import rateLimit from 'express-rate-limit';
import {getGoogleAccount} from './google-auth.js';

const router=Router();
const requests=new Map(),codes=new Map(),access=new Map(),refresh=new Map();
const rand=()=>crypto.randomBytes(32).toString('base64url');
const digest=token=>crypto.createHash('sha256').update(token).digest('base64url');
const now=()=>Date.now();
const CODE_TTL=120000,REQUEST_TTL=600000,ACCESS_TTL=3600000,REFRESH_TTL=7*86400000;
const LIMIT={requests:500,codes:500,access:1000,refresh:1000};
const scopes=['editor.read','editor.write'];
const origin=()=>process.env.APP_ORIGIN||new URL(process.env.GOOGLE_REDIRECT_URI||'http://localhost:3001/auth/google/callback').origin;
const resource=()=>origin()+'/api/bridge/mcp';
const asUrl=()=>origin();
const denial=(res,status,err)=>res.status(status).set('Cache-Control','no-store').json({error:err});
const limited=(map,max)=>{if(map.size>=max)throw Error('OAuth temporary capacity reached');};
function validRedirect(s){
 if(typeof s!=='string'||s.length>500)return false;
 try{
  const u=new URL(s);
  if(u.protocol!=='https:'||u.host!=='chatgpt.com'||u.search||u.hash)return false;
  return u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[a-zA-Z0-9_-]{6,130}$/.test(u.pathname);
 }catch{return false}
}
function parseScopes(value){
 if(typeof value!=='string')return null;
 const list=value.split(/\s+/).filter(Boolean);
 if(!list.length||list.some(s=>!scopes.includes(s)))return null;
 return [...new Set(list)];
}
// The public OAuth client ID deterministically represents a validated ChatGPT
// callback. DCR registration therefore survives a Render restart without needing
// to store any user credentials, secrets, or client records in memory.
const clientForRedirect=uri=>'acs_'+digest('chatgpt-client:'+uri);
function allowedClient(clientId,redirectUri){
 return Boolean(validRedirect(redirectUri)&&clientId===clientForRedirect(redirectUri));
}
function requestParams(query){
 const {response_type,client_id,redirect_uri,code_challenge_method,code_challenge,resource:aud,scope,state}=query;
 if(response_type!=='code'||typeof client_id!=='string'||typeof redirect_uri!=='string'||!allowedClient(client_id,redirect_uri))return null;
 if(code_challenge_method!=='S256'||typeof code_challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code_challenge))return null;
 if(aud!==resource()||typeof state!=='string'||state.length<8||state.length>500)return null;
 const requested=parseScopes(scope||'editor.read editor.write');
 if(!requested)return null;
 return {clientId:client_id,redirectUri:redirect_uri,challenge:code_challenge,resource:aud,scopes:requested,state};
}
function challengeHeader(){
 return 'Bearer resource_metadata="'+origin()+'/.well-known/oauth-protected-resource", scope="editor.read editor.write"';
}
export function oauthChallenge(res){
 return res.status(401).set('WWW-Authenticate',challengeHeader()).set('Cache-Control','no-store').json({error:'MCP OAuth sign-in required'});
}
export function mcpIdentity(token){
 if(typeof token!=='string'||!token)return null;
 const found=access.get(digest(token));
 return found&&found.expires>now()&&found.resource===resource()&&found.scopes.includes('editor.read')?found:null;
}
export function revokeMcpTokensForOwner(ownerId){
 if(!ownerId)return;
 for(const [k,v] of access)if(v.ownerId===ownerId)access.delete(k);
 for(const [k,v] of refresh)if(v.ownerId===ownerId)refresh.delete(k);
}
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
router.get('/.well-known/oauth-protected-resource',(req,res)=>res.json({
 resource:resource(),authorization_servers:[asUrl()],scopes_supported:scopes,
 bearer_methods_supported:['header']
}));
router.get('/.well-known/oauth-protected-resource/api/bridge/mcp',(req,res)=>res.json({
 resource:resource(),authorization_servers:[asUrl()],scopes_supported:scopes,
 bearer_methods_supported:['header']
}));
router.get('/.well-known/oauth-authorization-server',(req,res)=>res.json({
 issuer:asUrl(),
 authorization_response_iss_parameter_supported:true,
 authorization_endpoint:origin()+'/oauth/authorize',
 token_endpoint:origin()+'/oauth/token',
 registration_endpoint:origin()+'/oauth/register',
 token_endpoint_auth_methods_supported:['none'],
 grant_types_supported:['authorization_code','refresh_token'],
 response_types_supported:['code'],
 code_challenge_methods_supported:['S256'],
 scopes_supported:scopes
}));
const registerLimiter=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false});
router.post('/oauth/register',registerLimiter,express.json({limit:'20kb'}),(req,res)=>{
 const b=req.body;
 if(!b||!Array.isArray(b.redirect_uris)||b.redirect_uris.length!==1
  ||!b.redirect_uris.every(validRedirect)
  ||(b.token_endpoint_auth_method&&b.token_endpoint_auth_method!=='none')
  ||(b.grant_types&&!b.grant_types.includes('authorization_code')))
  return denial(res,400,'invalid_client_metadata');
 const clientId=clientForRedirect(b.redirect_uris[0]);
 return res.status(201).json({client_id:clientId,client_id_issued_at:Math.floor(now()/1000),
  redirect_uris:[...new Set(b.redirect_uris)],token_endpoint_auth_method:'none',
  grant_types:['authorization_code','refresh_token'],response_types:['code'],
  client_name:'AutoCaption Studio via ChatGPT'});
});
const escaped=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function consentMarkup(requestId,account){
 return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Authorize ChatGPT - AutoCaption Studio</title>
 <style>body{font:16px system-ui,sans-serif;background:#101c30;color:#ebf3fc;min-height:100vh;display:grid;place-items:center;padding:20px}
 main{max-width:540px;border:1px solid #354760;background:#182844;padding:27px;border-radius:14px}
 p{line-height:1.5;color:#c7d3e4}button{border:0;border-radius:7px;padding:13px 22px;background:#8c9bff;color:#0a1425;font-weight:700;cursor:pointer}</style></head>
 <body><main><h1>Connect ChatGPT to AutoCaption Studio</h1><p>Signed in as <strong>${escaped(account.email||'Google account')}</strong>.</p>
 <p>Allow ChatGPT to read the file names, captions and timeline metadata in the browser you connect, and propose editing commands? You still approve every edit on screen. Original video bytes stay in your browser.</p>
 <p>Only the editor belonging to this same Google account can be controlled. This connection may expire when the service restarts.</p>
 <form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${escaped(requestId)}">
 <button name="decision" value="approve" type="submit">Authorize ChatGPT</button>
 <button name="decision" value="deny" type="submit" style="background:#73819b;margin-left:8px">Deny</button></form></main></body></html>`;
}
const oauthLimiter=rateLimit({windowMs:15*60000,limit:45,standardHeaders:'draft-7',legacyHeaders:false});
router.get('/oauth/authorize',oauthLimiter,(req,res)=>{
 const parsed=requestParams(req.query);
 if(!parsed)return res.status(400).send('Invalid OAuth request. Restart your ChatGPT connection.');
 const account=getGoogleAccount(req);
 if(!account){
  const returnTo='/oauth/authorize?'+new URLSearchParams(req.query).toString();
  if(returnTo.length>2500)return res.status(400).send('OAuth request too long');
  return res.redirect('/auth/google/start?return_to='+encodeURIComponent(returnTo));
 }
 try{limited(requests,LIMIT.requests)}catch{return res.status(429).send('Too many OAuth authorizations; retry later')}
 const key=rand();requests.set(digest(key),{...parsed,ownerId:account.userId,loginId:account.loginId,expires:now()+REQUEST_TTL});
 // OAuth consent is posted to our own server, then redirected to ChatGPT.
// CSP form-action is checked across redirects in Chromium; restricting it to
// 'self' silently blocked the callback and consumed the one-time request.
 res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'");
 return res.type('html').send(consentMarkup(key,account));
});
router.post('/oauth/authorize',oauthLimiter,express.urlencoded({extended:false,limit:'4kb'}),(req,res)=>{
 const key=typeof req.body?.request_id==='string'?req.body.request_id:'',pending=key&&requests.get(digest(key));
 if(key)requests.delete(digest(key));
 const account=getGoogleAccount(req);
 if(!pending||pending.expires<now()||!account||pending.ownerId!==account.userId||pending.loginId!==account.loginId)
  return res.status(403).send('Authorization expired. Please restart from ChatGPT.');
 const originHeader=req.get('Origin');
 if(originHeader&&originHeader!==origin())return res.status(403).send('Invalid authorization origin');
 const u=new URL(pending.redirectUri);
 u.searchParams.set('state',pending.state);u.searchParams.set('iss',origin());
 if(req.body.decision!=='approve'){u.searchParams.set('error','access_denied');return res.redirect(303,u.toString())}
 try{limited(codes,LIMIT.codes)}catch{return res.status(429).send('Too many authorization requests')}
 const code=rand();
 codes.set(digest(code),{ownerId:pending.ownerId,clientId:pending.clientId,redirectUri:pending.redirectUri,
  resource:pending.resource,scopes:pending.scopes,challenge:pending.challenge,expires:now()+CODE_TTL});
 u.searchParams.set('code',code);
 return res.redirect(303,u.toString());
});
const tokenLimiter=rateLimit({windowMs:15*60000,limit:100,standardHeaders:'draft-7',legacyHeaders:false});
router.post('/oauth/token',tokenLimiter,express.urlencoded({extended:false,limit:'8kb'}),(req,res)=>{
 const b=req.body||{},method=b.grant_type;
 if(typeof b.client_id!=='string'||!b.client_id.startsWith('acs_'))return denial(res,401,'invalid_client');
 if(b.resource!==resource())return denial(res,400,'invalid_target');
 if(method==='authorization_code'){
  if(typeof b.code!=='string'||typeof b.redirect_uri!=='string'||typeof b.code_verifier!=='string')
   return denial(res,400,'invalid_request');
  const key=digest(b.code),issued=codes.get(key);
  if(issued)codes.delete(key);
  if(!issued||issued.expires<now()||issued.clientId!==b.client_id||
   issued.redirectUri!==b.redirect_uri||issued.resource!==b.resource)return denial(res,400,'invalid_grant');
  const verifier=b.code_verifier;
  if(verifier.length<43||verifier.length>128||!/^[A-Za-z0-9._~-]+$/.test(verifier)||digest(verifier)!==issued.challenge)
   return denial(res,400,'invalid_grant');
  try{limited(access,LIMIT.access);limited(refresh,LIMIT.refresh)}catch{return denial(res,429,'temporarily_unavailable')}
  const newAccess=rand(),newRefresh=rand();
  access.set(digest(newAccess),{ownerId:issued.ownerId,clientId:issued.clientId,
   resource:issued.resource,scopes:issued.scopes,expires:now()+ACCESS_TTL});
  refresh.set(digest(newRefresh),{ownerId:issued.ownerId,clientId:issued.clientId,
   resource:issued.resource,scopes:issued.scopes,expires:now()+REFRESH_TTL});
  return res.json({access_token:newAccess,refresh_token:newRefresh,token_type:'Bearer',expires_in:ACCESS_TTL/1000,scope:issued.scopes.join(' ')});
 }
 if(method==='refresh_token'){
  if(typeof b.refresh_token!=='string')return denial(res,400,'invalid_request');
  const key=digest(b.refresh_token),old=refresh.get(key);
  if(old)refresh.delete(key); // single-use rotating refresh credentials
  if(!old||old.expires<now()||old.clientId!==b.client_id||old.resource!==b.resource)return denial(res,400,'invalid_grant');
  try{limited(access,LIMIT.access);limited(refresh,LIMIT.refresh)}catch{return denial(res,429,'temporarily_unavailable')}
  const newAccess=rand(),newRefresh=rand();
  access.set(digest(newAccess),{...old,expires:now()+ACCESS_TTL});
  refresh.set(digest(newRefresh),{...old,expires:now()+REFRESH_TTL});
  return res.json({access_token:newAccess,refresh_token:newRefresh,token_type:'Bearer',expires_in:ACCESS_TTL/1000,scope:old.scopes.join(' ')});
 }
 return denial(res,400,'unsupported_grant_type');
});
setInterval(()=>{
 for(const [k,v] of requests)if(v.expires<=now())requests.delete(k);
 for(const [k,v] of codes)if(v.expires<=now())codes.delete(k);
 for(const [k,v] of access)if(v.expires<=now())access.delete(k);
 for(const [k,v] of refresh)if(v.expires<=now())refresh.delete(k);
},60000).unref();
export default router;
