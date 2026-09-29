import { test, expect } from "@playwright/test";
import pageOneSongs from "./fixtures/song-video-page1.json" with { type: "json" };

test("published catalog exposes and plays all page-one silent videos", async ({ page }) => {
  test.setTimeout(180000);
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Post-deployment check against the real catalog");
  await page.goto("/");
  const ids = pageOneSongs.map(song => song.id);
  for (const id of ids) {
    const button = page.locator(`[data-video-open="${id}"]`);
    await expect(button).toBeVisible();
    await button.click();
    const video = page.locator(".song-video-viewer video");
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
    expect(await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration])).toEqual([576, 1024, 15]);
    await page.keyboard.press("Escape");
  }
  const card = page.locator(`[data-id="${ids[0]}"]`);
  await expect(page.locator(".song-video-viewer")).not.toBeVisible();
  await card.scrollIntoViewIfNeeded();
  // Flush the scroll event before hovering: scrolling intentionally cancels previews.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await card.hover({ position: { x: 30, y: 30 } });
  const preview = page.locator(".song-video-preview");
  await expect(preview).toBeVisible({ timeout: 12000 });
  await expect.poll(() => preview.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
  await page.screenshot({ path: "test-results/song-video-live.png" });
});
