import { test, expect } from '@playwright/test';
test('Backstage separates automatic recovery from operator attention and preserves diagnostics', async ({ page }) => {
  const base = { status: 'failed', version: 1, confirmedAt: new Date().toISOString(), priority: 0, details: {}, history: [
    { at: new Date(Date.now() - 120000).toISOString(), actor: 'worker', action: 'status', status: 'processing' },
    { at: new Date(Date.now() - 60000).toISOString(), actor: 'worker', action: 'status', status: 'failed' },
  ], workerError: 'Saved diagnostic' };
  const rows = [{ ...base, id: 'auto', prompt: 'Automatic recovery', recovery: { phase: 'recovering', expiresAt: new Date(Date.now() + 600000).toISOString() } },
    { ...base, id: 'serious', prompt: 'Missing input' }];
  let submitted;
  await page.route('**/yehry3/admin/prompts?**', route => route.fulfill({ json: {
    prompts: rows, total: 2, page: 0, counts: { failed: 2, attention: 1, recovering: 1 }, transitions: { failed: ['queued', 'canceled'] },
    workers: [{ status: 'online', state: 'working', stage: 'Rendering', onlineSince: new Date(Date.now() - 3600000).toISOString(), lastSeenAt: new Date().toISOString(),
      presence: [{ status: 'offline', from: new Date(Date.now() - 7200000).toISOString(), to: new Date(Date.now() - 3600000).toISOString() }] }]
  } }));
  const threads = { auto: [], serious: [] };
  await page.route('**/yehry3/admin/prompts/*/dehaka', route => route.fulfill({ json: { entries: threads[route.request().url().split('/').at(-2)] } }));
  await page.route('**/yehry3/admin/prompts/serious', async route => {
    submitted = route.request().postDataJSON();
    threads.serious = [
      { id: 'steer', author: 'operator', kind: 'steer', at: new Date().toISOString(), text: submitted.guidance, logs: [] },
      { id: 'reply', author: 'dehaka', kind: 'reply', action: 'retry_saved_work', at: new Date().toISOString(), text: 'The ending stage timed out; retry the frozen render.',
        evidence: 'renderer.log line 812', logs: [{ name: 'renderer.log', text: 'stage ending\nTraceback (most recent call last):\nTimeoutError: ending', truncated: true }] },
    ];
    rows[1] = { ...rows[1], version: 2, recovery: { phase: 'recovering', expiresAt: new Date(Date.now() + 600000).toISOString(), shepherd: { guidance: submitted.guidance } } };
    await route.fulfill({ json: { prompt: rows[1] } });
  });
  await page.goto('/admin/?status=all');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-admin');
  await page.getByRole('button', { name: 'Open the queue' }).click();
  await expect(page.locator('.stats a[href="/admin/?status=attention"]')).toContainText("19/11'd Again");
  await expect(page.locator('[data-prompt="auto"] .badge')).toHaveText('Recovering automatically');
  await expect(page.locator('[data-prompt="auto"]')).toContainText('Saved diagnostic');
  await expect(page.locator('[data-prompt="auto"]').getByRole('button', { name: 'Retry saved work' })).toHaveCount(0);
  // Steering stays available during automatic recovery so the operator can redirect it.
  await expect(page.locator('[data-prompt="auto"]').getByLabel('Steer Dehaka')).toBeVisible();
  await expect(page.locator('.worker-presence')).toContainText('PC worker online');
  await expect(page.locator('.worker-presence')).toContainText('Working · Rendering');
  await expect(page.locator('[data-prompt="serious"] .dehaka-thread')).toContainText('No steering yet');
  await expect(page.locator('[data-prompt="serious"]')).toContainText('What stopped it');
  await expect(page.locator('[data-prompt="serious"]')).toContainText('Saved diagnostic');
  await expect(page.locator('[data-prompt="serious"] .dehaka-panel')).toContainText('Dehaka recovery console');
  await expect(page.locator('[data-prompt="serious"] .dehaka-clipart svg')).toBeVisible();
  await expect(page.locator('[data-prompt="serious"] .dehaka-context blockquote')).not.toBeEmpty();
  await expect(page.locator('[data-prompt="serious"] .dehaka-panel')).toContainText('Recorded queue activity');
  await expect(page.locator('[data-prompt="serious"] .dehaka-panel')).toContainText('Suggested next step');
  await expect(page.locator('[data-prompt="serious"] .dehaka-history')).toContainText('worker · status');
  await expect(page.locator('[data-prompt="serious"]').getByLabel('Steer Dehaka')).toHaveValue('Whatever it takes to fix this.');
  await expect(page.locator('[data-prompt="serious"]').getByRole('button', { name: 'Retry saved work' })).toBeVisible();
  await page.locator('[data-prompt="serious"]').getByLabel('Steer Dehaka').fill('Preserve the vocal and repair the ending.');
  await page.locator('[data-prompt="serious"]').getByRole('button', { name: 'Dehaka' }).click();
  expect(submitted).toEqual({ action: 'shepherd', version: 1, guidance: 'Preserve the vocal and repair the ending.' });
  await expect(page.locator('[data-prompt="serious"] .badge')).toHaveText('Recovering automatically');
  await expect(page.locator('[data-prompt="serious"]')).toContainText('Dehaka is adapting this request using your guidance.');
  const thread = page.locator('[data-prompt="serious"] .dehaka-thread');
  await expect(thread.locator('.dehaka-turn-operator')).toContainText('Preserve the vocal and repair the ending.');
  await expect(thread.locator('.dehaka-turn-dehaka')).toContainText('Retry saved work');
  await expect(thread.locator('.dehaka-turn-dehaka')).toContainText('renderer.log line 812');
  await expect(thread).toContainText('Your turn');
  await thread.getByText('renderer.log · latest part').click();
  await expect(thread.locator('.dehaka-log pre')).toContainText('TimeoutError: ending');
  // The operator can answer immediately with another steer.
  await expect(page.locator('[data-prompt="serious"]').getByLabel('Steer Dehaka')).toHaveValue('Preserve the vocal and repair the ending.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
