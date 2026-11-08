import {test,expect} from '@playwright/test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');

async function dragBy(page,locator,dx,dy){
 const box=await locator.boundingBox();
 expect(box).not.toBeNull();
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x+dx,y+dy,{steps:10});
 await page.mouse.up();
}
test('docked panels resize by dragging splitters and persist after reload',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('.ve-shell')).toBeVisible();
 const media=page.locator('.ve-left'),monitor=page.locator('.ve-monitor-panel'),inspector=page.locator('.ve-inspector');
 const mediaBefore=await media.boundingBox(),monitorBefore=await monitor.boundingBox();
 await dragBy(page,page.getByRole('separator',{name:'Resize Project Files panel'}),90,0);
 const mediaAfter=await media.boundingBox(),monitorAfter=await monitor.boundingBox();
 expect(mediaAfter.width).toBeGreaterThan(mediaBefore.width+60);
 expect(monitorAfter.width).toBeLessThan(monitorBefore.width-60);
 const inspectorBefore=await inspector.boundingBox();
 await dragBy(page,page.getByRole('separator',{name:'Resize Inspector panel'}),-55,0);
 const inspectorAfter=await inspector.boundingBox();
 expect(inspectorAfter.width).toBeGreaterThan(inspectorBefore.width+35);
 const timeline=page.locator('.ve-timeline'),timelineBefore=await timeline.boundingBox();
 await dragBy(page,page.getByRole('separator',{name:'Resize timeline height'}),0,-75);
 const timelineAfter=await timeline.boundingBox();
 expect(timelineAfter.height).toBeGreaterThan(timelineBefore.height+55);
 const leftSaved=mediaAfter.width,inspectSaved=inspectorAfter.width,heightSaved=timelineAfter.height;
 await page.reload();
 await expect(page.locator('.ve-shell')).toBeVisible();
 const leftReopened=await page.locator('.ve-left').boundingBox();
 const inspectorReopened=await page.locator('.ve-inspector').boundingBox();
 const timelineReopened=await page.locator('.ve-timeline').boundingBox();
 expect(Math.abs(leftReopened.width-leftSaved)).toBeLessThan(3);
 expect(Math.abs(inspectorReopened.width-inspectSaved)).toBeLessThan(3);
 expect(Math.abs(timelineReopened.height-heightSaved)).toBeLessThan(3);
 await page.getByRole('button',{name:'Reset panels'}).click();
 const reset=await page.locator('.ve-left').boundingBox();
 expect(Math.abs(reset.width-300)).toBeLessThan(3);
 expect(errors).toEqual([]);
});

test('playhead handle scrubs on top of clips without selecting text or dragging clips',async({page})=>{
 await page.goto('/');
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({name:'timeline-image.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-media-item button').click();
 await expect(page.locator('.ve-track-row').nth(2).locator('.ve-clip')).toHaveCount(1);
 const head=page.getByTestId('playhead-handle');
 await expect(head).toBeVisible();
 await dragBy(page,head,90,0);
 const grip=page.getByRole('slider',{name:'Scrub timeline playhead'});
 await expect.poll(async()=>Number(await grip.getAttribute('aria-valuenow'))).toBeGreaterThan(2);
 const before=Number(await grip.getAttribute('aria-valuenow'));
 const line=await grip.boundingBox();
 const lane=await page.locator('.ve-track-row').nth(2).locator('.ve-track-content').boundingBox();
 const foreground=await page.evaluate(({x,y})=>{
  const el=document.elementFromPoint(x,y);
  return Boolean(el?.closest('.ve-playhead-grab'));
 },{x:line.x+line.width/2,y:lane.y+lane.height/2});
 expect(foreground).toBe(true);
 await dragBy(page,grip,35,0);
 await expect.poll(async()=>Number(await grip.getAttribute('aria-valuenow'))).toBeGreaterThan(before+.7);
 const selection=await page.evaluate(()=>String(window.getSelection()));
 expect(selection).toBe('');
 await expect(page.locator('.ve-track-row').nth(2).locator('.ve-clip')).toHaveCount(1);
});
