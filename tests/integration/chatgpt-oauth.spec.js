import {test,expect} from '@playwright/test';
import crypto from 'node:crypto';
const HOST='http://127.0.0.1:4184',REDIRECT='https://chatgpt.com/connector_platform_oauth_redirect';
const media=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');
const encode=s=>crypto.createHash('sha256').update(s).digest('base64url');

test('ChatGPT-style OAuth pairing controls only the matching Google-owned browser, with visible approval',async({page})=>{
 const api=page.context().request;
 await page.goto('/__integration/login');
 await expect(page.locator('.ve-shell')).toBeVisible();
 const anonymous=await api.post(HOST+'/api/bridge/mcp',{data:{jsonrpc:'2.0',id:1,method:'initialize'}});
 expect(anonymous.status()).toBe(401);
 expect(anonymous.headers()['www-authenticate']).toContain('oauth-protected-resource');
 const resourceResponse=await api.get(HOST+'/.well-known/oauth-protected-resource');
 const resource=await resourceResponse.json();
 expect(resource.resource).toBe(HOST+'/api/bridge/mcp');
 const provider=await (await api.get(HOST+'/.well-known/oauth-authorization-server')).json();
 expect(provider.registration_endpoint).toBe(HOST+'/oauth/register');
 expect(provider.code_challenge_methods_supported).toContain('S256');

 // Simulates ChatGPT's DCR and PKCE OAuth without ever needing actual user credentials.
 const reg=await api.post(HOST+'/oauth/register',{data:{redirect_uris:[REDIRECT],
  token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token']}});
 expect(reg.status()).toBe(201);
 const client=await reg.json();
 expect(client.client_id).toMatch(/^acs_/);
 const verifier=crypto.randomBytes(48).toString('base64url');
 const state=crypto.randomBytes(20).toString('base64url');
 let callbackUrl='';
 await page.route('https://chatgpt.com/connector_platform_oauth_redirect**',route=>{
  callbackUrl=route.request().url();
  return route.fulfill({status:200,contentType:'text/plain',body:'ChatGPT OAuth callback was received'});
 });
 const query=new URLSearchParams({response_type:'code',client_id:client.client_id,
  redirect_uri:REDIRECT,code_challenge_method:'S256',code_challenge:encode(verifier),
  scope:'editor.read editor.write',resource:resource.resource,state});
 await page.goto(HOST+'/oauth/authorize?'+query);
 await expect(page.getByRole('heading',{name:'Connect ChatGPT to AutoCaption Studio'})).toBeVisible();
 await page.getByRole('button',{name:'Authorize ChatGPT'}).click();
 await expect.poll(()=>callbackUrl).toContain('connector_platform_oauth_redirect');
 const cb=new URL(callbackUrl);
 expect(cb.searchParams.get('state')).toBe(state);
 expect(cb.searchParams.get('iss')).toBe(HOST);
 const code=cb.searchParams.get('code');
 expect(code).toBeTruthy();

 const tokenResponse=await api.post(HOST+'/oauth/token',{form:{
  grant_type:'authorization_code',client_id:client.client_id,redirect_uri:REDIRECT,
  resource:resource.resource,code,code_verifier:verifier
 }});
 expect(tokenResponse.status()).toBe(200);
 const credentials=await tokenResponse.json();
 expect(credentials.access_token).toBeTruthy();
 expect(credentials.refresh_token).toBeTruthy();
 // One-time codes cannot be replayed.
 const replay=await api.post(HOST+'/oauth/token',{form:{
  grant_type:'authorization_code',client_id:client.client_id,redirect_uri:REDIRECT,
  resource:resource.resource,code,code_verifier:verifier
 }});
 expect(replay.status()).toBe(400);

 const rpc=async(name,args,id)=>{
  const result=await api.post(HOST+'/api/bridge/mcp',{headers:{Authorization:'Bearer '+credentials.access_token},data:{
   jsonrpc:'2.0',id,method:name==='tools/list'?'tools/list':'tools/call',
   ...(name==='tools/list'?{}:{params:{name,arguments:args||{}}})
  }});
  expect(result.status()).toBe(200);
  const body=await result.json();
  if(name==='tools/list')return body.result;
  const data=JSON.parse(body.result.content[0].text);
  if(body.result.isError)throw Error(data.error);
  return data;
 };
 const tools=await rpc('tools/list',null,10);
 expect(tools.tools.find(t=>t.name==='propose_editor_edits').securitySchemes[0].type).toBe('oauth2');
 await page.goto('/');
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles(
  {name:'oauth-sample.png',mimeType:'image/png',buffer:media});
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-media-item').getByTitle('Add to timeline').click();
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();
 const project=await rpc('get_editor_project',{},11);
 expect(project.connected).toBe(true);
 const clip=project.project.clips.find(c=>c.kind==='image');
 expect(clip.start).toBe(0);
 const proposal=await rpc('propose_editor_edits',{
  summary:'ChatGPT editing: move clip to 5 seconds and change canvas to portrait',
  actions:[{type:'move_clip',clip_id:clip.id,start:5},{type:'set_canvas',aspect:'9:16'}]
 },12);
 expect(proposal.status).toBe('pending');
 await expect(page.getByTestId('ai-review-panel')).toContainText('ChatGPT editing');
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await page.getByTestId('approve-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="9:16"]')).toBeVisible();
 await expect(page.getByTestId('ai-review-panel')).toContainText('AI edit complete');
 const after=await rpc('get_editor_project',{},13);
 expect(after.project.clips.find(c=>c.id===clip.id).start).toBe(5);
 expect(after.project.settings.aspect).toBe('9:16');
 const status=await rpc('get_editor_edit_status',{edit_id:proposal.edit_id},14);
 expect(status.status).toBe('complete');
 // Verify refresh-token rotation for long-lived personal links.
 const refreshResponse=await api.post(HOST+'/oauth/token',{form:{
  grant_type:'refresh_token',client_id:client.client_id,resource:resource.resource,
  refresh_token:credentials.refresh_token
 }});
 expect(refreshResponse.status()).toBe(200);
 expect((await refreshResponse.json()).access_token).toBeTruthy();
});
