import { openSongMenu } from "./helpers/song-menu.js";
import { test, expect } from "@playwright/test";
import { songSummary } from "../../assets/song-summary.js";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const real = (catalog.songs || catalog).find(song => song.id?.startsWith("distonyc-"));
const recording = (catalog.songs || catalog).find(song => song.url.startsWith("/fearhunger/"));
const target = { id: real.id, title: "Shared fixture", duration: 90, url: recording.url, collection: "distonyc", votes: 0, order: -1, voiceModel: "v8", hasLyrics: true };
const filler = Array.from({ length: 8 }, (_, index) => ({
  id: `filler-${index}`, title: `Older song ${index}`, duration: 90, url: "/shared-fixture.wav",
  collection: "fearhunger", votes: 8 - index, order: -(index + 2),
}));
const songs = [...filler, target];
const queue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };

async function fixtures(page) {
  await page.route("**/shared-fixture.wav", route => route.fulfill({ body: Buffer.alloc(44), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
}

test("a shared song link badges the song for the life of the page", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/song/${target.id}/`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-shared/);
  await expect(row.locator(".shared-badge")).toHaveText("Shared with you just now");
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/is-revealed/);
  await expect(row).not.toHaveClass(/is-revealed/, { timeout: 12000 }); // The pulse settles; the badge stays.
  await expect(row.locator(".shared-badge")).toBeVisible();
  await expect(page.locator(".shared-spotlight-backdrop")).toBeVisible();
  // Every render resets each row's classes; the badge must be reapplied once the alert outline has expired.
  await page.evaluate(() => { const search = document.querySelector("#search"); search.value = "Shared"; search.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator(`.track[data-id="${target.id}"]`)).toHaveClass(/is-shared/);
  await expect(page.locator(`.track[data-id="${target.id}"]`)).not.toHaveClass(/is-revealed/);
  await expect(page.locator(`.track[data-id="${target.id}"] .shared-badge`)).toHaveCount(1);
  await page.reload();
  await expect(page.locator(`.track[data-id="${target.id}"]`)).not.toHaveClass(/is-shared/);
});

test("a completion alert or typed fragment is revealed but not called shared", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/#${target.id}`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-revealed/);
  await expect(row).not.toHaveClass(/is-shared/);
  await expect(page.locator(".shared-badge")).toHaveCount(0);
  await expect(page.locator(".shared-spotlight-backdrop")).toHaveCount(0);
});

for (const width of [1440, 390, 320]) for (const view of ["grid", "list"]) {
  test(`shared spotlight keeps playback continuous in ${view} at ${width}px`, async ({ page }) => {
    await fixtures(page);
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ view, width }) => {
      localStorage.setItem("yehry3:catalog-view", view);
      if (width === 320) localStorage.setItem("yehry3:dark-mode", "true");
    }, { view, width });
    await page.goto(`/song/${target.id}/`);
    const row = page.locator(`.track[data-id="${target.id}"]`);
    const backdrop = page.locator(".shared-spotlight-backdrop");
    await expect(backdrop).toBeVisible();
    await expect(row).toHaveClass(/is-share-spotlight/);
    await expect(row).toBeInViewport();
    await expect(page.getByRole("button", { name: "Show full collection" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Hit-testing proves the card is above the dimmer and the rest of the page is below it.
    expect(await row.locator("[data-play]").evaluate(button => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    expect(await page.evaluate(() => document.elementFromPoint(5, 5).className)).toBe("shared-spotlight-backdrop");
    await page.screenshot({ path: `artifacts/shared-spotlight-${view}-${width}.png` });
    const audio = page.locator("#audio");
    expect(await audio.evaluate(el => el.paused)).toBe(true);
    await row.locator("[data-play]").click();
    await expect.poll(() => audio.evaluate(el => el.paused)).toBe(false);
    await expect(backdrop).toBeVisible();
    await audio.evaluate(el => { window.sharedAudio = el; el.currentTime = 30; });
    await page.getByRole("button", { name: "Show full collection" }).click();
    await expect(backdrop).toHaveCount(0);
    await expect(row).not.toHaveClass(/is-share-spotlight/);
    await expect(row.locator(".shared-badge")).toBeVisible();
    expect(await audio.evaluate(el => el === window.sharedAudio && !el.paused && el.currentTime >= 30)).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(row).toHaveClass(/playing/);
    await expect(backdrop).toHaveCount(0);
    await row.locator("[data-play]").click();
    await expect.poll(() => audio.evaluate(el => el.paused)).toBe(true);
  });
}

for (const action of ["Escape", "PageDown", "Space", "outside click", "wheel", "touch scroll", "keyboard focus"]) {
  test(`${action} dismisses the shared spotlight without removing the badge`, async ({ page }) => {
    await fixtures(page);
    if (action === "touch scroll") await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/song/${target.id}/`);
    const row = page.locator(`.track[data-id="${target.id}"]`);
    await expect(row).toHaveClass(/is-share-spotlight/);
    if (["Escape", "PageDown", "Space"].includes(action)) await page.keyboard.press(action);
    if (action === "outside click") await page.mouse.click(5, 5);
    if (action === "wheel") await page.mouse.wheel(0, 250);
    if (action === "touch scroll") {
      const touch = await page.context().newCDPSession(page);
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 180, y: 400 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 180, y: 300 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await touch.detach();
    }
    if (action === "keyboard focus") await page.locator("[data-catalog-view='list']").focus();
    await expect(page.locator(".shared-spotlight-backdrop")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show full collection" })).toHaveCount(0);
    await expect(row).not.toHaveClass(/is-share-spotlight/);
    await expect(row.locator(".shared-badge")).toHaveCount(1);
  });
}

test("leaving the shared song through its lyrics clears the spotlight", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/song/${target.id}/`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-share-spotlight/);
  await openSongMenu(row);
  await row.getByRole("link", { name: "Lyrics for Shared fixture" }).click();
  await expect(page).toHaveURL(/\/lyrics\//);
  await expect(page.locator(".shared-spotlight-backdrop, .shared-spotlight-close")).toHaveCount(0);
});

test("the playing song and the player bar say Now playing", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = function () { setTimeout(() => this.dispatchEvent(new Event("play")), 0); Object.defineProperty(this, "paused", { value: false, configurable: true }); return Promise.resolve(); }; });
  await page.goto("/");
  const first = page.locator("#tracks .track").first();
  await first.locator("[data-play]").click();
  await expect(page.locator(".player .eyebrow")).toHaveText("Now playing");
  await expect(page.locator(".player.is-playing")).toBeVisible();
  await expect(page.locator("#tracks .track.playing")).toHaveCount(1);
  const label = await page.locator("#tracks .track.playing").evaluate(el => getComputedStyle(el, "::before").content);
  expect(label).toBe('"Now playing"');
  const animation = await page.locator("#tracks .track.playing").evaluate(el => getComputedStyle(el).animationName);
  expect(animation).toBe("now-playing-pulse");
});

test("a shared song is followed to the page the live catalog settles it on", async ({ page }) => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `many-${index}`, title: `Song ${index}`, duration: 90, url: "/shared-fixture.wav",
    collection: "fearhunger", votes: 500 - index, order: 100 - index,
  }));
  const early = [{ ...target, votes: 9999, order: 1000 }, ...many];
  const settled = [{ ...target, votes: 0, order: -1000 }, ...many];
  await fixtures(page);
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: early.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", async route => {
    await new Promise(resolve => setTimeout(resolve, 1500)); // The live catalog lands after the link did.
    await route.fulfill({ json: { songs: settled.map(songSummary), nextVoteAt: null } });
  });
  await page.goto(`/song/${target.id}/`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row.locator(".shared-badge")).toBeVisible();
  await expect(page.locator("[data-page-status]").first()).not.toHaveText("Page 1 of 3", { timeout: 8000 });
  await expect(row.locator(".shared-badge")).toBeVisible();
  await expect(row).toBeInViewport();
});

test("the revealed song stays centred while content above it loads, until the visitor scrolls", async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => addEventListener("DOMContentLoaded", () => { document.documentElement.style.overflowAnchor = "none"; })); // Anchoring would hide the drift.
  await page.goto(`/#${target.id}`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-revealed/);
  const offCentre = () => row.evaluate(el => { const box = el.getBoundingClientRect(); return Math.abs(box.top + box.height / 2 - innerHeight / 2); });
  await expect.poll(offCentre, { timeout: 5000 }).toBeLessThan(20);
  // Late content (art, fonts, the live catalog) pushes everything down.
  await page.evaluate(() => { const gap = document.createElement("div"); gap.style.height = "700px"; document.querySelector("main").prepend(gap); });
  await expect.poll(offCentre, { timeout: 5000 }).toBeLessThan(20);
  // Once the visitor scrolls, the page is theirs again.
  await page.mouse.wheel(0, 300);
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => { const gap = document.createElement("div"); gap.style.height = "500px"; document.querySelector("main").prepend(gap); });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(before - 5);
});

test("a link waits for the live sort, so a song the sort moves by one slot is still centred", async ({ page }) => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: `many-${index}`, title: `Song ${index}`, duration: 90, url: "/shared-fixture.wav",
    collection: "fearhunger", votes: 200 - index * 2, order: -index,
  }));
  const at = votes => [...many, { ...target, votes }].map(songSummary);
  await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: at(197) } })); // Third in a row of three.
  await page.route("**/yehry3/songs/summary", async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ json: { songs: at(195), nextVoteAt: null } }); // First of the next row.
  });
  await page.goto(`/#${target.id}`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-revealed/, { timeout: 8000 });
  await page.waitForTimeout(800);
  await expect(row.locator(".track-number")).toHaveText("04");
  const offCentre = await row.evaluate(el => { const box = el.getBoundingClientRect(); return Math.abs(box.top + box.height / 2 - innerHeight / 2); });
  expect(offCentre).toBeLessThan(20);
});

test("a link says it is loading while it waits for the live catalog, then gets out of the way", async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/yehry3/songs/summary", async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } });
  });
  await page.goto(`/song/${target.id}/`);
  await expect(page.locator("#message")).toContainText("Loading your song");
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-revealed/, { timeout: 8000 });
  await expect(page.locator("#message")).toBeEmpty();
  await page.waitForTimeout(600);
  const offCentre = await row.evaluate(el => { const box = el.getBoundingClientRect(); return Math.abs(box.top + box.height / 2 - innerHeight / 2); });
  expect(offCentre).toBeLessThan(20);
  // A plain visit says nothing.
  await page.goto("/");
  await expect(page.locator("#tracks .track").first()).toBeVisible();
  await expect(page.locator("#message")).toBeEmpty();
});
