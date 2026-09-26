import { test, expect } from "@playwright/test";

const songs = Array.from({ length: 40 }, (_, order) => ({
  id: `loading-${order}`, title: `Song ${String(order).padStart(2, "0")}`, duration: 180, order,
  collection: "tonyai", url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  publishedAt: "2026-01-01T00:00:00Z", votes: 40 - order, playCount: order,
  pins: order === 0 ? 2 : 0, feedback: { pinned: order === 0 },
}));
const full = { songs, nextVoteAt: null, archived: ["archived-fixture"] };
const first = { ...full, songs: songs.slice(0, 25), total: 40, pageSize: 25 };
function gate() {
  let release;
  return { promise: new Promise(resolve => { release = resolve; }), release: () => release() };
}
async function fixtures(page) {
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/yehry3/listens", route => route.fulfill({ json: { counted: true, playCount: 1 } }));
}

for (const width of [1440, 390]) {
  test(`first page is stable and playable while catalog and queue load (${width})`, async ({ page }) => {
    await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    const startup = gate(), catalog = gate();
    let fallbackReads = 0;
    await page.route("**/catalog-summary.json", route => { fallbackReads++; return route.fulfill({ json: { songs: [...songs].reverse() } }); });
    await page.route("**/yehry3/songs/first-page", async route => { await startup.promise; await route.fulfill({ json: first }); });
    await page.route("**/yehry3/songs/summary", async route => { await catalog.promise; await route.fulfill({ json: full }); });
    await page.route("**/yehry3/queue?*", () => {});
    await page.goto("/");
    await expect(page.locator("#tracks")).toHaveText("Loading...");
    await expect(page.locator("#tracks .track")).toHaveCount(0);
    startup.release();
    await expect(page.locator("#tracks .track")).toHaveCount(24);
    await expect(page.locator("#tracks .track").first()).toHaveAttribute("data-id", songs[0].id);
    await expect(page.locator(`[data-pin="${songs[0].id}"]`)).toBeEnabled();
    await expect(page.locator(`[data-pin="${songs[0].id}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#track-count")).toContainText("40 songs · Showing 1–24");
    await expect(page.locator("#listening-total")).toHaveText("—");
    await expect(page.locator("#play-all")).toBeDisabled();
    const initialIds = await page.locator("#tracks .track").evaluateAll(rows => rows.map(row => row.dataset.id));
    await page.locator(`[data-play="${songs[0].id}"]`).click();
    await expect.poll(() => page.locator("#audio").evaluate(audio => audio.paused)).toBe(false);
    await page.locator("#audio").evaluate(audio => { window.initialAudio = audio; audio.currentTime = 5; });
    catalog.release();
    await expect(page.locator("#play-all")).toBeEnabled();
    expect(await page.locator("#tracks .track").evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual(initialIds);
    expect(await page.locator("#audio").evaluate(audio => audio === window.initialAudio && !audio.paused && audio.currentTime >= 5)).toBe(true);
    expect(await page.evaluate(async () => (await import("/assets/player.js")).player.queue.length)).toBe(40);
    expect(fallbackReads).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/catalog-loading-${width}.png`, fullPage: true });
  });
}

test("next page and filters wait for the full background catalog without losing requested state", async ({ page }) => {
  await fixtures(page);
  const catalog = gate();
  await page.route("**/yehry3/songs/first-page", route => route.fulfill({ json: first }));
  await page.route("**/yehry3/songs/summary", async route => { await catalog.promise; await route.fulfill({ json: full }); });
  await page.goto("/");
  await expect(page.locator("#tracks .track")).toHaveCount(24);
  await page.locator('[data-catalog-page="1"]').first().click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator("#tracks")).toHaveText("Loading...");
  catalog.release();
  await expect(page.locator("#tracks .track")).toHaveCount(16);
  await expect(page.locator("#tracks .track").first()).toHaveAttribute("data-id", songs[24].id);
  await page.locator(".catalog-filters > summary").click();
  await page.locator("#search").fill("Song 39");
  await expect(page.locator("#tracks .track")).toHaveCount(1);
  await expect(page.locator("#tracks .track h3")).toHaveText("Song 39");
});

test("a nondefault deep link loads full results without flashing the default page", async ({ page }) => {
  await fixtures(page);
  const catalog = gate();
  let startupReads = 0;
  await page.route("**/yehry3/songs/first-page", route => { startupReads++; return route.fulfill({ json: first }); });
  await page.route("**/yehry3/songs/summary", async route => { await catalog.promise; await route.fulfill({ json: full }); });
  await page.goto("/?sort=title&page=2");
  await expect(page.locator("#tracks")).toHaveText("Loading...");
  catalog.release();
  await expect(page.locator("#tracks .track")).toHaveCount(16);
  await expect(page).toHaveURL(/sort=title&page=2/);
  expect(startupReads).toBe(0);
});

test("full catalog wins over a late first page and does not wait for the queue", async ({ page }) => {
  await fixtures(page);
  const startup = gate();
  await page.route("**/yehry3/songs/first-page", async route => { await startup.promise; await route.fulfill({ json: first }); });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { ...full, songs: songs.map(song => ({ ...song, pins: 0, feedback: {} })) } }));
  await page.route("**/yehry3/queue?*", () => {});
  await page.goto("/");
  await expect(page.locator("#play-all")).toBeEnabled();
  const response = page.waitForResponse(response => response.url().endsWith("/songs/first-page"));
  startup.release();
  await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#track-count")).not.toContainText("Loading");
  await expect(page.locator(".track.pinned")).toHaveCount(0);
});

test("API failure falls back to playable static songs and excludes remembered archives", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => localStorage.setItem("yehry3:archived-songs", JSON.stringify(["loading-0"])));
  for (const endpoint of ["first-page", "summary"]) await page.route(`**/yehry3/songs/${endpoint}`, route => route.abort());
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.goto("/");
  await expect(page.locator("#tracks .track")).toHaveCount(24);
  await expect(page.locator('[data-id="loading-0"]')).toHaveCount(0);
  await expect(page.locator("#vote-note")).toContainText("offline");
  await expect(page.locator("#play-all")).toBeEnabled();
});
