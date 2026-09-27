import { test, expect } from '@playwright/test';

const songs = ['first', 'second'].map((id, order) => ({
  id: `lazy-remix-${id}`, title: `Remix ${id}`, order, duration: 180,
  collection: 'tonyai', url: '/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3',
  remixOf: { songId: 'original', title: 'Original recording' },
}));
const ready = { remixAvailability: { status: 'ready', expiresAt: '2099-01-01T00:00:00Z' } };
function gate() {
  let release;
  return { promise: new Promise(resolve => { release = resolve; }), release: () => release() };
}
async function setup(page, remix) {
  const reads = [];
  await page.route('**/catalog-summary.json', route => route.fulfill({ json: { songs } }));
  await page.route('**/yehry3/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/yehry3', '');
    if (path.endsWith('/remix')) { reads.push(path); return remix(route, reads.length); }
    if (path === '/songs/summary' || path === '/songs/first-page')
      return route.fulfill({ json: { songs, archived: [], nextVoteAt: null, total: 2, pageSize: 25 } });
    return route.fulfill({ json: { inStudio: [], queued: [], recent: [], profiles: [], pins: [] } });
  });
  return reads;
}
const row = (page, n) => page.locator(`[data-id="${songs[n].id}"]`);
const open = (page, n) => row(page, n).locator('.song-more').click();

for (const width of [1440, 390]) test(`remix reads wait for an opened menu and stay with their track (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const delayed = gate();
  const reads = await setup(page, async route => {
    if (route.request().url().includes(songs[0].id)) {
      await delayed.promise; return route.fulfill({ json: ready });
    }
    return route.fulfill({ json: { remixAvailability: { status: 'unavailable' } } });
  });
  await page.goto('/?sort=catalog');
  await expect(page.locator('#tracks .track')).toHaveCount(2);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  expect(reads).toEqual([]);
  await open(page, 0);
  await expect(row(page, 0).getByRole('status')).toHaveText('Checking remix…');
  await open(page, 0); await open(page, 0);
  expect(reads).toHaveLength(1);
  await open(page, 1);
  await expect(row(page, 1).locator('[data-remix]')).toContainText('Remix unavailable');
  delayed.release();
  await expect(row(page, 0).locator('[data-remix] a').first()).toHaveAttribute('href', `/distonyc/?remix=${songs[0].id}`);
  await expect(row(page, 0).locator('.song-more')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 1).locator('.song-more')).toHaveAttribute('aria-expanded', 'true');
  await open(page, 0);
  await expect(row(page, 0).getByRole('link', { name: `Remix ${songs[0].title}`, exact: true })).toBeVisible();
  expect(reads).toHaveLength(2);
  const box = await row(page, 0).locator('.song-menu-panel').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `artifacts/catalog-remix-${width}.png` });
});

test('a failed readiness read can retry and the short cache expires', async ({ page }) => {
  const reads = await setup(page, (route, n) => n === 1
    ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } })
    : route.fulfill({ json: n === 2 ? ready : { remixAvailability: { status: 'unavailable' } } }));
  await page.goto('/?sort=catalog');
  await open(page, 0);
  await expect(row(page, 0).getByRole('link', { name: `Check remix availability for ${songs[0].title}` })).toBeVisible();
  await open(page, 0); await open(page, 0);
  await expect(row(page, 0).getByRole('link', { name: `Remix ${songs[0].title}`, exact: true })).toBeVisible();
  await open(page, 0);
  await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 31000; });
  await open(page, 0);
  await expect(row(page, 0).locator('[data-remix]')).toContainText('Remix unavailable');
  expect(reads).toHaveLength(3);
});

test('a readiness response cannot update a page after navigation', async ({ page }) => {
  const delayed = gate(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const reads = await setup(page, async route => { await delayed.promise; return route.fulfill({ json: ready }); });
  await page.goto('/?sort=catalog');
  await open(page, 0);
  await expect.poll(() => reads.length).toBe(1);
  await page.locator('a[href="/queue/"]').first().click();
  await expect(page).toHaveURL(/\/queue\/$/);
  const response = page.waitForResponse(response => response.url().endsWith('/remix'));
  delayed.release(); await response;
  await expect(page.locator('#tracks')).toHaveCount(0);
  expect(errors).toEqual([]);
});
