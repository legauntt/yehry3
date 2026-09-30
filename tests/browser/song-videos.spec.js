import { test, expect } from "@playwright/test";
import pageOneSongs from "./fixtures/song-video-page1.json" with { type: "json" };

const songs = pageOneSongs.map(s => ({ ...s, collection: "distonyc", url: "/fixture.mp3", duration: 180, votes: 1, adminPinned: true, feedback: {} }));
test.beforeEach(async ({ page }) => {
  // A real, quiet PCM stream makes audio continuity observable without external media.
  const wav = Buffer.alloc(44 + 8000 * 2 * 180);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.route("**/fixture.mp3", r => r.fulfill({ contentType: "audio/wav", body: wav }));
  await page.route("**/yehry3/{catalog,songs/summary}", r => r.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", r => r.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", r => r.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
});
const card = page => page.locator(`[data-id="${songs[0].id}"]`);

test("returning home while Distonyc loads keeps the catalog and video controls", async ({ page }) => {
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route("**/yehry3/voice-models", async route => {
    requested();
    await gate;
    await route.fulfill({ json: { models: [] } });
  });
  await page.goto("/");
  await expect(card(page)).toBeVisible();
  await page.locator('header a[href="/distonyc/"]').click();
  await started;
  await page.locator('a[aria-label="yehry3 home"]').click();
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  release();
  await page.waitForTimeout(700);
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  await expect(page.locator("#password")).toHaveCount(0);
});

test("idle hover loads one silent square preview and stops on exit, scroll and refresh", async ({ page }) => {
  const requests = [];
  page.on("request", r => { if (/\/song-videos(?:-v1)?\//.test(r.url())) requests.push(r.url()); });
  await page.goto("/");
  await card(page).scrollIntoViewIfNeeded();
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  expect(requests).toHaveLength(0);
  const box = await card(page).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(0);
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(0);
  const video = card(page).locator(".song-video-preview");
  await expect(video).toBeVisible({ timeout: 12000 });
  await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
  expect(await video.evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }))).toEqual({ width: songs[0].videoWidth || 576, height: songs[0].videoHeight || 1024, duration: songs[0].videoDuration || 15 });
  const frame = await video.boundingBox();
  expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
  await page.screenshot({ path: "test-results/song-video-grid.png" });
  await page.mouse.move(5, 5);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await card(page).hover();
  await expect(video).toBeVisible({ timeout: 12000 });
  await page.mouse.wheel(0, 80);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await card(page).hover();
  await expect(video).toBeVisible({ timeout: 12000 });
  // A catalog update replaces this card's inner content while the pointer stays still.
  await card(page).evaluate(row => {
    const fresh = row.cloneNode(true);
    fresh.querySelector("video")?.remove();
    row.replaceChildren(...fresh.childNodes);
  });
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
});

test("failed preview keeps the cover usable and page navigation releases the viewer", async ({ page }) => {
  await page.route(/\/song-videos(?:-v1)?\/[^/]+\.mp4/, r => r.abort());
  await page.goto("/");
  await card(page).hover();
  await page.waitForTimeout(2600);
  await expect(card(page).locator(".is-video-playing")).toHaveCount(0);
  await expect(card(page).locator("img.track-art")).toBeVisible();
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-status")).toContainText("could not load");
  await page.keyboard.press("Escape");
  await page.locator('header a[href="/distonyc/"]').click();
  await expect(page.locator(".song-video-viewer")).toHaveCount(0);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await page.locator('a[aria-label="yehry3 home"]').click();
  await expect(page.locator(".song-video-viewer")).toHaveCount(1);
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
});

test("video modal supports keyboard, every page-one clip and leaves audio alone", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/");
  await expect(page.locator("[data-video-open]")).toHaveCount(24);
  await card(page).locator("[data-play]").click();
  await expect.poll(() => page.locator("audio").evaluateAll(items => items.some(a => !a.paused && a.currentTime > 0))).toBe(true);
  const before = await page.locator("audio").evaluateAll(items => items.find(a => !a.paused).currentTime);
  for (const song of songs) {
    const trigger = page.locator(`[data-video-open="${song.id}"]`);
    await expect(trigger).toHaveAttribute("title", `Watch ${song.videoDuration || 15}-second video`);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: song.title, exact: true });
    await expect(dialog).toBeVisible();
    const video = dialog.locator("video");
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
    expect(await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration])).toEqual([song.videoWidth || 576, song.videoHeight || 1024, song.videoDuration || 15]);
    await expect(dialog.locator("[data-video-description]")).toHaveText(`${song.videoDuration || 15}-second silent video`);
    if (song.videoWidth === 768) {
      const frame = await video.boundingBox();
      expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
    }
    expect(await page.locator("audio").evaluateAll(items => items.some(a => !a.paused))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator(".song-video-viewer video")).not.toHaveAttribute("src", /.+/);
  }
  await card(page).locator("[data-cover-open]").click();
  await expect(page.locator(".cover-viewer")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.locator("audio").evaluateAll(items => items.find(a => !a.paused).currentTime)).toBeGreaterThan(before);
});

test("reduced motion suppresses autoplay; phone and list keep a usable modal button", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await card(page).hover();
  await page.waitForTimeout(2300);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-viewer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page.locator(".song-video-viewer").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Close video", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-viewer")).toBeVisible();
  await expect.poll(() => page.locator(".song-video-viewer video").evaluate(v => v.currentTime > 0)).toBe(true);
  await page.screenshot({ path: "test-results/song-video-phone.png" });
});
