import { test, expect } from '@playwright/test';
import { openSongMenu } from './helpers/song-menu.js';

test.use({ isMobile: true, hasTouch: true });
test('List keeps titles, notices and touch controls readable in compact rows', async ({ page }) => {
  const songs = Array.from({ length: 49 }, (_, i) => ({
    id: `list-${i}`, title: i === 1 ? 'The Very Long Song Title That Still Needs Room to Breathe' : `Midnight Train ${i + 1}`,
    collection: 'tonyai', url: '/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3',
    duration: 180, voiceModel: 'v8', authoredBy: 'Jesse', votes: i === 2 ? 12 : 0,
    pins: i === 2 ? 1 : 0, hasLyrics: true, hasOriginalPrompt: true, feedback: {},
    qualityIssues: i === 3 ? [{ code: 'long_instrumental_break', seconds: 35 }] : [],
  }));
  await page.addInitScript(() => localStorage.setItem('yehry3:catalog-view', 'list'));
  await page.route('**/yehry3/songs/summary', route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route('**/yehry3/queue?*', route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto('/?sort=catalog');
  await expect(page.locator('#tracks > .track')).toHaveCount(24);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 1000, 768, 650, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.locator('.catalog-view-bar').scrollIntoViewIfNeeded();
      const row = page.locator('[data-id="list-0"]');
      const boxes = await row.locator('.play-song, .vote, .favorite-button, .song-more').evaluateAll(items => items.map(el => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }));
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(43.99);
        expect(box.height).toBeGreaterThanOrEqual(43.99);
      }
      expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThan(1);
      expect((await row.boundingBox()).height).toBeLessThan(width > 650 ? 105 : 175);
      await expect(page.locator('[data-id="list-3"] .quality-notice')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const title = page.locator('[data-id="list-1"] h3');
      expect(await title.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
      const height = (await row.boundingBox()).height;
      await openSongMenu(row);
      await expect(row.locator('[data-pin]')).toBeVisible();
      const panel = await row.locator('.song-menu-panel').boundingBox();
      expect(panel.x).toBeGreaterThanOrEqual(7);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width - 7);
      expect(panel.y).toBeGreaterThanOrEqual(7);
      expect(panel.y + panel.height).toBeLessThanOrEqual(837);
      expect((await row.boundingBox()).height).toBe(height);
      await page.keyboard.press('Escape');
      await expect(row.locator('.song-more')).toBeFocused();
      if ([1440, 390, 320].includes(width)) {
        await page.locator('.catalog-view-bar').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `artifacts/list-startup/list-${width}-${theme}.png`, animations: 'disabled' });
      }
    }
  }
  await page.getByRole('button', { name: 'Next page', exact: true }).first().click();
  await expect(page.locator('#track-count')).toHaveText('49 songs · Showing 25–48');
  await page.getByRole('button', { name: 'Next page', exact: true }).first().click();
  await expect(page.locator('#track-count')).toHaveText('49 songs · Showing 49–49');
  await expect(page.locator('#tracks > .track')).toHaveCount(1);
  expect(errors).toEqual([]);
});
