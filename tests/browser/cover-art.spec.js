import { test, expect } from "@playwright/test";
import { openSongMenu } from "./helpers/song-menu.js";

test("video and regular covers share a height on desktop and phones", async ({ page }) => {
  const songs = [
    { id: "distonyc-ffa7b966f9f8cc1a5d4cc3a5", title: "Video cover" },
    { id: "distonyc-06d2b8c3c8dffed19df347bb", title: "Regular cover" },
  ].map(song => ({ ...song, collection: "distonyc", url: "/fixture.mp3", duration: 60, votes: 0, feedback: {} }));
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/?sort=catalog");
  const cards = page.locator("#tracks > .track");
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator(".song-video-button")).toBeVisible();
  for (const width of [1440, 1000, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const heights = await cards.locator("img.track-art").evaluateAll(images => images.map(image => image.getBoundingClientRect().height));
    expect(Math.abs(heights[0] - heights[1])).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await cards.last().locator("[data-cover-open]").click();
  await expect(page.locator(".cover-viewer")).toBeVisible();
});

test("Dashboard keeps saved covers, retires clip art and Redraw, and fits a phone", async ({ page }) => {
  const songs = [
    { id: "distonyc-06d2b8c3c8dffed19df347bb", title: "It Was Simple, Not Easy", votes: 1, pins: 1 },
    { id: "new-song-no-cover", title: "A New Song With a Long Title", votes: 0 },
  ].map(s => ({ ...s, collection: "distonyc", url: "/fixture.mp3", duration: 60, feedback: {} }));
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const row = page.locator('[data-id="distonyc-06d2b8c3c8dffed19df347bb"]');
  await expect(row.locator("img.track-art")).toHaveAttribute("src", /\/assets\/artwork\/.+\.webp/);
  await expect.poll(() => row.locator("img.track-art").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('[data-id="new-song-no-cover"] .track-art-pending')).toBeVisible();
  await expect(page.locator('#tracks img[src^="data:image/svg"]')).toHaveCount(0);
  await openSongMenu(row);
  // Pinning is now an admin action; public listeners do not see this control.
  await expect(row.locator("[data-pin]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /redraw/i })).toHaveCount(0);
  await expect(page.locator("[data-art]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
