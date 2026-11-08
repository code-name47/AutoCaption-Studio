import {test,expect} from '@playwright/test';

test('public visitor can run and revert a real timeline AI command demo without login',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 await expect(page.getByTestId('run-local-ai-demo')).toBeEnabled();
 await page.getByTestId('run-local-ai-demo').click();
 const panel=page.getByTestId('ai-review-panel');
 await expect(panel).toContainText('Sample AI command run');
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(0);
 await page.getByTestId('approve-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="9:16"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(1);
 await expect(panel).toContainText('AI edit complete');
 await expect(page.locator('.ve-object-outline')).toBeVisible();
 await page.getByTestId('revert-ai-edit').click();
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
 await expect(page.locator('.ve-clip.ve-text')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('public visitor may reject AI sample without touching the editor',async({page})=>{
 await page.goto('/');
 await page.locator('.ve-side-tabs button[title="Connect"]').click();
 await page.getByTestId('run-local-ai-demo').click();
 await page.getByRole('button',{name:'Reject'}).click();
 await expect(page.getByTestId('ai-review-panel')).toHaveCount(0);
 await expect(page.locator('.ve-clip')).toHaveCount(0);
 await expect(page.locator('.ve-stage-frame[data-aspect="16:9"]')).toBeVisible();
});
