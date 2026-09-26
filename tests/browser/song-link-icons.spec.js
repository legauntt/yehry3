import { openSongMenu } from "./helpers/song-menu.js";
import { test, expect } from '@playwright/test';
import { lyricsHref } from '../../assets/song-links.js';

const song = {
  id: 'icon-song', title: 'The Midnight Express', collection: 'tonyai', duration: 180,
  url: '/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3',
  lyrics: { text: 'The moon is over the station\nThe train is taking me home', kind: 'written' },
  originalPrompt: { idea: 'A train song at midnight' },
  songPlan: { title: 'The Midnight Express', duration: 180, bpm: 100 },
  remixAvailability: { status: 'ready', expiresAt: '2099-01-01T00:00:00Z' },
  remixOf: { songId: 'original-song', title: 'The Original Express' },
};
async function setup(page) {
  const songs = [song, { ...song, id: 'unavailable-song', title: 'Unavailable source', remixAvailability: { status: 'unavailable' } }];
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs } }));
  await page.route('**/songs/icon-song.json', route => route.fulfill({ json: { song } }));
  await page.route('**/yehry3/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/songs/summary') ? { songs, nextVoteAt: null }
      : path.endsWith('/songs/icon-song') ? { song }
        : path.endsWith('/queue') ? { inStudio: [], queued: [], recent: [] } : {} });
  });
  await page.goto('/?sort=catalog');
  await expect(page.locator('.track')).toHaveCount(2);
}

test('labeled song actions retain links without duplicate tooltips and keep the audio playing', async ({ page }) => {
  await setup(page);
  const row = page.locator('[data-id="icon-song"]');
  await openSongMenu(row);
  const lyrics = row.getByRole('link', { name: `Lyrics for ${song.title}`, exact: true });
  const tooltip = page.locator('#song-link-tooltip');
  await expect(lyrics).toHaveAttribute('href', lyricsHref(song));
  await expect(row.getByRole('link', { name: `Song plan for ${song.title}` })).toHaveAttribute('href', '/original-prompt/?song=icon-song#song-plan');
  await expect(row.getByRole('link', { name: `Original prompt for ${song.title}` })).toHaveAttribute('href', '/original-prompt/?song=icon-song');
  await expect(row.getByRole('link', { name: `Remix ${song.title}`, exact: true })).toHaveAttribute('href', '/distonyc/?remix=icon-song');
  await expect(row.getByRole('link', { name: `Compare ${song.title} with The Original Express` })).toHaveAttribute('href', '/lyrics/?song=icon-song#compare-original');
  await lyrics.hover();
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await openSongMenu(row);
  await lyrics.focus();
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(tooltip).toBeHidden();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.sharedTheme = ''; document.documentElement.dataset.theme = theme; }, theme);
    for (const view of ['Grid', 'List']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      await openSongMenu(row);
      await expect(lyrics.locator('.song-link-caption')).toBeVisible();
      await lyrics.hover();
      await lyrics.focus();
      await expect(tooltip).toBeHidden();
      await row.screenshot({ path: `artifacts/song-icons-${view.toLowerCase()}-${theme}.png` });
    }
  }
  await row.locator('[data-play]').click();
  await expect.poll(() => page.locator('#audio').evaluate(audio => audio.paused)).toBe(false);
  await page.locator('#audio').evaluate(audio => { window.iconAudio = audio; audio.currentTime = 25; });
  await openSongMenu(row);
  await lyrics.click();
  await expect(page).toHaveURL(new RegExp(lyricsHref(song)));
  await expect(page.locator('.lyrics-sheet h1')).toHaveText(song.title);
  expect(await page.locator('#audio').evaluate(audio => audio === window.iconAudio && !audio.paused && audio.currentTime >= 25)).toBe(true);
  await expect(tooltip).toHaveCount(0);
});

test.describe('touch song actions', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('captions, large targets and unavailable explanations fit both mobile views', async ({ page }) => {
    await setup(page);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ['Grid', 'List']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        const row = page.locator('[data-id="icon-song"]');
        await openSongMenu(row);
        await expect(row.locator('.song-link-caption').first()).toBeVisible();
        await row.locator('[data-song-link="lyrics"]').focus();
        await expect(page.locator('#song-link-tooltip')).toBeHidden();
        for (const link of await row.locator('.song-link-icon').all()) {
          const bounds = await link.boundingBox();
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(43.99); // Mobile viewport scaling can round by < .001px.
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await row.screenshot({ path: `artifacts/song-icons-${view.toLowerCase()}-${width}.png` });
        const unavailable = page.locator('[data-id="unavailable-song"] .remix-unavailable');
        await openSongMenu(page.locator('[data-id="unavailable-song"]'));
        await unavailable.focus();
        await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
        await expect(unavailable).not.toHaveAttribute('href');
        await expect(page.locator('#song-link-tooltip')).toContainText('temporarily unavailable');
        const tip = await page.locator('#song-link-tooltip').boundingBox();
        expect(tip.x).toBeGreaterThanOrEqual(0);
        expect(tip.x + tip.width).toBeLessThanOrEqual(width);
      }
    }
  });
});
