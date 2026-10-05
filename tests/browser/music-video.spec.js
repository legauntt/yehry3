import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const id = "distonyc-5ae363b12d01b017f8d295f3";
const reviewMaster = process.env.YEHRY3_VIDEO_REVIEW_FILE;
const fixture = await readFile(reviewMaster || new URL("./fixtures/music-video.mp4", import.meta.url));
for (const width of [1440, 390]) {
  test(`shared videos wait for Play and preserve versions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.copiedVideo = value; } } });
    });
    await page.goto(`/#${id}`);
    await page.locator(`[data-video-open="${id}"]`).click();
    const dialog = page.locator(".song-video-viewer");
    const latest = await dialog.locator('[aria-pressed="true"]').textContent();
    await dialog.getByRole("button", { name: "Share video", exact: true }).click();
    await expect(dialog.getByText("Video link copied.")).toBeVisible();
    const link = await page.evaluate(() => window.copiedVideo);
    expect(new URL(link).searchParams.get("video")).toBe(latest);
    await page.goto(link);
    await expect(dialog).toBeVisible();
    const video = dialog.locator("video");
    await expect(dialog.locator('[aria-pressed="true"]')).toHaveText(latest);
    await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.paused && !v.loop)).toBe(true);
    await dialog.getByRole("button", { name: "Play video with sound", exact: true }).click();
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
    await video.evaluate(v => { v.currentTime = 6; });
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(6);
    await dialog.getByRole("button", { name: "Version A", exact: true }).click();
    await dialog.getByRole("button", { name: "Share video", exact: true }).click();
    await page.goto(await page.evaluate(() => window.copiedVideo));
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-pressed="true"]')).toHaveText("A");
    await expect.poll(() => video.evaluate(v => v.paused && v.muted && v.loop)).toBe(true);
    await dialog.getByRole("button", { name: "Play video", exact: true }).click();
    await expect.poll(() => video.evaluate(v => !v.paused)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/video-share-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(new URL(page.url()).searchParams.has("video")).toBe(false);
  });
}
test("video sharing offers a selectable link when clipboard is unavailable", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined }));
  await page.goto(`/?video=A#${id}`);
  const dialog = page.locator(".song-video-viewer");
  await dialog.getByRole("button", { name: "Share video", exact: true }).click();
  const link = dialog.getByRole("textbox", { name: "Video share link" });
  await expect(link).toBeVisible();
  expect(new URL(await link.inputValue()).searchParams.get("video")).toBe("A");
  await expect(link).toBeFocused();
});
test("touch devices open the native share sheet", async ({ page }) => {
  await page.addInitScript(() => {
    const media = window.matchMedia.bind(window);
    window.matchMedia = query => query === "(pointer: coarse)" ? { matches: true } : media(query);
    Object.defineProperty(navigator, "share", { value: async data => { window.sharedVideo = data; } });
  });
  await page.goto(`/?video=A#${id}`);
  await page.getByRole("button", { name: "Share video", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.sharedVideo?.title)).toBe("The Golden Answer");
  expect(new URL(await page.evaluate(() => window.sharedVideo.url)).searchParams.get("video")).toBe("A");
});
test.beforeEach(async ({ page }) => {
  const songs = [{ id, title: "The Golden Answer", collection: "distonyc", url: "/fixture.webm", duration: 284.8, votes: 1, feedback: {} }];
  await page.route("**/yehry3/{catalog,songs/summary}", r => r.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", r => r.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", r => r.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/assets/song-videos.js*", r => r.fulfill({ contentType: "text/javascript", body: `export default {"${id}": {src: "/fixture.webm", duration: 284.8, framing: "landscape", hasAudio: true, fullLength: true}};` }));
  const media = r => {
    const range = r.request().headers().range;
    const match = range?.match(/bytes=(\d+)-(\d*)/);
    if (!match) return r.fulfill({ contentType: "video/mp4", body: fixture, headers: { "Accept-Ranges": "bytes" } });
    const start = Number(match[1]), end = Math.min(Number(match[2] || fixture.length - 1), fixture.length - 1, start + 2 * 1024 * 1024 - 1);
    return r.fulfill({ status: 206, contentType: "video/mp4", body: fixture.subarray(start, end + 1), headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${fixture.length}` } });
  };
  await page.route("**/fixture.webm", media);
  await page.route(/\/assets\/song-videos\/.+\.mp4/, media);
});

for (const width of [1440, 390]) {
  test(`music video has sound, seeks, preserves versions and fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const row = page.locator(`[data-id="${id}"]`);
    const trigger = row.getByRole("button", { name: "Watch music video with audio for The Golden Answer", exact: true });
    await expect(trigger).toHaveClass(/song-video-button-gold/);
    await expect(trigger.locator(".song-video-sparkle")).toBeVisible();
    await row.screenshot({ path: `test-results/music-video-card-${width}.png` });
    await row.locator("[data-play]").click();
    await expect.poll(() => page.locator("#audio").evaluate(a => !a.paused)).toBe(true);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "The Golden Answer", exact: true });
    const video = dialog.locator("video");
    await expect(dialog.locator("[data-video-description]")).toHaveText("4:44 music video · Sing along");
    await expect.poll(() => video.evaluate(v => !v.paused && !v.muted && !v.loop && v.currentTime > 0)).toBe(true);
    await expect.poll(() => page.locator("#audio").evaluate(a => a.paused)).toBe(true);
    await video.evaluate(v => { v.currentTime = 6; });
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThanOrEqual(6);
    if (reviewMaster) {
      expect(await video.evaluate(v => v.duration)).toBeCloseTo(284.8, 1);
      await expect.poll(() => video.evaluate(v => v.webkitAudioDecodedByteCount > 0)).toBe(true);
      for (const time of [34, 89, 260, 280, 90.5]) {
        await video.evaluate((v, t) => { v.currentTime = t; }, time);
        await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 3 && !v.paused)).toBe(true);
      }
    }
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: `test-results/music-video-${width}.png` });
    await dialog.getByRole("button", { name: "Version A", exact: true }).click();
    await expect.poll(() => video.evaluate(v => !v.paused && v.muted && v.loop)).toBe(true);
    await page.locator("#audio").evaluate(a => a.play());
    await video.evaluate(v => { v.muted = false; });
    await expect.poll(() => page.locator("#audio").evaluate(a => !a.paused)).toBe(true);
    await dialog.getByRole("button", { name: /\(latest\)/ }).click();
    await expect.poll(() => video.evaluate(v => !v.paused && !v.muted && !v.loop)).toBe(true);
    await page.locator("#audio").evaluate(a => a.play());
    await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
    await video.evaluate(v => v.play());
    await expect.poll(() => page.locator("#audio").evaluate(a => a.paused)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".song-video-viewer video")).not.toHaveAttribute("src", /.+/);
    await expect(trigger).toBeFocused();
  });
}
