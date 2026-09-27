import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openSongMenu } from './helpers/song-menu.js';

const catalog = JSON.parse(await readFile(new URL('../../catalog.json', import.meta.url), 'utf8'));
const recording = catalog.songs.find(song => song.url.startsWith('/fearhunger/'));
const songs = [0, 1].map(i => ({ id: `archive-fixture-${i}`, title: `Midnight Train ${i + 1}`,
  collection: 'tonyai', url: recording.url, votes: 0, feedback: {}, duration: 180 }));

async function setup(page, { credentials, allowed = true, checkGate } = {}) {
  const state = { allowed, checks: 0, writes: [], failure: null, archived: new Set() };
  await page.addInitScript(credentials => {
    localStorage.setItem('yehry3:listeners-hidden', 'true');
    if (credentials) localStorage.setItem(`yehry3:auth:${credentials.role || 'admin'}`,
      JSON.stringify({ token: 'fixture-token', ...credentials }));
  }, credentials);
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs } }));
  await page.route('**/yehry3/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/yehry3', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    let json = {};
    if (path === '/admin/songs') {
      state.checks++;
      await checkGate;
      if (!state.allowed) return route.fulfill({ status: 401, json: { error: 'Please sign in again.' } });
      json = { songs: [], counts: { live: 2, archived: 0 } };
    } else if (path.startsWith('/admin/songs/')) {
      state.writes.push({ method: request.method(), authorization: request.headers().authorization,
        body: request.postDataJSON(), id: path.split('/').at(-1) });
      if (state.failure) return route.fulfill({ status: state.failure, json: { error: 'Archive request failed.' } });
      const { id, body } = state.writes.at(-1);
      if (body.archived) state.archived.add(id);
      else state.archived.delete(id);
      json = { song: { id, archived: body.archived, changed: true } };
    } else if (path === '/catalog' || path === '/songs/summary' || path === '/songs/first-page') {
      const visible = songs.filter(song => !state.archived.has(song.id));
      json = { songs: visible, total: visible.length, archived: [...state.archived], nextVoteAt: null };
    } else if (path === '/queue') json = { inStudio: [], queued: [], recent: [] };
    await route.fulfill({ json });
  });
  await page.goto('/?sort=catalog');
  await expect(page.locator('#tracks > .track')).toHaveCount(2);
  return state;
}

for (const role of ['visitor', 'submitter']) test(`${role} sees no Archive action or admin check`, async ({ page }) => {
  const state = await setup(page, { credentials: role === 'submitter' ? { role } : undefined });
  await openSongMenu(page.locator('.track').first());
  await expect(page.locator('[data-archive]')).toHaveCount(0);
  expect(state.checks).toBe(0);
  expect(state.writes).toEqual([]);
});

test('saved admin credentials must pass the server check', async ({ page }) => {
  let release;
  const state = await setup(page, { credentials: {}, checkGate: new Promise(resolve => { release = resolve; }) });
  await expect.poll(() => state.checks).toBe(1);
  await expect(page.locator('[data-archive]')).toHaveCount(0);
  release();
  await expect(page.locator('[data-archive]')).toHaveCount(2);
});

test('invalid admin credentials stay hidden', async ({ page }) => {
  const state = await setup(page, { credentials: {}, allowed: false });
  await expect.poll(() => state.checks).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('yehry3:auth:admin'))).toBeNull();
  await expect(page.locator('[data-archive]')).toHaveCount(0);
});

for (const view of ['Grid', 'List']) test(`admin can confirm, archive and undo in ${view}, preserving playback`, async ({ page }) => {
  const state = await setup(page, { credentials: {} });
  const row = page.locator('[data-id="archive-fixture-0"]');
  await expect(row.locator('[data-archive]')).toHaveCount(1);
  await page.getByRole('button', { name: view, exact: true }).click();
  await row.locator('[data-play]').click();
  const audio = page.locator('#audio');
  await expect.poll(() => audio.evaluate(el => el.paused)).toBe(false);
  await audio.evaluate(el => { window.originalAudio = el; el.currentTime = 20; });
  await openSongMenu(row);
  const archive = row.getByRole('button', { name: 'Archive Midnight Train 1' });
  page.once('dialog', dialog => dialog.dismiss());
  await archive.click();
  expect(state.writes).toEqual([]);
  await expect(row).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await openSongMenu(row);
  await expect(archive).toBeVisible();
  const box = await row.locator('.song-menu-panel').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: `artifacts/catalog-archive-${view.toLowerCase()}-mobile.png` });
  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('Midnight Train 1');
    expect(dialog.message()).toContain('for everyone');
    return dialog.accept();
  });
  await archive.click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Archived');
  expect(state.writes).toEqual([{ method: 'PATCH', authorization: 'Bearer fixture-token',
    id: 'archive-fixture-0', body: { archived: true } }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yehry3:archived-songs')))).toContain('archive-fixture-0');
  expect(await audio.evaluate(el => el === window.originalAudio && !el.paused && el.currentTime >= 20)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(row).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('Restored');
  expect(state.writes.at(-1).body).toEqual({ archived: false });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yehry3:archived-songs')))).not.toContain('archive-fixture-0');
});

test('archive failures keep the song and revoked sessions hide the actions', async ({ page }) => {
  const state = await setup(page, { credentials: {} });
  const row = page.locator('[data-id="archive-fixture-0"]');
  await expect(row.locator('[data-archive]')).toHaveCount(1);
  for (const status of [503, 401]) {
    state.failure = status;
    await openSongMenu(row);
    page.once('dialog', dialog => dialog.accept());
    await row.locator('[data-archive]').click();
    await expect(page.locator('#toast')).toContainText('Archive request failed.');
    await expect(row).toBeVisible();
    if (status === 503) await expect(row.locator('[data-archive]')).toBeEnabled();
  }
  await expect(page.locator('[data-archive]')).toHaveCount(0);
});

test('another tab signing out removes Archive without a reload', async ({ page, context }) => {
  await setup(page, { credentials: {} });
  await expect(page.locator('[data-archive]')).toHaveCount(2);
  const other = await context.newPage();
  await other.goto('/original-prompt/');
  await other.evaluate(() => localStorage.removeItem('yehry3:auth:admin'));
  await expect(page.locator('[data-archive]')).toHaveCount(0);
  await other.close();
});
