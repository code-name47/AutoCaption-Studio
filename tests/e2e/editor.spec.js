import {test,expect} from '@playwright/test';
import {stat} from 'node:fs/promises';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/do0AAAAASUVORK5CYII=','base64');
test('full-screen editor can import, drag between tracks, add a title, and reopen a saved project',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('.ve-shell')).toBeVisible();
 await expect(page.locator('.ve-track-row')).toHaveCount(7);
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({name:'test-image.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 const asset=page.locator('.ve-media-item').first();
 const secondVideoTrack=page.locator('.ve-track-row').nth(1).locator('.ve-track-content');
 await asset.dragTo(secondVideoTrack,{targetPosition:{x:160,y:24}});
 await expect(secondVideoTrack.locator('.ve-clip')).toHaveCount(1);
 const firstVideoTrack=page.locator('.ve-track-row').nth(2).locator('.ve-track-content');
 await secondVideoTrack.locator('.ve-clip').dragTo(firstVideoTrack,{targetPosition:{x:180,y:25}});
 await expect(firstVideoTrack.locator('.ve-clip')).toHaveCount(1);
 await expect(secondVideoTrack.locator('.ve-clip')).toHaveCount(0);
 await page.getByTitle('Create video track').click();
 await expect(page.locator('.ve-track-row')).toHaveCount(8);
 await page.locator('.ve-side-tabs button[title="Titles"]').click();
 await page.locator('.ve-palette-item').first().click();
 await expect(page.locator('.ve-clip')).toHaveCount(2);
 await page.locator('.ve-side-tabs button[title="Transitions"]').click();
 await page.locator('.ve-palette-item').filter({hasText:'Fade in'}).click();
 await expect(page.locator('.ve-inspector')).toContainText('Fade out');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.ve-top-state')).toContainText('Project saved');
 await page.reload();
 await page.locator('.ve-side-tabs button[title="Export"]').click();
 await page.getByRole('button',{name:'Open saved browser project'}).click();
 await expect(page.locator('.ve-track-row')).toHaveCount(8);
 await expect(page.locator('.ve-clip')).toHaveCount(2);
 expect(errors).toEqual([]);
});


test('browser renders a short timeline to a downloadable WebM file',async({page})=>{
 await page.goto('/');
 await page.locator('input[accept="video/*,audio/*,image/*"]').setInputFiles({name:'export-fixture.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.ve-media-item')).toHaveCount(1);
 await page.locator('.ve-media-item button').click();
 await expect(page.locator('.ve-clip')).toHaveCount(1);
 await page.locator('.ve-side-tabs button[title="Export"]').click();
 const [download]=await Promise.all([
  page.waitForEvent('download',{timeout:45000}),
  page.getByRole('button',{name:'Render WebM video'}).click()
 ]);
 expect(download.suggestedFilename()).toMatch(/\.webm$/);
 const file=await download.path(),info=await stat(file);
 expect(info.size).toBeGreaterThan(500);
});
