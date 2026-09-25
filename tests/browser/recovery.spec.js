import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('Archive beside Contact Support cancels a failed request while retaining its evidence', async ({ page }) => {
  let doc = { id: 'archivable', prompt: 'Saved dating song', status: 'failed', version: 6, priority: 0,
    confirmedAt: new Date().toISOString(), details: {}, workerError: 'Saved planning failure',
    history: [{ at: new Date().toISOString(), actor: 'admin', action: 'shepherd' }] };
  const transitions = { failed: ['queued', 'canceled'], canceled: ['queued'] };
  const patches = [];
  let conflict = true;
  await page.route('**/yehry3/admin/prompts?**', route => {
    const status = new URL(route.request().url()).searchParams.get('status');
    const rows = status === 'attention' ? (doc.status === 'failed' ? [doc] : []) : [doc];
    return route.fulfill({ json: { prompts: rows, total: rows.length, counts: {}, transitions, workers: [] } });
  });
  await page.route('**/yehry3/admin/prompts/archivable/logs', route => route.fulfill({ json: { entries: [
    { id: 'steer', author: 'operator', kind: 'steer', text: 'Archive this song', at: new Date().toISOString(), logs: [] },
  ] } }));
  await page.route('**/yehry3/admin/prompts/archivable', async route => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: { prompt: doc, transitions, workers: [] } });
    patches.push(route.request().postDataJSON());
    if (conflict) {
      conflict = false;
      doc = { ...doc, version: 7 };
      return route.fulfill({ status: 409, json: { error: 'Someone changed this prompt. Refresh and try again.' } });
    }
    doc = { ...doc, status: 'canceled', version: 8 };
    return route.fulfill({ json: { prompt: doc } });
  });
  await page.goto('/admin/?status=attention');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-admin');
  await page.getByRole('button', { name: 'Open the queue' }).click();
  const card = page.locator('[data-prompt="archivable"]');
  const archive = card.getByRole('button', { name: 'Archive', exact: true });
  const dehaka = card.getByRole('button', { name: 'Contact Support', exact: true });
  await expect(archive).toBeVisible();
  const archiveBox = await archive.boundingBox(), dehakaBox = await dehaka.boundingBox();
  expect(archiveBox.x).toBeGreaterThan(dehakaBox.x + dehakaBox.width);
  expect(Math.abs(archiveBox.y + archiveBox.height / 2 - dehakaBox.y - dehakaBox.height / 2)).toBeLessThan(2);
  // Archiving does not require valid recovery guidance or send it to Dehaka.
  page.once('dialog', dialog => dialog.dismiss());
  await archive.click();
  expect(patches).toEqual([]);
  await expect(card).toContainText('Saved planning failure');
  await mkdir('artifacts', { recursive: true });
  await archive.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/archive-request-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await archive.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/archive-request-mobile.png' });
  page.once('dialog', dialog => dialog.accept());
  await archive.click();
  await expect(page.locator('#message')).toContainText('Someone changed this prompt');
  await expect(archive).toBeEnabled();
  expect(patches).toEqual([{ action: 'status', status: 'canceled', version: 6 }]);
  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('Saved work and history are kept under Canceled');
    return dialog.accept();
  });
  await archive.click();
  await expect(card).toHaveCount(0);
  expect(patches.at(-1)).toEqual({ action: 'status', status: 'canceled', version: 7 });
  await expect(page.locator('#message')).toContainText('Request archived');
  await page.getByLabel('Show', { exact: true }).selectOption('canceled');
  await expect(card).toContainText('Saved dating song');
  await expect(card.locator('.dehaka-thread')).toContainText('Archive this song');
  await expect(archive).toHaveCount(0);
  await page.goto('/admin/archivable');
  await card.locator('.admin-brief summary').click();
  await expect(card).toContainText('Saved planning failure');
  await expect(card.locator('select[name="status"] option[value="queued"]')).toHaveCount(1);
  // An active lease suppresses the shortcut on the permalink too.
  doc = { ...doc, status: 'failed', workerActive: true };
  await page.reload();
  await expect(card).toBeVisible();
  await expect(archive).toHaveCount(0);
});

test('Contact Support reads and copies diagnostics while retaining raw logs and retired history', async ({ page, context }) => {
  await page.clock.install();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const doc = { id: 'support-test', prompt: 'Saved diagnostic song', status: 'failed', version: 2, priority: 0,
    confirmedAt: new Date().toISOString(), details: {}, workerError: 'Timeout in ending', history: [] };
  let patches = 0, summaries = 0, polls = 0;
  await page.route('**/yehry3/admin/prompts/support-test', route => {
    if (route.request().method() === 'PATCH') patches++;
    return route.fulfill({ json: { prompt: doc, transitions: { failed: ['queued', 'canceled'] }, workers: [] } });
  });
  await page.route('**/yehry3/admin/prompts/support-test/support', route => {
    summaries++;
    if (summaries === 1) return route.fulfill({ status: 503, json: { error: 'Summary temporarily unavailable' } });
    return route.fulfill({ json: { text: 'Status: failed\nCurrent error: Timeout in ending\n[log-1 / renderer.log] <script>unsafe</script>' } });
  });
  await page.route('**/yehry3/admin/prompts/support-test/logs', route => {
    polls++;
    return route.fulfill({ json: { entries: [{ id: 'log-1', author: 'dehaka', kind: 'reply', action: 'needs_code_fix',
      at: '2026-09-24T00:00:00Z', text: 'Historical advice', logs: [{ name: 'renderer.log', text: 'TimeoutError: ending <script>unsafe</script>' }] },
      ...(polls > 1 ? [{ id: 'log-2', author: 'worker', kind: 'outcome', at: '2026-09-24T00:01:00Z', text: 'New log entry', logs: [] }] : [])] } });
  });
  await page.goto('/admin/support-test');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-admin');
  await page.getByRole('button', { name: 'Open the queue' }).click();
  const support = page.getByRole('button', { name: 'Contact Support', exact: true });
  await expect(page.getByRole('button', { name: 'Dehaka', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Steer Dehaka')).toHaveCount(0);
  await expect(page.locator('.dehaka-thread')).toContainText('Dehaka (retired)');
  await page.locator('.dehaka-log summary').click();
  await expect(page.locator('.dehaka-log pre')).toContainText('TimeoutError: ending <script>unsafe</script>');
  await support.click();
  await expect(page.getByRole('region', { name: 'Support report' })).toContainText('Summary temporarily unavailable');
  await support.click(); await support.click();
  await expect(page.getByLabel('Diagnostic report')).toHaveValue(/Current error: Timeout in ending/);
  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.locator('.support-copy-status')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('[log-1 / renderer.log] <script>unsafe</script>');
  expect(patches).toBe(0);
  await page.locator('.dehaka-log').scrollIntoViewIfNeeded();
  await page.clock.fastForward(16000);
  await expect(page.locator('.dehaka-thread')).toContainText('New log entry');
  await expect(page.locator('.dehaka-log')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Diagnostic report')).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await support.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/support-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await support.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/support-mobile.png' });
});
