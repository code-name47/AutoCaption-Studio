import crypto from 'node:crypto';
import {Router} from 'express';
import rateLimit from 'express-rate-limit';

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
  accounts.set(digest(session),{userId:info.sub,email:info.email||'',accessToken:tokens.access_token,expires:Date.now()+Math.min(Number(tokens.expires_in||3600)*1000,3600000)});
  res.cookie(cookieName,session,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:3600000});
  return res.redirect('/?google=connected');
 }catch{return res.status(502).send('Google sign-in could not be completed. Please try again.')}
});
router.get('/me',(req,res)=>{const a=current(req);return res.set('Cache-Control','no-store').json(a?{connected:true,email:a.email}:{connected:false})});
router.post('/logout',(req,res)=>{const token=cookies(req)[cookieName];if(token)accounts.delete(digest(token));res.clearCookie(cookieName,{httpOnly:true,secure,sameSite:'lax',path:'/'});res.json({ok:true})});
setInterval(()=>{for(const [k,v] of pending)if(v.expires<Date.now())pending.delete(k);for(const [k,v] of accounts)if(v.expires<Date.now())accounts.delete(k)},60000).unref();
export default router;
