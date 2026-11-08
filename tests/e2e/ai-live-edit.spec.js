import {test,expect} from '@playwright/test';

// Tests the real React browser flow with a simulated remote MCP editor bridge.
// The server authorization/approval state is independently tested in Node unit tests.
async function mockBridge(page){
 const state={project:null,edit:null,approved:false,denied:false,steps:[],publications:0};
 await page.route('**/auth/google/me',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({connected:true,email:'tester@example.com'})}));
 await page.route('**/api/bridge/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path.endsWith('/session')&&route.request().method()==='POST')return send({token:'local-test-bridge',expiresInSeconds:1800});
  if(path.endsWith('/editor/snapshot')&&route.request().method()==='POST'){
   state.project=route.request().postDataJSON()?.project;state.publications++;
   return send({revision:'revision-in-test',connected:true});
  }
  if(path.endsWith('/editor/pending'))return send({revision:'revision-in-test',edit:state.approved||state.denied?null:state.edit});
  if(path.endsWith('/editor/demo')&&route.request().method()==='POST'){
   state.edit={id:'test-edit-1',summary:'Create a vertical demo title',status:'pending',baseRevision:'revision-in-test',
    actions:[{type:'set_canvas',aspect:'9:16'},{type:'add_text',text:'AI editing in progress',start:0,duration:3,track_id:'T1'}],
    steps:[{description:'Set canvas to 9:16'},{description:'Add title: AI editing in progress'}]};
   return send(state.edit,201);
  }
  if(path.endsWith('/review')&&route.request().method()==='POST'){
   const decision=route.request().postDataJSON()?.decision;
   state.approved=decision==='approve';state.denied=decision==='reject';
   return send({...state.edit,status:state.approved?'applying':'rejected'});
  }
  if(path.endsWith('/progress')&&route.request().method()==='POST'){
   state.steps.push(route.request().postDataJSON());
   return send({...route.request().postDataJSON(),id:'test-edit-1'});
  }
  return send({error:'Unmocked endpoint: '+path},404);
 });
 return state;
}
async function connect(page){
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();
}
test('AI edits appear in browser proposal, update canvas and timeline live, then revert',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const state=await mockBridge(page);
 await page.goto('/');
 await page.locator('.ve-side-tabs button[title="Titles"]').click();
 await page.locator('.ve-palette-item').first().click();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(1);
 await connect(page);
 await page.getByRole('button',{name:'Test live AI editing (approval required)'}).click();
 await expect(page.getByTestId('ai-review-panel')).toContainText('Create a vertical demo title');
 await expect(page.getByTestId('ai-review-panel')).toContainText('Set canvas to 9:16');
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await page.getByTestId('approve-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="9:16"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(2);
 await expect(page.getByTestId('ai-review-panel')).toContainText('AI edit complete');
 expect(state.approved).toBe(true);
 expect(state.steps.map(x=>x.progress)).toEqual([1,2,2]);
 expect(state.project.settings.aspect).toBe('9:16');
 await page.getByTestId('revert-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(1);
 expect(errors).toEqual([]);
});
test('AI proposal rejection never changes the timeline',async({page})=>{
 const state=await mockBridge(page);
 await page.goto('/');
 await connect(page);
 await page.getByRole('button',{name:'Test live AI editing (approval required)'}).click();
 await expect(page.getByTestId('ai-review-panel')).toBeVisible();
 await page.getByRole('button',{name:'Reject'}).click();
 await expect(page.getByTestId('ai-review-panel')).toHaveCount(0);
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await expect(page.locator('.ve-clip')).toHaveCount(0);
 expect(state.denied).toBe(true);
 expect(state.steps).toEqual([]);
});
