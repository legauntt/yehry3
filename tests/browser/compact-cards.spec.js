import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openSongMenu } from './helpers/song-menu.js';

const catalog = JSON.parse(await readFile(new URL('../../catalog.json', import.meta.url), 'utf8'));
const recording = catalog.songs.find(song => song.url.startsWith('/fearhunger/'));
const fixtures = () => Array.from({ length: 8 }, (_, i) => ({
  id: `compact-${i}`, title: i === 1 ? 'The Very Long Song Title That Still Needs Room to Breathe' : `Midnight Train ${i + 1}`,
  collection: 'tonyai', url: recording.url, duration: 180, voiceModel: 'v8',
  authoredBy: 'Jesse', votes: i === 2 ? 12 : 0, pins: i === 2 ? 1 : 0,
  hasLyrics: true, hasOriginalPrompt: true, playCount: 19, feedback: {},
}));
async function mock(page, songs) {
  await page.route('**/yehry3/songs/summary', route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs } }));
  await page.route('**/yehry3/queue?*', route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route('**/yehry3/listens', route => route.fulfill({ json: { counted: true, playCount: 20 } }));
}

test('grid action popouts dismiss accessibly, survive refresh, and preserve playback', async ({ page }) => {
  const songs = fixtures();
  await mock(page, songs);
  await page.goto('/?sort=catalog');
  const row = page.locator('[data-id="compact-0"]');
  const other = page.locator('[data-id="compact-1"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[data-pin]')).toBeHidden();
  await row.locator('[data-play]').click();
  const audio = page.locator('#audio');
  await expect.poll(() => audio.evaluate(el => el.paused)).toBe(false);
  await audio.evaluate(el => { window.originalAudio = el; el.currentTime = 20; });
  const height = (await row.boundingBox()).height;
  await row.locator('.song-more').press('Enter');
  await expect(row.locator('[data-pin]')).toBeVisible();
  await expect(row.getByRole('link', { name: 'Lyrics for Midnight Train 1' })).toBeVisible();
  expect((await row.boundingBox()).height).toBe(height);
  await page.keyboard.press('Tab');
  await expect(row.getByRole('link', { name: 'Lyrics for Midnight Train 1' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.locator('.song-menu-panel')).toBeHidden();
  await expect(row.locator('.song-more')).toBeFocused();
  await openSongMenu(row);
  await row.locator('[data-art]').click();
  await expect(page.locator('.art-remix')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.art-remix')).toBeHidden();
  await expect(row.locator('[data-art]')).toBeFocused();
  await expect(row.locator('.song-menu-panel')).toBeVisible();
  songs[0].playCount++;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(row.locator('.track-listening')).toContainText('20 listens');
  await expect(row.locator('.song-menu-panel')).toBeVisible();
  await openSongMenu(other);
  await expect(row.locator('.song-menu-panel')).toBeHidden();
  await other.locator('[data-feedback="milquetoast"]').focus();
  await page.keyboard.press('Tab');
  await expect(other.locator('.song-menu-panel')).toBeHidden();
  await openSongMenu(row);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(row.locator('[data-pin]')).toBeHidden();
  await expect(row.locator('.song-more')).toBeVisible();
  await openSongMenu(row);
  await expect(row.locator('[data-pin]')).toBeVisible();
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(row.locator('[data-pin]')).toBeHidden();
  expect(await audio.evaluate(el => el === window.originalAudio && !el.paused && el.currentTime >= 20)).toBe(true);
});

test('compact cards and popouts fit desktop, tablet, and narrow phones in both themes', async ({ page }) => {
  await mock(page, fixtures());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?sort=catalog');
  await expect(page.locator('#tracks > .track')).toHaveCount(8);
  for (const width of [1440, 1000, 768, 540, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.locator('.catalog-view-bar').scrollIntoViewIfNeeded();
      const row = page.locator('#tracks > .track').first();
      const controls = row.locator('.play-song, .vote, .favorite-button, .song-more');
      const boxes = await controls.evaluateAll(items => items.map(el => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }));
      expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThan(1);
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect((await row.boundingBox()).height).toBeLessThan(width <= 540 ? 365 : 475);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if ([1440, 390].includes(width)) await page.screenshot({ path: `artifacts/compact-cards/grid-${width}-${theme}.png`, animations: 'disabled' });
      // Both ends of the grid, including the viewport's lower edge.
      for (const card of [row, page.locator('#tracks > .track').last()]) {
        await openSongMenu(card);
        const panel = card.locator('.song-menu-panel');
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(7);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 7);
        expect(box.y).toBeGreaterThanOrEqual(7);
        expect(box.y + box.height).toBeLessThanOrEqual(837);
        if (width === 390) await page.screenshot({ path: `artifacts/compact-cards/menu-${theme}.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
  }
  expect(errors).toEqual([]);
});
