import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const id = "distonyc-5ae363b12d01b017f8d295f3";
const reviewMaster = process.env.YEHRY3_VIDEO_REVIEW_FILE;
const fixture = await readFile(reviewMaster || new URL("./fixtures/music-video.mp4", import.meta.url));
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
    const start = Number(match[1]), end = Math.min(Number(match[2] || fixture.length - 1), fixture.length - 1);
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
    await expect(dialog.locator("[data-video-description]")).toHaveText("4:45 music video · Sing along");
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
