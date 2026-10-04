import { test, expect } from "@playwright/test";
import pageOneSongs from "./fixtures/song-video-page1.json" with { type: "json" };
import { videoVersions } from "../../assets/song-video-versions.js";

test("published catalog exposes and plays all page-one videos", async ({ page }) => {
  test.setTimeout(300000);
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Post-deployment check against the real catalog");
  await page.goto("/");
  await expect(page.locator("[data-video-open]").first()).toBeVisible();
  const ids = pageOneSongs.map(song => song.id);
  // New publications can move a reviewed song onto a later catalog page.
  async function findVideo(id) {
    const button = page.locator(`[data-video-open="${id}"]`);
    if (await button.isVisible()) return button;
    const previous = page.getByRole("button", { name: "Previous page", exact: true }).first();
    for (let n = 0; n < 30 && await previous.isEnabled(); n++) await previous.click();
    const next = page.getByRole("button", { name: "Next page", exact: true }).first();
    for (let n = 0; n < 30 && !(await button.isVisible()); n++) {
      if (!(await next.isEnabled())) break;
      await next.click();
    }
    await expect(button).toBeVisible();
    return button;
  }
  for (const id of ids) {
    const song = pageOneSongs.find(s => s.id === id);
    const button = await findVideo(id);
    await expect(button).toBeVisible();
    await button.click();
    const video = page.locator(".song-video-viewer video");
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted), { timeout: 20000, message: `Live playback starts for ${id}` }).toBe(true);
    expect(await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration])).toEqual([song.videoWidth || 576, song.videoHeight || 1024, song.videoDuration || 15]);
    if (song.videoAudio) {
      await expect(button).toHaveClass(/song-video-button-doomer/);
      await expect(page.locator('[data-video-description]')).toHaveText(`${song.videoDuration}-second video with chorus audio · Unmute to listen`);
      await video.evaluate(v => { v.muted = false; });
      await expect.poll(() => video.evaluate(v => v.webkitAudioDecodedByteCount > 0)).toBe(true);
      await video.evaluate(v => { v.muted = true; });
      await page.screenshot({ path: 'test-results/morning-doomer-live.png' });
    }
    for (const choice of videoVersions(id).slice(0, -1)) {
      const button = page.getByRole("button", { name: `Version ${choice.label}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(video).toHaveAttribute("src", choice.src);
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted), { timeout: 20000 }).toBe(true);
    }
    await page.keyboard.press("Escape");
  }
  await findVideo(ids[0]);
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
