import { test, expect } from "@playwright/test";
import remaining from "./fixtures/song-video-remaining.json" with { type: "json" };

test("remaining nonarchived videos play across catalog pages", async ({ page }) => {
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Requires published media and the real public catalog");
  test.setTimeout(600000);
  const expected = new Map(remaining.map(s => [s.id, s]));
  const seen = new Set();
  await page.goto("/");
  await expect(page.locator("#tracks .track").first()).toBeVisible();
  for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
    const ids = await page.locator("#tracks .track[data-id]").evaluateAll(rows => rows.map(row => row.dataset.id));
    for (const id of ids.filter(id => expected.has(id))) {
      const trigger = page.locator(`[data-video-open="${id}"]`);
      await expect(trigger).toBeVisible();
      await trigger.click();
      const video = page.locator(".song-video-viewer video");
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted), { timeout: 30000, message: `Playback starts for ${expected.get(id).title}` }).toBe(true);
      expect(await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration])).toEqual([576, 1024, 15]);
      await page.keyboard.press("Escape");
      await expect(video).not.toHaveAttribute("src", /.+/);
      seen.add(id);
    }
    console.log(`Verified ${seen.size}/${expected.size} new videos after catalog page ${pageNumber}`);
    const next = page.getByRole("button", { name: "Next page", exact: true }).first();
    if (!(await next.isVisible()) || await next.isDisabled()) break;
    await next.click();
    await expect.poll(() => page.locator("#tracks .track[data-id]").first().getAttribute("data-id")).not.toBe(ids[0]);
    await expect(page.locator(".song-video-preview")).toHaveCount(0);
  }
  expect([...seen].sort()).toEqual([...expected.keys()].sort());
});

test("remaining video hover survives catalog filtering", async ({ page }) => {
  test.skip(!process.env.YEHRY3_VIDEO_URL, "Requires published media and the real public catalog");
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("searchbox", { name: "Search songs" }).fill(remaining.at(-1).title);
  await page.locator(".catalog-filters > summary").click();
  const card = page.locator(`[data-id="${remaining.at(-1).id}"]`);
  await expect(card).toBeVisible();
  await card.evaluate(el => el.scrollIntoView({ block: "center" }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await card.locator(".track-video-art").hover({ timeout: 10000 });
  const preview = card.locator(".song-video-preview");
  await expect(preview).toBeVisible({ timeout: 12000 });
  await expect.poll(() => preview.evaluate(v => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
  await page.screenshot({ path: "test-results/song-videos-remaining-live.png" });
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("searchbox", { name: "Search songs" }).fill("no-matching-song-video");
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
});
