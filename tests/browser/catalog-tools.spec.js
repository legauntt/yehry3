import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../../catalog.json', import.meta.url), 'utf8'));
const songs = catalog.songs.slice(0, 31);
const profile = { id: 'faaa0000-0000-4000-8000-000000000001', name: "NINE ELEVEN'D AGAIN", songIds: [], revision: 1 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => .695; });
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs } }));
  await page.route('**/yehry3/songs/summary', route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route('**/yehry3/queue?*', route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route('**/yehry3/profiles?*', route => route.fulfill({ json: { profiles: [profile], page: 0, hasMore: false } }));
  await page.route(`**/yehry3/profiles/${profile.id}`, route => route.fulfill({ json: { profile } }));
});

test('popouts overlay songs, dismiss accessibly, and keep filters across refreshes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#tracks > .track')).toHaveCount(25);
  await expect(page.locator('.hero .actions')).toHaveCount(0);
  const filters = page.locator('.catalog-filters');
  const profilePanel = page.locator('.profile-details');
  const top = await page.locator('#catalog-items').evaluate(el => el.getBoundingClientRect().top);
  await filters.locator('summary').press('Enter');
  await expect(page.getByLabel('Search songs', { exact: true })).toBeVisible();
  expect(await page.locator('#catalog-items').evaluate(el => el.getBoundingClientRect().top)).toBe(top);
  await page.getByLabel('Sort songs').selectOption('title');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(filters).toHaveAttribute('open', '');
  await expect(page.getByLabel('Sort songs')).toHaveValue('title');
  await page.keyboard.press('Escape');
  await expect(filters).not.toHaveAttribute('open', '');
  await expect(filters.locator('summary')).toBeFocused();
  await expect(page.locator('#filter-count')).toHaveText('1');
  await filters.locator('summary').press('Enter');
  await page.locator('#shuffle').focus();
  await page.keyboard.press('Tab');
  await expect(filters).not.toHaveAttribute('open', '');
  await profilePanel.locator(':scope > summary').click();
  await page.getByLabel('Listener profile', { exact: true }).selectOption(profile.id);
  await expect(page.locator('#profile-current')).toHaveText(profile.name);
  await page.locator('.listening-overview > summary').click();
  await expect(profilePanel).not.toHaveAttribute('open', '');
  await expect(page.locator('#listening-total')).toBeVisible();
  await page.getByRole('heading', { name: 'Pick your next obsession.' }).click();
  await expect(page.locator('#listening-total')).toBeHidden();
  await page.locator('.catalog-voting > summary').click();
  await expect(page.locator('#vote-note')).toContainText('One anonymous vote');
  await page.getByRole('button', { name: 'Open display settings' }).click();
  await expect(page.locator('#vote-note')).toBeHidden();
  await expect(page.locator('.display-settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open display settings' })).toBeFocused();
  await page.reload();
  await expect(page.locator('#filter-count')).toHaveText('1');
  await expect(profilePanel).not.toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});

test('compact rows and every open panel fit desktop and narrow phones in both themes', async ({ page }) => {
  await page.goto(`/?profile=${profile.id}`);
  await expect(page.locator('#profile-current')).toHaveText(profile.name);
  for (const width of [1295, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 858 });
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('#tracks > .track')).toHaveCount(25);
    expect(await page.locator('#catalog-items').evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(width > 1000 ? 520 : 660);
    for (const summary of await page.locator('.catalog-popout > summary').all()) {
      expect(await summary.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate(dark => window.yehry3Theme.setDark(dark), theme === 'dark');
      await expect(page.locator('.catalog-filters > summary')).toHaveCSS('color', theme === 'dark' ? 'rgb(231, 237, 223)' : 'rgb(40, 59, 48)');
      await page.evaluate(() => document.activeElement.blur());
      await page.screenshot({ path: `artifacts/compact-collection-${width}-${theme}.png` });
      for (const selector of ['.catalog-filters', '.profile-details', '.listening-overview', '.catalog-voting']) {
        const panel = page.locator(selector);
        await panel.locator(':scope > summary').click();
        const box = await panel.locator(':scope > div').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (selector === '.catalog-filters' && [1295, 390].includes(width)) {
          await page.screenshot({ path: `artifacts/compact-filters-${width}-${theme}.png` });
        }
        await page.keyboard.press('Escape');
      }
    }
  }
});
