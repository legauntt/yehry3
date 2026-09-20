import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Needs the V8 dev-API flags (YEHRY3_GENERATION_V8, YEHRY3_VOICE_V8, YEHRY3_WORKER_TOKEN, YEHRY3_TEST_ADMIN_PASSWORD).
test("Tony's pitch starts Clean, reaches the worker as chosen, and is remembered for the next request", async ({ page }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const base = 'http://127.0.0.1:3000/yehry3';
  const headers = { Authorization: 'Bearer v8-local-test-worker-token-only-1234567890', 'X-Worker-ID': randomUUID(), 'Content-Type': 'application/json' };
  const start = async (idea, voice = 'v8') => {
    await page.locator('#idea').fill(idea); await page.locator('#idea-form button').click();
    await expect(page.locator('#voice-model')).toHaveValue(voice);
  };
  await page.goto('/distonyc/');
  await page.locator('#password').fill('wishbone'); await page.locator('#login-form button').click();
  await start('Pitch browser test: a slow blues about a borrowed umbrella.');
  const pitch = page.locator('#essentials-panel #gen-pitchRepair');
  await expect(pitch).toBeVisible(); await expect(pitch).toBeEnabled();
  await expect(pitch).toHaveValue('clean');
  expect(await pitch.locator('option').allTextContents()).toEqual(['Clean', 'Haunted', 'Wild']);
  await expect(page.locator('#pitch-repair-hint')).toContainText('Steadiest');
  const other = page.locator('#gen-pitchCompare');
  await expect(other).toHaveValue('');
  await other.selectOption('wild');
  await pitch.selectOption('wild');
  await expect(page.locator('#pitch-repair-hint')).toContainText('Untouched');
  // Without V8 generation there is nowhere to record the choice, so it says so instead of silently doing nothing.
  await page.locator('#voice-model').selectOption('v7');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('#generation-enabled').uncheck();
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await expect(pitch).toBeDisabled(); await expect(page.locator('#pitch-repair-off')).toBeVisible();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('#generation-enabled').check();
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await expect(pitch).toBeEnabled(); await expect(page.locator('#pitch-repair-off')).toBeHidden();
  await expect(pitch).toHaveValue('wild');
  await expect(other).toHaveValue('');
  await expect(other.locator('option[value="wild"]')).toBeDisabled();
  await other.selectOption('clean');
  await page.reload();
  await expect(page.locator('#gen-pitchRepair')).toHaveValue('wild');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#details-form > .actions .primary').click();
  const brief = page.locator('.generation-brief');
  await expect(brief.locator('dt', { hasText: 'Tony’s pitch' })).toHaveCount(1);
  await expect(brief).toContainText('Wild');
  await expect(brief.locator('dt', { hasText: 'B side' })).toHaveCount(1);
  await page.locator('#confirm-form .primary').click();
  const draftId = await page.evaluate(() => sessionStorage.getItem('yehry3:draft'));
  const read = () => page.evaluate(async (id) => (await (await import('/assets/api.js')).api(`/prompts/${id}`, { role: 'submitter' })).prompt, draftId);
  await expect.poll(async () => (await read()).status).toBe('queued');
  const saved = await read();
  expect(saved.details.generation.pitchRepair).toBe('wild');
  expect(saved.details.generation.pitchCompare).toBe('clean');
  const visitor = randomUUID();
  const session = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visitor-ID': visitor }, body: JSON.stringify({ role: 'admin', password: process.env.YEHRY3_TEST_ADMIN_PASSWORD || 'v8-local-preview-admin' }) });
  expect(session.status).toBe(200);
  const priority = await fetch(base + `/admin/prompts/${draftId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Visitor-ID': visitor, Authorization: 'Bearer ' + (await session.json()).token }, body: JSON.stringify({ action: 'priority', priority: 10000, version: saved.version }) });
  expect(priority.status).toBe(200);
  const leaseToken = randomUUID();
  const claimed = await fetch(base + '/worker/claim', { method: 'POST', headers, body: JSON.stringify({ claimId: randomUUID(), leaseToken, capabilities: ['request-materials-v1', 'generation-v8-v1', 'voice-v8-v1'] }) });
  const doc = (await claimed.json()).prompt;
  expect(doc.id).toBe(draftId); expect(doc.details.generation.pitchRepair).toBe('wild');
  await fetch(base + `/worker/prompts/${doc.id}/fail`, { method: 'POST', headers, body: JSON.stringify({ leaseToken, error: 'Browser test fixture finished; no song was generated.' }) });
  await page.evaluate(() => sessionStorage.removeItem('yehry3:draft'));
  await page.goto('/distonyc/');
  // The voice picked in the menu above is remembered too, like the pitch.
  await start('Pitch browser test: a second song, to check the remembered choice.', 'v7');
  await expect(page.locator('#gen-pitchRepair')).toHaveValue('wild');
  expect(errors).toEqual([]);
});

test('a song with a B side switches recordings in the player and keeps the download in step', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  let sides;
  await page.route('**/yehry3/songs/summary', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    const [song, second] = data.songs;
    for (const other of data.songs) delete other.alternates; // The catalog's own B sides would be counted with the one under test.
    Object.assign(song, { pitchRepair: 'clean', alternates: [{ pitchRepair: 'wild', url: second.url, duration: song.duration }] });
    sides = { id: song.id, a: song.url, b: second.url };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  const row = page.locator(`#tracks [data-play="${sides.id}"]`).first();
  await expect(row).toBeVisible();
  await expect(page.locator('#tracks .sides-badge')).toHaveCount(1);
  await row.click();
  const buttons = page.locator('#now-sides button');
  await expect(buttons).toHaveText(['A · Clean', 'B · Wild']);
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#audio').evaluate((audio) => audio.src)).toBe(sides.a);
  await buttons.nth(1).click();
  await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('#audio').evaluate((audio) => audio.src)).toBe(sides.b);
  await expect(page.locator('#download')).toHaveAttribute('href', sides.b);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(buttons.nth(0)).toBeVisible();
  const other = page.locator('#tracks [data-play]').nth(1);
  await other.click();
  await expect(page.locator('#now-sides')).toBeHidden();
  expect(errors).toEqual([]);
});