import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');
const evidence=path.join(process.cwd(),'test-results','ai-run-evidence');

test('AI MCP client edits the REAL browser timeline after human approval, with recorded visual proof',async({page,request})=>{
 await fs.mkdir(evidence,{recursive:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await page.goto('/__integration/login');
 expect(login?.status()).toBe(200);
 await expect(page.locator('.ve-shell')).toBeVisible();

 // Begin with a genuine imported browser file and a real timeline clip.
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles(
  {name:'sample-footage.png',mimeType:'image/png',buffer:png}
 );
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-media-item').getByTitle('Add to timeline').click();
 await expect(page.locator('.ve-track-row').nth(2).locator('.ve-clip')).toHaveCount(1);
 await page.screenshot({path:path.join(evidence,'01-before-AI.png'),fullPage:true});

 // The editor itself creates the token, and the test AI client receives it
 // from the actual authentication response. Never print or log the bearer.
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 const sessionResponse=page.waitForResponse(r=>r.url().endsWith('/api/bridge/session')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 const session=await (await sessionResponse).json();
 expect(typeof session.token).toBe('string');
 await expect(page.getByText('Browser synced and ready')).toBeVisible();

 const rpc=async(method,params,id)=>{
  const res=await request.post('/api/bridge/mcp',{
   headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},
   data:{jsonrpc:'2.0',id,method,...(params?{params}:{})}
  });
  expect(res.status()).toBe(200);
  const body=await res.json();
  if(body.error)throw Error('MCP error: '+body.error.message);
  if(method==='tools/call'){
   const output=JSON.parse(body.result.content?.[0]?.text||'null');
   if(body.result.isError)throw Error('MCP tool error: '+output?.error);
   return output;
  }
  return body.result;
 };
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'AI-Editing-Run-Test',version:'1.0'}},1);
 expect(init.serverInfo.name).toBe('autocaption-studio');
 const tools=await rpc('tools/list',null,2);
 expect(tools.tools.some(t=>t.name==='propose_editor_edits')).toBe(true);

 // This is a real MCP tool invocation, NOT a mocked bridge or a demo button.
 const before=await rpc('tools/call',{name:'get_editor_project',arguments:{}},3);
 expect(before.connected).toBe(true);
 const originalClip=before.project.clips.find(c=>c.kind==='image');
 expect(originalClip).toBeTruthy();
 expect(originalClip.start).toBe(0);
 expect(before.project.settings.aspect).toBe('16:9');

 const proposal=await rpc('tools/call',{name:'propose_editor_edits',arguments:{
  summary:'AI: move sample footage to 5 seconds, make the canvas portrait and place a title',
  actions:[
   {type:'move_clip',clip_id:originalClip.id,start:5},
   {type:'set_canvas',aspect:'9:16'},
   {type:'add_text',track_id:'T1',start:5,duration:3,text:'AI EDITED THIS VIDEO'}
  ]
 }},4);
 expect(proposal.status).toBe('pending');
 await expect(page.getByTestId('ai-review-panel')).toBeVisible();
 await expect(page.getByTestId('ai-review-panel')).toContainText('AI: move sample footage');
 await page.screenshot({path:path.join(evidence,'02-AI-proposal-on-screen.png'),fullPage:true});

 // Approval is an explicit browser action. Before it, MCP cannot mutate the project.
 const stillBefore=await rpc('tools/call',{name:'get_editor_project',arguments:{}},5);
 expect(stillBefore.project.clips.find(c=>c.id===originalClip.id).start).toBe(0);
 expect(stillBefore.project.settings.aspect).toBe('16:9');

 await page.getByTestId('approve-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="9:16"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(1);
 await expect(page.getByTestId('ai-review-panel')).toContainText('AI edit complete',{timeout:15_000});
 await page.screenshot({path:path.join(evidence,'03-AI-edited-portrait-timeline.png'),fullPage:true});

 const after=await rpc('tools/call',{name:'get_editor_project',arguments:{}},6);
 expect(after.project.settings.aspect).toBe('9:16');
 expect(after.project.clips.find(c=>c.id===originalClip.id)?.start).toBe(5);
 expect(after.project.clips.some(c=>c.kind==='text'&&c.text==='AI EDITED THIS VIDEO')).toBe(true);
 const status=await rpc('tools/call',{name:'get_editor_edit_status',arguments:{edit_id:proposal.edit_id}},7);
 expect(status.status).toBe('complete');
 expect(status.progress).toBe(3);
 expect(errors).toEqual([]);

 // The browser video and screenshots are uploaded from GitHub Actions after passing.
 // Disconnect the integration browser before the next OAuth test runs.
 // Each browser session is private and multiple active sessions must not be auto-selected.
 const closed=await page.context().request.delete('http://127.0.0.1:4184/api/bridge/session',{
  headers:{Authorization:'Bearer '+session.token}
 });
 expect(closed.ok()).toBe(true);
 await fs.writeFile(path.join(evidence,'AI_RUN_RESULT.txt'),[
  'PASSED: actual MCP JSON-RPC initialize, tools/list, get_editor_project, propose_editor_edits, status.',
  'PASSED: real browser received the AI proposal, required approval, updated live and produced video/screenshots.',
  'Verified state: original image clip moved from 0s to 5s; canvas switched 16:9 -> 9:16; title text inserted.',
  'No Google Drive credentials, private footage, or session tokens are included in these artifacts.'
 ].join('\n'));
});
