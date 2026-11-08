import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';

const HOST='http://127.0.0.1:4184';
const CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect';
const hash=s=>crypto.createHash('sha256').update(s).digest('base64url');

// Regression for real user report: first click appeared to do nothing and
// second click showed "Authorization expired". The original CSP allowed
// form-action 'self' but blocked the cross-origin 302/303 to ChatGPT.
// Do not replace the browser click with an API POST: that misses the bug.
test('Authorize ChatGPT button actually navigates the browser to the OAuth callback on FIRST click',async({page})=>{
 const browserErrors=[];
 page.on('console',m=>{if(m.type()==='error')browserErrors.push(m.text())});
 await page.goto('/__integration/login');
 const api=page.context().request;
 const registration=await api.post(HOST+'/oauth/register',{data:{
  redirect_uris:[CALLBACK],token_endpoint_auth_method:'none',
  grant_types:['authorization_code','refresh_token']
 }});
 expect(registration.status()).toBe(201);
 const {client_id}=await registration.json();
 const verifier=crypto.randomBytes(48).toString('base64url');
 const state=crypto.randomBytes(24).toString('base64url');
 const params=new URLSearchParams({
  response_type:'code',client_id,redirect_uri:CALLBACK,
  code_challenge_method:'S256',code_challenge:hash(verifier),
  scope:'editor.read editor.write',resource:HOST+'/api/bridge/mcp',state
 });

 // Stub only the external ChatGPT callback page, not the OAuth server.
 // The browser must really submit the consent form and follow the redirect.
 await page.route('https://chatgpt.com/connector_platform_oauth_redirect**',route=>
  route.fulfill({status:200,contentType:'text/html',body:'<html><body>ChatGPT callback reached</body></html>'}));
 await page.goto(HOST+'/oauth/authorize?'+params);
 await expect(page.getByRole('heading',{name:'Connect ChatGPT to AutoCaption Studio'})).toBeVisible();
 await page.getByRole('button',{name:'Authorize ChatGPT'}).click();
 await expect(page).toHaveURL(url=>url.origin==='https://chatgpt.com'&&url.pathname==='/connector_platform_oauth_redirect',{timeout:10000});
 // The real browser URL is the contract: the external ChatGPT page is not
 // loaded by CI and may have its own login/cookie restrictions.
 // Do not require content from a different origin to render in this test.
 expect(browserErrors.filter(s=>/Content Security Policy|form-action|Refused to send form data/i.test(s))).toEqual([]);
 const callback=new URL(page.url());
 expect(callback.searchParams.get('state')).toBe(state);
 expect(callback.searchParams.get('iss')).toBe(HOST);
 const code=callback.searchParams.get('code');
 expect(code).toBeTruthy();

 // Ensure the returned code can be exchanged for a scoped access token.
 const tokenResponse=await api.post(HOST+'/oauth/token',{form:{
  grant_type:'authorization_code',client_id,redirect_uri:CALLBACK,
  resource:HOST+'/api/bridge/mcp',code,code_verifier:verifier
 }});
 expect(tokenResponse.status()).toBe(200);
 const token=await tokenResponse.json();
 expect(token.scope).toContain('editor.write');
 expect(token.access_token).toBeTruthy();
});
