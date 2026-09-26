import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { settledSongCosts } from "../../assets/settled-song-costs.js";
const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const recording = catalog.songs.find(song => song.url.startsWith("/fearhunger/"));
const titles = ["Arbys at Eleven", "The Book of Parallel Cs", "The Save File Has Teeth", "Medusa", "The Midnight Chrome Express", "Blood on My Shoes at Daybreak"];
const fixtures = () => Array.from({ length: 31 }, (_, i) => ({
  id: "art-" + i, title: titles[i % titles.length] + (i > 5 ? " " + i : ""),
  duration: 180, url: recording.url, collection: "tonyai", votes: 0, hasLyrics: true,
  qualityIssues: i === 0 ? [{ code: "long_instrumental_break", seconds: 35 }] : [],
}));
async function mock(page, songs = fixtures()) {
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/listens", route => route.fulfill({ json: { counted: true, playCount: 1 } }));
}
const switchTo = (page, view) => page.getByRole("button", { name: view, exact: true }).click();

test("paid song costs survive grid/list switching and offline mobile catalogs", async ({ page }) => {
  const [id, cents] = Object.entries(settledSongCosts).find(([, value]) => value >= 100);
  const songs = fixtures().slice(0, 7);
  Object.assign(songs[0], { id, musicBackend: 'eleven_music' });
  Object.assign(songs[1], { musicBackend: 'eleven_music', duration: 180 });
  Object.assign(songs[2], { musicBackend: 'eleven_music', duration: null });
  Object.assign(songs[3], { musicBackend: 'local' });
  for (const [index, duration] of [[4, 396], [5, 400], [6, 476]]) Object.assign(songs[index], { musicBackend: 'eleven_music', duration });
  await mock(page, songs);
  for (const offline of [false, true]) {
    if (offline) await page.route('**/yehry3/songs/summary', route => route.abort());
    await page.goto('/?sort=catalog');
    await expect(page.locator('.track')).toHaveCount(7);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['Grid', 'List']) {
        await switchTo(page, view);
        await expect(page.locator('.song-cost')).toHaveText([`$${(cents / 100).toFixed(2)}`, '45 ¢', '50 ¢', 'FREE', '99 ¢', '$1.00', '$1.19']);
        await expect(page.locator('.track .music-backend-badge')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (!offline && (width === 1440 || width === 390)) {
          await page.locator('.track').first().screenshot({ path: `artifacts/song-cost-${view.toLowerCase()}-${width}.png`, animations: 'disabled' });
        }
      }
    }
  }
});

test("views preserve page, filters, row state, audio and seek position", async ({ page }) => {
  await mock(page);
  await page.goto("/?sort=catalog&page=2");
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "grid");
  await expect(page.locator(".track")).toHaveCount(7);
  await page.locator("[data-play]").first().click();
  const audio = page.locator("#audio");
  await expect.poll(() => audio.evaluate(audio => audio.paused)).toBe(false);
  const cardControl = page.locator("[data-play]").first();
  await expect(cardControl).toHaveAttribute("data-playing", "true");
  await expect(cardControl).toHaveAttribute("aria-label", /^Pause /);
  await cardControl.click();
  await expect.poll(() => audio.evaluate(audio => audio.paused)).toBe(true);
  await expect(cardControl).toHaveAttribute("aria-label", /^Play /);
  await cardControl.click();
  await expect.poll(() => audio.evaluate(audio => audio.paused)).toBe(false);
  await expect(cardControl).toHaveAttribute("aria-label", /^Pause /);
  await audio.evaluate(audio => { window.originalAudio = audio; audio.currentTime = 30; });
  await page.locator(".track").first().evaluate(row => { window.originalRow = row; });
  const currentUrl = page.url();
  const src = await page.locator(".track-art").first().getAttribute("src");
  await switchTo(page, "List");
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "list");
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).toBe(currentUrl);
  expect(await page.locator(".track").first().evaluate(row => row === window.originalRow)).toBe(true);
  expect(await audio.evaluate(audio => audio === window.originalAudio && !audio.paused && audio.currentTime >= 30)).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(await page.locator(".track-art").first().getAttribute("src")).toBe(src);
  await switchTo(page, "Grid");
  expect(await audio.evaluate(audio => audio === window.originalAudio && !audio.paused && audio.currentTime >= 30)).toBe(true);
  await page.getByRole("button", { name: "Next song", exact: true }).click();
  await expect(page.locator("#now-title")).toHaveText(fixtures()[25].title);
  await page.locator(".catalog-filters > summary").click();
  await page.getByLabel("Search songs", { exact: true }).fill("Medusa");
  await expect(page.locator(".track")).toHaveCount(5);
  await switchTo(page, "List");
  await expect(page.getByLabel("Search songs", { exact: true })).toHaveValue("Medusa");
  await expect(page.locator(".track")).toHaveCount(5);
});

test("saved view survives reload, navigation, another tab, and unavailable storage", async ({ page, context }) => {
  await mock(page);
  await page.goto("/");
  await switchTo(page, "List");
  await page.reload();
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "list");
  await page.goto("/queue/");
  await page.goto("/");
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "list");
  const other = await context.newPage();
  await mock(other);
  await other.goto("/");
  await expect(other.locator("#tracks")).toHaveAttribute("data-view", "list");
  await switchTo(other, "Grid");
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "grid");
  await other.close();
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.reload();
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "grid");
  await switchTo(page, "List");
  await expect(page.locator("#tracks")).toHaveAttribute("data-view", "list");
});

test("desktop and mobile render valid art in both views without overflow", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mock(page, fixtures().slice(0, 6));
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track-art")).toHaveCount(6);
  await page.locator(".catalog-view-bar").evaluate(bar => bar.scrollIntoView({ block: "start" }));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ["Grid", "List"]) {
      await switchTo(page, view);
      await expect.poll(() => page.locator(".track-art").first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (view === 'List' && width <= 650) {
        expect((await page.locator('.track-heading').first().boundingBox()).width).toBeGreaterThan(100);
        await expect(page.locator('.track-links').first()).toBeHidden();
        await expect(page.locator('.song-more').first()).toBeVisible();
      }
      const layout = await page.locator(".track").evaluateAll(rows => rows.slice(0, 2).map(row => { const r = row.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
      if (view === "Grid" && width >= 768) expect(layout[0].y).toBe(layout[1].y);
      else expect(layout[1].y).toBeGreaterThan(layout[0].y);
      await page.locator(".catalog-view-bar").evaluate(bar => bar.scrollIntoView({ block: "start" }));
      if (width === 1440 || width === 390) await page.screenshot({ path: "artifacts/catalog-" + view.toLowerCase() + "-" + width + ".png", animations: "disabled" });
    }
  }
  expect(errors).toEqual([]);
});

test("offline catalog keeps artwork and controls; voting still works when online", async ({ page }) => {
  const songs = fixtures().slice(0, 2);
  await mock(page, songs);
  await page.route("**/yehry3/songs/summary", route => route.abort());
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track-art")).toHaveCount(2);
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await page.locator(".quality-notice > summary").first().click();
  await switchTo(page, "List");
  await expect(page.locator(".quality-notice").first()).toHaveAttribute("open", "");
  await expect(page.locator(".track-art").first()).toBeVisible();
  await page.unroute("**/yehry3/songs/summary");
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/votes", async route => {
    expect(route.request().postDataJSON().songId).toBe(songs[0].id);
    songs[0].votes = 1;
    await route.fulfill({ json: { nextVoteAt: new Date(Date.now() + 3600000).toISOString() } });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("[data-vote]").first()).toBeEnabled();
  await switchTo(page, "Grid");
  await page.locator("[data-vote]").first().click();
  await expect(page.locator("#message")).toContainText("Vote counted");
  await expect(page.locator("[data-vote]").first()).toContainText("1");
});


test("saving a song and the saved filter work in either view", async ({ page }) => {
  await page.goto("/?q=" + encodeURIComponent(recording.title));
  await expect(page.locator(".track")).toHaveCount(1);
  await page.locator(".profile-details > summary").click();
  await page.locator(".new-profile summary").click();
  await page.getByLabel("Profile name", { exact: true }).fill("Art views " + crypto.randomUUID().slice(0, 8));
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  await expect(page.locator("#profile-status")).toContainText("Synced across devices");
  const save = page.locator('[data-save="' + recording.id + '"]');
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await switchTo(page, "List");
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await page.locator(".profile-details > summary").click();
  await page.locator("#saved-only").click();
  await expect(page.locator(".track")).toHaveCount(1);
  await switchTo(page, "Grid");
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await save.click();
  await expect(page.locator("#tracks")).toContainText("No saved songs");
});

