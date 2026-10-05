import { test, expect } from "@playwright/test";
import pageOneSongs from "./fixtures/song-video-page1.json" with { type: "json" };
import { videoVersions } from "../../assets/song-video-versions.js";
import videos from "../../assets/song-videos.js";

test("shared video links open the real catalog and wait for Play", async ({ page }) => {
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Post-deployment sharing check");
  test.setTimeout(120000);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async value => { window.copiedVideo = value; } },
  }));
  const id = "distonyc-5ae363b12d01b017f8d295f3";
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of [videoVersions(id).at(-1).label, "A"]) {
      await page.goto(`/?video=${label}#${id}`);
      const dialog = page.locator(".song-video-viewer");
      await expect(dialog).toBeVisible({ timeout: 30000 });
      await expect(dialog.locator('[aria-pressed="true"]')).toHaveText(label);
      const video = dialog.locator("video");
      await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.paused), { timeout: 30000 }).toBe(true);
      await expect(dialog.locator("[data-video-play]")).toBeVisible();
      await page.screenshot({ path: `test-results/video-share-live-${width}-${label}.png` });
      await dialog.getByRole("button", { name: "Share video", exact: true }).click();
      await expect(dialog.getByText("Video link copied.")).toBeVisible();
      expect(new URL(await page.evaluate(() => window.copiedVideo)).searchParams.get("video")).toBe(label);
      await dialog.locator("[data-video-play]").click();
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0), { timeout: 20000 }).toBe(true);
      await video.evaluate(v => { v.currentTime = 6; });
      await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 2 && v.currentTime >= 6), { timeout: 20000 }).toBe(true);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    }
  }
});

test("published catalog exposes and plays all page-one videos", async ({ page }) => {
  test.setTimeout(300000);
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Post-deployment check against the real catalog");
  await page.addInitScript(() => {
    window.loopSources = [];
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this); window.loopSources.push(source); return source;
    };
  });
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
    if (song.videoAudio && !videos[id]?.fullLength) {
      await page.locator(`[data-id="${id}"] [data-play]`).click();
      await expect.poll(() => page.locator("#audio").evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
    }
    await button.click();
    const video = page.locator(".song-video-viewer video");
    const current = videos[id];
    if (current.fullLength) {
      await expect(button).toHaveClass(/song-video-button-gold/);
      await expect.poll(() => video.evaluate(v => !v.paused && !v.muted && v.currentTime > 0), { timeout: 20000 }).toBe(true);
      const media = await video.evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, loop: v.loop }));
      expect(media.width).toBe(1280);
      expect(media.height).toBe(720);
      expect(media.duration).toBeCloseTo(current.duration, 1);
      expect(media.loop).toBe(false);
      await expect.poll(() => video.evaluate(v => v.webkitAudioDecodedByteCount > 0)).toBe(true);
      if (current.treatment === "two-towers") await expect(button.locator("[data-video-towers]")).toHaveCount(1);
      if (current.treatment === "plato-shower") await expect(button.locator("[data-video-plato]")).toHaveCount(1);
       if (current.treatment === "doomer-pumpkin") await expect(button.locator("[data-video-pumpkin]")).toHaveCount(1);
      if (current.treatment === "arbys") await expect(button.locator("[data-video-arbys]")).toHaveCount(1);
      for (const time of [34, 89, current.duration - 25, current.duration - 5]) {
        await video.evaluate((v, t) => { v.currentTime = t; }, time);
        await expect.poll(() => video.evaluate(v => !v.seeking && v.readyState >= 3 && !v.paused), { timeout: 20000 }).toBe(true);
      }
      await page.screenshot({ path: `test-results/${id}-music-video-live.png` });
    } else {
    if (song.videoAudio && !videos[id]?.fullLength) {
      await expect.poll(() => video.evaluate(v => v.readyState >= 1 && v.paused && !v.muted && v.currentTime === 0)).toBe(true);
      expect(await page.locator("#audio").evaluate(a => a.paused)).toBe(true);
      await page.getByRole("button", { name: "Play video with sound", exact: true }).click();
    }
    await expect.poll(() => video.evaluate((v, sound) => !v.paused && v.currentTime > 0 && v.muted === !sound, Boolean(song.videoAudio)), { timeout: 20000, message: `Live playback starts for ${id}` }).toBe(true);
    const dimensions = await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration]);
    expect(dimensions.slice(0, 2)).toEqual([song.videoWidth || 576, song.videoHeight || 1024]);
    expect(dimensions[2]).toBeCloseTo(song.videoDuration || 15, 2);
    }
    if (song.videoAudio && !videos[id]?.fullLength) {
      await expect(button).toHaveClass(/song-video-button-doomer/);
      await expect(page.locator('[data-video-description]')).toHaveText(`${song.videoDuration}-second video with chorus audio · Press Play to watch with sound`);
      await expect(page.getByLabel("Sound on", { exact: true })).toBeChecked();
      await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(1);
      await expect.poll(() => video.evaluate(v => v.currentTime > 22), { timeout: 30000 }).toBe(true);
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime < 2)).toBe(true);
      expect(await page.evaluate(() => window.loopSources.length)).toBe(1);
      expect(await page.evaluate(() => window.loopSources[0].context.state)).toBe("running");
      await page.screenshot({ path: 'test-results/morning-doomer-live.png' });
    }
    for (const choice of videoVersions(id).slice(0, -1)) {
      const button = page.getByRole("button", { name: `Version ${choice.label}`, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(video).toHaveAttribute("src", choice.src);
      if (choice.audio) await page.getByRole("button", { name: "Play video with sound", exact: true }).click();
      await expect.poll(() => video.evaluate((v, sound) => !v.paused && v.currentTime > 0 && v.muted === !sound, Boolean(choice.audio)), { timeout: 20000 }).toBe(true);
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
