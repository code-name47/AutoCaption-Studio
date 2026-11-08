import {test,expect} from '@playwright/test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');

test('portrait and landscape canvas, small subtitle fonts and direct off-canvas editing',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await page.locator('.ve-side-tabs button[title="Titles"]').click();
 await page.locator('.ve-palette-item').first().click();
 await expect(page.locator('.ve-object-outline')).toBeVisible();
 await page.getByRole('button',{name:'9:16'}).click();
 await expect(page.locator('.ve-stage-frame[data-aspect="9:16"]')).toBeVisible();
 const fontsize=page.locator('.ve-inspector .ve-field').filter({hasText:'Font size'}).locator('input');
 await fontsize.fill('4');
 await expect(fontsize).toHaveValue('4');
 const scale=page.locator('.ve-object-outline .ve-corner-se');
 await expect(scale).toBeVisible();
 const rect=await scale.boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width/2+75,rect.y+rect.height/2+35,{steps:8});
 await page.mouse.up();
 await expect.poll(async()=>Number(await fontsize.inputValue())).toBeGreaterThan(4);
 const position=page.getByRole('spinbutton',{name:'Horizontal position exact value'});
 await position.fill('140');
 await expect(page.locator('.ve-offscreen-indicator')).toBeVisible();
 await page.getByRole('button',{name:'16:9'}).click();
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 expect(errors).toEqual([]);
});

test('overlapping clips create crossfade overlay and right-click menu can duplicate',async({page})=>{
 await page.goto('/');
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles([
  {name:'first.png',mimeType:'image/png',buffer:png},
  {name:'second.png',mimeType:'image/png',buffer:png}
 ]);
 await expect(page.locator('.ve-media-item')).toHaveCount(2);
 await page.locator('.ve-media-item').first().getByTitle('Add to timeline').click();
 const lane=page.locator('.ve-track-row').nth(2).locator('.ve-track-content');
 await expect(lane.locator('.ve-clip')).toHaveCount(1);
 await page.locator('.ve-media-item').nth(1).dragTo(lane,{targetPosition:{x:125,y:26}});
 await expect(lane.locator('.ve-clip')).toHaveCount(2);
 await expect(lane.locator('.ve-overlap-marker')).toHaveCount(1);
 await expect(lane.locator('.ve-overlap-marker')).toHaveAttribute('title',/visual \+ audio crossfade/);
 await lane.locator('.ve-clip').first().click({button:'right'});
 await expect(page.getByRole('menu',{name:'Timeline actions'})).toBeVisible();
 await page.getByRole('menuitem',{name:/Duplicate clip/}).click();
 await expect(lane.locator('.ve-clip')).toHaveCount(3);
});

test('recording transform changes on a track produces a reusable animation clip',async({page})=>{
 await page.goto('/');
 await page.locator('.ve-side-tabs button[title="Titles"]').click();
 await page.locator('.ve-palette-item').first().click();
 await expect(page.locator('.ve-object-outline')).toBeVisible();
 const rec=page.getByRole('button',{name:'Record Titles'});
 await rec.click();
 await expect(rec).toHaveAttribute('aria-pressed','true');
 const outline=page.locator('.ve-object-outline');
 await expect(outline).toBeVisible();
 const box=await outline.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+18,{steps:12});
 await page.mouse.up();
 await rec.click();
 await expect(rec).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('.ve-clip.ve-motion')).toHaveCount(1);
 await expect(page.locator('.ve-clip.ve-motion')).toContainText('Recorded animation');
});
