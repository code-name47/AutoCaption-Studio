import {test,expect} from '@playwright/test';

// A real browser creates JPEGs from an imported image and sends them only after
// the user clicks the consent button. The MCP client never requests source bytes.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');

test('user explicitly shares rendered visual stills and can revoke them in the same browser',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/__integration/login');
 await expect(page.locator('.ve-shell')).toBeVisible();
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({
  name:'review-photo.png',mimeType:'image/png',buffer:png
 });
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-media-item button').first().click();
 await expect(page.locator('.ve-clip')).toHaveCount(1);
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 const linked=page.waitForResponse(r=>r.url().endsWith('/api/bridge/session')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Connect AI editing bridge'}).click();
 const {token}=await (await linked).json();
 await expect(page.getByText('Browser synced and ready')).toBeVisible();

 const rpc=async(name,id)=>{
  const response=await request.post('/api/bridge/mcp',{
   headers:{Authorization:'Bearer '+token},
   data:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:{}}}
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).result;
 };
 let project=await rpc('get_editor_project',1);
 expect(project.content.filter(c=>c.type==='image')).toHaveLength(0);
 await page.getByTestId('share-ai-visual-review').click();
 await expect(page.getByTestId('ai-visual-review-status')).toContainText('6 still images',{timeout:30000});
 project=await rpc('get_editor_project',2);
 expect(project.content.filter(c=>c.type==='image')).toHaveLength(6);
 expect(project.content.filter(c=>c.type==='image').every(c=>c.mimeType==='image/jpeg')).toBe(true);
 const metadata=JSON.parse(project.content[1].text).visual_review;
 expect(metadata.frame_times).toHaveLength(6);
 expect(metadata.expires_at).toBeGreaterThan(Date.now());
 const directly=await rpc('get_editor_visual_review',3);
 expect(directly.content.filter(c=>c.type==='image')).toHaveLength(6);
 await page.getByRole('button',{name:'Revoke shared preview frames'}).click();
 await expect(page.getByTestId('ai-visual-review-status')).toHaveCount(0);
 project=await rpc('get_editor_project',4);
 expect(project.content.filter(c=>c.type==='image')).toHaveLength(0);
 expect(errors).toEqual([]);
 const disconnected=await page.context().request.delete('/api/bridge/session',{headers:{Authorization:'Bearer '+token}});
 expect(disconnected.ok()).toBe(true);
});
