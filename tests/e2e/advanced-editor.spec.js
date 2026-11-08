import {test,expect} from '@playwright/test';

test('timeline track-name header resizes horizontally and persists after reload',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.ve-shell')).toBeVisible();
 const handle=page.getByRole('separator',{name:'Resize timeline track-name column'});
 await expect(handle).toBeVisible();
 await handle.focus();await handle.press('ArrowRight');
 await expect(handle).toHaveAttribute('aria-valuenow','124');
 const rect=await page.locator('.ve-track-label').first().boundingBox();
 expect(Math.round(rect.width)).toBe(124);
 await page.reload();
 await expect(page.getByRole('separator',{name:'Resize timeline track-name column'})).toHaveAttribute('aria-valuenow','124');
 const again=page.getByRole('separator',{name:'Resize timeline track-name column'});
 await again.focus();await again.press('Shift+ArrowRight');
 await expect(again).toHaveAttribute('aria-valuenow','148');
 await again.dblclick();
 await expect(again).toHaveAttribute('aria-valuenow','116');
});

test('green-screen edit creates keyed preview canvas for an imported image, with actual transparent pixels',async({page})=>{
 await page.goto('/');
 const png=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=64;c.height=64;
  const ctx=c.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,64,64);
  ctx.fillStyle='#ff0000';ctx.fillRect(20,20,24,24);
  return c.toDataURL('image/png').split(',')[1];
 });
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({
  name:'greenscreen.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')
 });
 await page.locator('.ve-media-item button').first().click();
 await expect(page.locator('.ve-clip')).toHaveCount(1);
 await page.getByLabel('Enable chroma key').check();
 await expect(page.locator('canvas.ve-chroma-layer')).toBeVisible();
 await expect.poll(async()=>await page.locator('canvas.ve-chroma-layer').evaluate(el=>{
  const ctx=el.getContext('2d');if(!ctx||!el.width)return null;
  const empty=ctx.getImageData(Math.floor(el.width*.1),Math.floor(el.height*.1),1,1).data[3];
  const colored=ctx.getImageData(Math.floor(el.width*.5),Math.floor(el.height*.5),1,1).data[3];
  return empty<20&&colored>200;
 })).toBe(true);
});

test('timeline markers save/reopen and locked media cannot be deleted until unlocked',async({page})=>{
 await page.goto('/');
 const png=await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=32;c.height=32;
  c.getContext('2d').fillRect(0,0,32,32);
  return c.toDataURL('image/png').split(',')[1];
 });
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({
  name:'marker-and-lock.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')
 });
 await page.locator('.ve-media-item button').first().click();
 await page.getByRole('button',{name:'Add marker at playhead'}).click();
 await expect(page.locator('.ve-ruler-marker')).toHaveCount(1);
 await page.getByLabel('Lock clip').check();
 await expect(page.locator('.ve-clip-locked')).toHaveCount(1);
 await page.locator('.ve-inspector-tools').getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.locator('.ve-clip-locked')).toHaveCount(1);
 await page.getByLabel('Lock clip').uncheck();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.ve-top-state')).toContainText('Project saved');
 await page.reload();
 await page.locator('.ve-side-tabs button[title="Export"]').click();
 await page.getByRole('button',{name:'Open saved browser project'}).click();
 await expect(page.locator('.ve-ruler-marker')).toHaveCount(1);
 await expect(page.locator('.ve-clip')).toHaveCount(1);
 await page.locator('.ve-ruler-marker').first().click({button:'right',timeout:7000});
 await expect(page.locator('.ve-ruler-marker')).toHaveCount(0);
});
