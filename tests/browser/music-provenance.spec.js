import { test, expect } from '@playwright/test';
import { songSummary } from '../../assets/song-summary.js';

const paid = {
  id: 'distonyc-eeeeeeeeeeeeeeeeeeeeeeee', title: 'Last bus home', voiceModel: 'v7', musicBackend: 'eleven_music',
  collection: 'distonyc', collections: ['fearhunger'], duration: 180, votes: 0,
  url: '/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3',
  originalPrompt: { idea: 'A soul song about the last bus home', voiceModel: 'v7', musicBackend: 'eleven_music', direction: 'Warm bass', keep: 'The chorus', basisSongs: [], references: [], generation: { version: 1, duration: 180, genre: 'soul' } },
  lyrics: { text: '[Verse]\nThe last bus carries us home', kind: 'written' },
};
const local = { ...paid, id: 'local-fixture', title: 'Local fixture', musicBackend: 'local', originalPrompt: { ...paid.originalPrompt, musicBackend: 'local' } };
const legacy = { id: 'legacy-fixture', title: 'Old recording', voiceModel: 'v8', url: paid.url, duration: 180, collection: 'tonyai' };
const pending = { id: 'distonyc-dddddddddddddddddddddddd', idea: paid.originalPrompt.idea, originalPrompt: paid.originalPrompt, voiceModel: 'v7', status: 'queued', submittedAt: '2026-09-17T19:00:00Z', updatedAt: '2026-09-17T19:00:00Z' };
const queue = { inStudio: [], needsAttention: [], queued: [pending], recent: [], queuedTotal: 1, page: 0, pageSize: 50 };
const badge = root => root.locator('.music-backend-badge');

async function fixtures(page, songs = [paid, local, legacy]) {
  await page.route('**/yehry3/**', route => route.fulfill({ json: {} }));
  await page.route('**/yehry3/profiles?*', route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route('**/yehry3/songs/summary', route => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route('**/yehry3/queue?*', route => route.fulfill({ json: queue }));
  await page.route(`**/yehry3/queue/${pending.id}`, route => route.fulfill({ json: pending }));
  for (const song of [...songs, pending]) {
    await page.route(`**/yehry3/songs/${song.id}`, route => route.fulfill({ json: { song } }));
    await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  }
}

test('catalog and playing song retain separate generator attribution through refresh and offline fallback', async ({ page }) => {
  await fixtures(page);
  await page.goto('/?sort=catalog');
  const track = page.locator(`.track[data-id="${paid.id}"]`);
  await expect(badge(track)).toHaveText('EMP');
  await expect(track.locator('.voice-model-badge')).toHaveText('V7');
  await expect(badge(page.locator('.track[data-id="local-fixture"]'))).toHaveText('Local · ACE');
  await expect(badge(page.locator('.track[data-id="legacy-fixture"]'))).toHaveCount(0);
  await expect(badge(page.locator('.pending-track'))).toHaveText('EMP');
  await track.locator('[data-play]').click();
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.paused)).toBe(false);
  await expect(badge(page.locator('#now-generator'))).toHaveText('EMP');
  await page.locator('#audio').evaluate(audio => { window.savedAudio = audio; audio.currentTime = 12; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio === window.savedAudio && !audio.paused && audio.currentTime >= 12)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.collection').screenshot({ path: 'artifacts/music-provenance/catalog-mobile.png' });
  await page.route('**/yehry3/songs/summary', route => route.abort());
  await page.reload();
  await expect(page.locator('#vote-note')).toContainText('offline');
  await expect(badge(track)).toHaveText('EMP');
});

test('queue, original prompts and lyric sheets identify paid music without calling it V8 generation', async ({ page }) => {
  await fixtures(page);
  await page.goto('/queue/');
  await expect(badge(page.locator('.public-queue-card'))).toHaveText('EMP');
  await page.locator('.queue-details-link').click();
  await expect(badge(page.locator('.queue-detail-status'))).toHaveText('EMP');
  await page.getByRole('link', { name: 'View original prompt' }).click();
  for (const id of [pending.id, paid.id]) {
    await page.goto(`/original-prompt/?song=${id}`);
    await expect(badge(page.locator('.original-prompt'))).toHaveText('EMP');
    await expect(page.locator('dt').filter({ hasText: /^Band generator$/ }).locator('+ dd')).toHaveText('Eleven Music · paid');
    await expect(page.locator('.prompt-brief')).toContainText('Tony V7');
    await expect(page.getByRole('heading', { name: 'Eleven Music settings' })).toBeVisible();
    await expect(page.locator('.prompt-brief')).not.toContainText('V8 generation');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.original-prompt').screenshot({ path: 'artifacts/music-provenance/prompt-mobile.png' });
  await page.goto(`/lyrics/?song=${paid.id}`);
  await expect(badge(page.locator('.lyrics-sheet'))).toHaveText('EMP');
  await expect(page.getByRole('link', { name: 'Original prompt', exact: false })).toHaveAttribute('href', `/original-prompt/?song=${paid.id}`);
  await page.route(`**/yehry3/songs/${paid.id}`, route => route.abort());
  await page.reload();
  await expect(badge(page.locator('.lyrics-sheet'))).toHaveText('EMP');
});

test('Fear and Hunger and mixtape tracks carry the same saved provider', async ({ page }) => {
  await fixtures(page, [paid]);
  await page.goto('/fearhunger/');
  const card = page.locator(`[data-song-id="${paid.id}"]`);
  await expect(badge(card)).toHaveText('EMP');
  await expect(card.locator('.voice-model-badge')).toHaveText('V7');
  await card.locator('audio').evaluate(audio => audio.play());
  await card.locator('audio').evaluate(audio => { window.savedAudio = audio; audio.currentTime = 12; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => card.locator('audio').evaluate(audio => audio === window.savedAudio && !audio.paused && audio.currentTime >= 12)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.screenshot({ path: 'artifacts/music-provenance/fearhunger-mobile.png' });
  await page.goto('/mixtapes/');
  await page.getByRole('button', { name: 'Add Last bus home to side A' }).click();
  await expect(badge(page.locator('.tape-track'))).toHaveText('EMP');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Backstage labels paid requests even before expanding their brief', async ({ page }) => {
  await fixtures(page);
  await page.route('**/yehry3/session', route => route.fulfill({ json: { token: 'local-browser-fixture', expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  await page.route('**/yehry3/admin/prompts?*', route => route.fulfill({ json: { prompts: [{ id: 'paid-admin-fixture', status: 'queued', version: 1, prompt: paid.originalPrompt.idea, details: paid.originalPrompt, confirmedAt: pending.submittedAt, priority: 0, history: [] }], total: 1, page: 0, counts: { queued: 1 }, transitions: { queued: ['canceled'] }, workers: [] } }));
  await page.goto('/admin/');
  await page.getByLabel('Password', { exact: true }).fill('browser-test-admin');
  await page.getByRole('button', { name: 'Open the queue' }).click();
  const card = page.locator('[data-prompt="paid-admin-fixture"]');
  await expect(badge(card)).toHaveText('EMP');
  await expect(card.locator('.prompt-summary')).toContainText('Eleven Music · paid');
  await expect(card.locator('.prompt-summary')).not.toContainText('V8 generation');
  await card.getByText('Open brief & controls').click();
  await expect(card.getByRole('heading', { name: 'Eleven Music settings' })).toBeVisible();
});
