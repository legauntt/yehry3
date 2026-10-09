import { test, expect } from '@playwright/test';

const id = 'audio-editor-fixture', sourceUrl = 'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/audio-fixture.mp3';
const song = { id, title: 'Long Instrumental Fixture', url: sourceUrl, duration: 20, collection: 'tonyai', lyrics: { kind: 'written', text: 'A little song\nThe quiet ending' } };
function wav(duration) {
  const rate = 24000, samples = rate * duration, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 3000), 44 + i * 2);
  return bytes;
}
async function setup(page, admin = true) {
  await page.routeWebSocket('**', socket => socket.close());
  const state = { source: { url: sourceUrl, duration: 20 }, edits: [], defaultEditId: null, analysis: { method: 'isolated-vocals', regions: [[1, 4], [6, 8]] }, jobs: [], online: true, supported: true };
  const writes = []; let reads = 0, failSave = false;
  await page.addInitScript(admin => { localStorage.setItem('yehry3:listeners-hidden', 'true'); if (admin) localStorage.setItem('yehry3:auth:admin', JSON.stringify({ token: 'test-token' })); }, admin);
  const current = () => { const edit = state.edits.find(row => row.id === state.defaultEditId); return { ...song, audioEdits: state.edits, defaultAudioEditId: state.defaultEditId, originalAudio: edit ? state.source : null, ...(edit ? { url: edit.url, duration: edit.duration } : {}) }; };
  await page.route('**/songs/audio-editor-fixture.json', route => route.fulfill({ json: song }));
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs: [current()] } }));
  await page.route('**/yehry3/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/yehry3', '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path.endsWith('/audio-source')) return route.fulfill({ contentType: 'audio/wav', body: wav(20) });
    if (path.endsWith('/audio-editor')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push(body);
        if (failSave) { failSave = false; return route.fulfill({ status: 503, json: { error: 'Temporary connection error' } }); }
        state.jobs = [{ id: body.requestId, kind: 'render', state: 'working' }]; reads = 0;
        const row = { id: body.requestId, sourceUrl, url: 'https://yehry3.app/fixture-edit.mp3', end: body.end, fade: body.fade, duration: body.end };
        state.edits.push(row); state.defaultEditId = body.makeDefault ? row.id : null;
      } else if (request.method() === 'PATCH') { state.defaultEditId = request.postDataJSON().editId; }
      else if (state.jobs.length && ++reads > 1) state.jobs[0].state = 'ready';
      return route.fulfill({ json: state });
    }
    if (path === `/songs/${id}`) return route.fulfill({ json: { song: current() } });
    if (path === '/admin/songs') return route.fulfill({ json: { songs: [current()], counts: { live: 1, archived: 0 } } });
    if (['/catalog', '/songs/summary', '/songs/first-page'].includes(path)) return route.fulfill({ json: { songs: [current()], total: 1, archived: [] } });
    return route.fulfill({ json: { songs: [], profiles: [], listeners: [], inStudio: [], queued: [], recent: [] } });
  });
  await page.route(sourceUrl, route => route.fulfill({ contentType: 'audio/wav', body: wav(20) }));
  await page.route('https://yehry3.app/fixture-edit.mp3', route => route.fulfill({ contentType: 'audio/wav', body: wav(12) }));
  await page.goto(`/lyrics/?song=${id}&view=original`);
  return { state, writes, failOnce: () => { failSave = true; } };
}
async function open(page) {
  await page.getByLabel('More song options', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit audio', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-controls]')).toBeEnabled();
}

test('desktop editor seeks, previews, persists a crop, and exposes Original', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { writes } = await setup(page); await open(page);
  await expect(page.locator('[data-analysis]')).toContainText('isolated vocal stem');
  await expect(page.locator('[data-default]')).toBeChecked();
  await page.locator('[data-end]').fill('12'); await page.locator('[data-fade]').fill('3');
  await page.getByRole('button', { name: 'Preview ending' }).click();
  await expect.poll(() => page.locator('canvas').getAttribute('aria-valuenow')).not.toBe('0.0');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.locator('canvas').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('canvas')).toHaveAttribute('aria-valuenow', '10.0');
  await page.screenshot({ path: 'artifacts/audio-editor-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Save edited MP3' }).click();
  await expect(page.locator('[data-status]')).toContainText('Edited MP3 saved', { timeout: 15000 });
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ kind: 'render', end: 12, fade: 3, makeDefault: true, sourceUrl });
  await expect(page.locator('[data-versions] a')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close audio editor' }).click();
  await page.locator('#sheet-play').click();
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.src)).toContain('fixture-edit.mp3');
  await page.getByRole('button', { name: /· Original/ }).click();
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.src)).toBe(sourceUrl);
  expect(errors).toEqual([]);
});

test('mobile editor validates settings, retries the same save, and restores Original', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes, failOnce } = await setup(page); await open(page);
  await page.locator('[data-end]').fill('25'); await expect(page.locator('.audio-editor [data-save]')).toBeDisabled();
  await page.locator('[data-end]').fill('12'); await page.locator('[data-fade]').fill('0');
  await expect(page.locator('.audio-editor [data-save]')).toBeEnabled();
  const box = await page.getByRole('dialog').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.getByRole('dialog').evaluate(dialog => { dialog.scrollTop = 0; });
  await page.screenshot({ path: 'artifacts/audio-editor-mobile.png', fullPage: true });
  failOnce(); await page.locator('.audio-editor [data-save]').click(); await expect(page.locator('[data-status]')).toContainText('Temporary connection');
  await page.locator('.audio-editor [data-save]').click(); await expect(page.locator('[data-status]')).toContainText('Edited MP3 saved', { timeout: 15000 });
  expect(writes[0].requestId).toBe(writes[1].requestId);
  await page.locator('.ae-version').first().getByRole('button', { name: 'Use as default' }).click();
  await expect(page.locator('.ae-version').first().getByRole('button')).toHaveText('Default recording');
  await page.getByRole('button', { name: 'Close audio editor' }).click();
  await page.locator('#sheet-play').click(); await expect.poll(() => page.locator('#audio').evaluate(audio => audio.src)).toBe(sourceUrl);
});

test('visitors do not see the editor', async ({ page }) => {
  await setup(page, false); await expect(page.getByRole('button', { name: 'Edit audio', exact: true })).toHaveCount(0);
});

test('offline vocal analysis does not block queuing a crop', async ({ page }) => {
  const { state, writes } = await setup(page); state.online = false; state.analysis = null;
  await open(page);
  await expect(page.locator('[data-analysis]')).toContainText('offline');
  await expect(page.getByRole('button', { name: 'Recheck vocals' })).toBeDisabled();
  await page.locator('[data-end]').fill('12'); await page.locator('[data-fade]').fill('3');
  await page.getByRole('button', { name: 'Save edited MP3' }).click();
  await expect(page.locator('[data-status]')).toContainText('Edit queued');
  expect(writes).toHaveLength(1); expect(writes[0].kind).toBe('render');
});

test('many saved edits fit on mobile and switching preserves playback position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state } = await setup(page);
  state.edits = Array.from({ length: 20 }, (_, i) => ({ id: `edit-${i}`, sourceUrl, url: `https://yehry3.app/fixture-${i}.mp3`, fade: 2, duration: 12 }));
  state.defaultEditId = 'edit-0';
  await page.route('https://yehry3.app/fixture-*.mp3', route => route.fulfill({ contentType: 'audio/wav', body: wav(12) }));
  await page.reload(); await page.locator('#sheet-play').click();
  await expect(page.locator('#now-sides button')).toHaveCount(21);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#audio').evaluate(audio => { audio.currentTime = 5; });
  await page.getByRole('button', { name: /· Original/ }).click();
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(4.75);
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.paused)).toBe(false);
  await page.getByRole('button', { name: /· Edit 20$/ }).click();
  await expect(page.locator('#download')).toHaveAttribute('href', state.edits[19].url);
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(4.75);
});

test('existing pitch alternatives remain selectable', async ({ page }) => {
  await setup(page);
  await page.evaluate(async song => {
    const { player } = await import('/assets/player.js');
    await player.play({ ...song, pitchRepair: 'clean', alternates: [{ pitchRepair: 'wild', url: 'https://yehry3.app/fixture-edit.mp3' }] });
  }, song);
  const buttons = page.locator('#now-sides button');
  await expect(buttons).toHaveText(['A · Clean', 'B · Wild']);
  await buttons.nth(1).click();
  await expect(page.locator('#download')).toHaveAttribute('href', 'https://yehry3.app/fixture-edit.mp3');
});
