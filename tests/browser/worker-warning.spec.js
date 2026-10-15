import { test, expect } from '@playwright/test';

async function setup(page, status) {
  const state = { status, failed: false, reads: 0 };
  await page.addInitScript(() => localStorage.setItem('yehry3:listeners-hidden', 'true'));
  await page.route('**/yehry3/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/yehry3', '');
    if (path === '/queue') {
      state.reads++;
      if (state.failed) return route.abort();
      return route.fulfill({ json: { worker: state.status ? { status: state.status } : undefined,
        inStudio: [], queued: [], recent: [], needsAttention: [] } });
    }
    return route.fulfill({ json: { songs: [], total: 0 } });
  });
  await page.goto('/');
  await expect.poll(() => state.reads).toBeGreaterThan(0);
  return state;
}

for (const width of [1440, 390]) test(`offline warning is prominent and fits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page, 'offline');
  const warning = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'PC worker offline' }) });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Requests stay in the queue');
  await expect(warning.getByRole('link', { name: 'View the queue' })).toHaveAttribute('href', '/queue/');
  const box = await warning.boundingBox();
  expect(box.y).toBeLessThan(300);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `artifacts/worker-warning-${width}.png` });
});

test('polling clears the warning on reconnect and restores it on disconnect', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, 'offline');
  const warning = page.locator('#worker-offline-warning');
  await expect(warning).toBeVisible();
  state.status = 'online';
  await page.clock.runFor(31000);
  await expect(warning).toBeHidden();
  state.status = 'offline';
  await page.clock.runFor(31000);
  await expect(warning).toBeVisible();
});

for (const status of ['online', undefined]) test(`does not invent an outage for ${status || 'unknown'} status`, async ({ page }) => {
  await setup(page, status);
  await expect(page.locator('#worker-offline-warning')).toBeHidden();
});

test('API failure does not invent a PC outage', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, 'online');
  state.failed = true;
  await page.clock.runFor(31000);
  await expect(page.locator('#worker-offline-warning')).toBeHidden();
});
