import crypto from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';
import {revokeBridgeSessionsForLogin} from './bridge.js';

const router=Router();
const pending=new Map();
const accounts=new Map();
const TTL=10*60*1000;
const random=()=>crypto.randomBytes(32).toString('base64url');
const digest=value=>crypto.createHash('sha256').update(value).digest('base64url');
const cookieName='acs_google_session';
const stateCookie='acs_oauth_state';
const secure=process.env.NODE_ENV==='production';
const redirect=()=>process.env.GOOGLE_REDIRECT_URI;
const configured=()=>Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&redirect());
const cookieOptions={httpOnly:true,secure,sameSite:'lax',path:'/auth/google'};
function cookies(req){return Object.fromEntries((req.get('cookie')||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(a=>a[0]));}
function current(req){const token=cookies(req)[cookieName];const a=token&&accounts.get(digest(token));return a&&a.expires>Date.now()?a:null;}
export function getGoogleAccount(req){return current(req);}
// Only the isolated integration-test server invokes this helper. It does not
// create any new HTTP routes and is disabled whenever NODE_ENV is not test.
export function createBrowserLoginForIntegrationTest(){
 if(process.env.NODE_ENV!=='test')throw Error('Test login unavailable outside NODE_ENV=test');
 const token=random();
 const key=digest(token);
 accounts.set(key,{loginId:key,userId:'ai-integration-test-owner',email:'integration-test@example.invalid',
  accessToken:'',expires:Date.now()+10*60*1000});
 return {cookieName,cookieValue:token};
}

export function requireGoogleAccount(req,res,next){const account=current(req);if(!account)return res.status(401).json({error:'Sign in with Google to connect an AI client'});req.googleAccount=account;next();}
router.get('/status',(req,res)=>res.set('Cache-Control','no-store').json({configured:configured(),connected:Boolean(current(req))}));
router.get('/start',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}),(req,res)=>{
 if(!configured())return res.status(503).send('Google OAuth is not configured on this server.');
 const state=random(),verifier=random();
 pending.set(digest(state),{verifier,expires:Date.now()+TTL});
 res.cookie(stateCookie,state,{...cookieOptions,maxAge:TTL});
 const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect(),response_type:'code',scope:'openid email profile https://www.googleapis.com/auth/drive.file',access_type:'online',include_granted_scopes:'true',state,code_challenge:digest(verifier),code_challenge_method:'S256',prompt:'consent'});
 return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params);
});
router.get('/callback',async(req,res)=>{
 const state=typeof req.query.state==='string'?req.query.state:'';
 const expected=cookies(req)[stateCookie];
 res.clearCookie(stateCookie,cookieOptions);
 const p=state&&pending.get(digest(state));
 if(state)pending.delete(digest(state));
 if(!p||p.expires<Date.now()||!expected||state!==expected||typeof req.query.code!=='string')return res.status(400).send('Invalid or expired Google sign-in. Please restart from AutoCaption Studio.');
 try{
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:req.query.code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect(),grant_type:'authorization_code',code_verifier:p.verifier}),signal:AbortSignal.timeout(15000)});
  if(!tokenResponse.ok)return res.status(400).send('Google authorization failed. Please try again.');
  const tokens=await tokenResponse.json();
  const infoResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(15000)});
  if(!infoResponse.ok)return res.status(400).send('Could not verify Google account.');
  const info=await infoResponse.json();
  if(!info.sub)return res.status(400).send('Google account identity unavailable.');
  const session=random();
  accounts.set(digest(session),{loginId:digest(session),userId:info.sub,email:info.email||'',accessToken:tokens.access_token,expires:Date.now()+Math.min(Number(tokens.expires_in||3600)*1000,3600000)});
  res.cookie(cookieName,session,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:3600000});
  return res.redirect('/?google=connected');
 }catch{return res.status(502).send('Google sign-in could not be completed. Please try again.')}
});
router.get('/me',(req,res)=>{const a=current(req);return res.set('Cache-Control','no-store').json(a?{connected:true,email:a.email}:{connected:false})});
// Google Picker runs in the browser with a short-lived Google access token.
// Only expose this token to the signed-in first-party page; never persist it client-side.
function sameOrigin(req,res,next){const origin=req.get('Origin');if(origin&&origin!==new URL(redirect()).origin)return res.status(403).json({error:'Invalid origin'});next()}
router.get('/picker-config',sameOrigin,(req,res)=>{const a=current(req);if(!a)return res.status(401).json({error:'Connect Google first'});if(!process.env.GOOGLE_PICKER_API_KEY)return res.status(503).json({error:'GOOGLE_PICKER_API_KEY is missing in Render'});res.set('Cache-Control','no-store').json({accessToken:a.accessToken,apiKey:process.env.GOOGLE_PICKER_API_KEY,appId:process.env.GOOGLE_CLOUD_PROJECT_NUMBER||''})});
// Folder access is limited to files authorized for this app under drive.file.
// A picked folder does not automatically grant access to every existing child.
router.get('/folder/:id/files',sameOrigin,requireGoogleAccount,async(req,res)=>{
 const folderId=req.params.id;
 if(!/^[a-zA-Z0-9_-]{10,160}$/.test(folderId))return res.status(400).json({error:'Invalid folder ID'});
 try{
  const params=new URLSearchParams({q:"'"+folderId+"' in parents and trashed = false",fields:'nextPageToken,files(id,name,mimeType,size)',page_size:'100'});
  const files=[];let pageToken='';
  for(let page=0;page<5;page++){
   if(pageToken)params.set('pageToken',pageToken);else params.delete('pageToken');
   const response=await fetch('https://www.googleapis.com/drive/v3/files?'+params,{headers:{Authorization:'Bearer '+req.googleAccount.accessToken},signal:AbortSignal.timeout(15000)});
   if(!response.ok)return res.status(response.status===401||response.status===403?403:502).json({error:'Google Drive cannot list this folder with current permissions. The drive.file scope may not grant access to all existing videos.'});
   const data=await response.json();
   files.push(...(data.files||[]).filter(f=>typeof f.mimeType==='string'&&(f.mimeType.startsWith('video/')||f.mimeType.startsWith('audio/'))).map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,size:Number(f.size||0)})));
   pageToken=data.nextPageToken||'';if(!pageToken)break;
  }
  return res.set('Cache-Control','no-store').json({files,partial:Boolean(pageToken),permissionNote:'Google drive.file access may only show files individually authorized for AutoCaption Studio.'});
 }catch{return res.status(502).json({error:'Could not list Google Drive folder'})}
});
router.get('/file/:id',sameOrigin,async(req,res)=>{
 const a=current(req);if(!a)return res.status(401).json({error:'Connect Google first'});
 const fileId=req.params.id;
 if(!/^[a-zA-Z0-9_-]{10,160}$/.test(fileId))return res.status(400).json({error:'Invalid file ID'});
 try{
  const metadata=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields=id,name,mimeType,size',{headers:{Authorization:'Bearer '+a.accessToken},signal:AbortSignal.timeout(15000)});
  if(!metadata.ok)return res.status(metadata.status===403?403:502).json({error:'Google Drive file access denied or unavailable'});
  const info=await metadata.json();
  if(!/^(video|audio)\//.test(info.mimeType||''))return res.status(415).json({error:'Choose a video or audio file'});
  if(Number(info.size)>150*1024*1024)return res.status(413).json({error:'File exceeds 150 MB limit'});
  const media=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media',{headers:{Authorization:'Bearer '+a.accessToken},signal:AbortSignal.timeout(120000)});
  if(!media.ok)return res.status(502).json({error:'Could not download the selected Drive file'});
  const maxBytes=150*1024*1024;
  const length=Number(media.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes)return res.status(413).end();
  let total=0;
  const chunks=[];
  for await(const chunk of media.body){total+=chunk.byteLength;if(total>maxBytes)return res.status(413).end();chunks.push(Buffer.from(chunk));}
  res.set({'Content-Type':info.mimeType,'X-Media-Filename':encodeURIComponent(info.name||'drive-media'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  return res.end(Buffer.concat(chunks,total));
 }catch{return res.status(502).json({error:'Google Drive transfer failed'})}
});
router.post('/logout',sameOrigin,(req,res)=>{const token=cookies(req)[cookieName];if(token){revokeBridgeSessionsForLogin(digest(token));accounts.delete(digest(token));}res.clearCookie(cookieName,{httpOnly:true,secure,sameSite:'lax',path:'/'});res.json({ok:true})});
setInterval(()=>{for(const [k,v] of pending)if(v.expires<Date.now())pending.delete(k);for(const [k,v] of accounts)if(v.expires<Date.now())accounts.delete(k)},60000).unref();
export default router;
