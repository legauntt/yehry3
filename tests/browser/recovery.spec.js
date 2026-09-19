import { test, expect } from '@playwright/test';
test('Backstage separates automatic recovery from operator attention and preserves diagnostics', async ({ page }) => {
  const base = { status: 'failed', version: 1, confirmedAt: new Date().toISOString(), priority: 0, details: {}, history: [], workerError: 'Saved diagnostic' };
  const rows = [{ ...base, id: 'auto', prompt: 'Automatic recovery', recovery: { phase: 'recovering', expiresAt: new Date(Date.now() + 600000).toISOString() } },
    { ...base, id: 'serious', prompt: 'Missing input' }];
  let submitted;
  await page.route('**/yehry3/admin/prompts?**', route => route.fulfill({ json: {
    prompts: rows, total: 2, page: 0, counts: { failed: 2, attention: 1, recovering: 1 }, transitions: { failed: ['queued', 'canceled'] }, workers: []
  } }));
  await page.route('**/yehry3/admin/prompts/serious', async route => {
    submitted = route.request().postDataJSON();
    rows[1] = { ...rows[1], version: 2, recovery: { phase: 'recovering', expiresAt: new Date(Date.now() + 600000).toISOString(), shepherd: { guidance: submitted.guidance } } };
    await route.fulfill({ json: { prompt: rows[1] } });
  });
  await page.goto('/admin/?status=all');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-admin');
  await page.getByRole('button', { name: 'Open the queue' }).click();
  await expect(page.locator('.stats a[href="/admin/?status=attention"]')).toContainText('1Needs Attention');
  await expect(page.locator('[data-prompt="auto"] .badge')).toHaveText('Recovering automatically');
  await expect(page.locator('[data-prompt="auto"]')).toContainText('Saved diagnostic');
  await expect(page.locator('[data-prompt="auto"]').getByRole('button', { name: 'Retry saved work' })).toHaveCount(0);
  await expect(page.locator('[data-prompt="auto"]').getByRole('button', { name: 'Dehaka' })).toHaveCount(0);
  await expect(page.locator('[data-prompt="serious"]')).toContainText('What stopped it');
  await expect(page.locator('[data-prompt="serious"]')).toContainText('Saved diagnostic');
  await expect(page.locator('[data-prompt="serious"]').getByLabel('Steer Dehaka')).toHaveValue('Whatever it takes to fix this.');
  await expect(page.locator('[data-prompt="serious"]').getByRole('button', { name: 'Retry saved work' })).toBeVisible();
  await page.locator('[data-prompt="serious"]').getByLabel('Steer Dehaka').fill('Preserve the vocal and repair the ending.');
  await page.locator('[data-prompt="serious"]').getByRole('button', { name: 'Dehaka' }).click();
  expect(submitted).toEqual({ action: 'shepherd', version: 1, guidance: 'Preserve the vocal and repair the ending.' });
  await expect(page.locator('[data-prompt="serious"] .badge')).toHaveText('Recovering automatically');
  await expect(page.locator('[data-prompt="serious"]')).toContainText('Dehaka is adapting this request using your guidance.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
