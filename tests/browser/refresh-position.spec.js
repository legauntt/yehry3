import { test, expect } from "@playwright/test";

for (const position of ["top", "introduction"]) {
test(`catalog hydration keeps the ${position} in view when a visible song moves down`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  const songs = Array.from({ length: 25 }, (_, index) => ({
    id: `song-${index}`, title: `Song ${index}`, duration: 60,
    url: "/fixture.mp3", collection: "tonyai", votes: 0,
    publishedAt: "2026-01-01T00:00:00Z",
  }));
  let releaseCatalog;
  const ready = new Promise((resolve) => { releaseCatalog = resolve; });
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/first-page", route => route.fulfill({ json: { songs, total: songs.length, pageSize: 25, nextVoteAt: null } }));
  await page.route("**/yehry3/songs/summary", async (route) => {
    await ready;
    await route.fulfill({ json: { songs: songs.map((song, index) => ({ ...song, votes: index })), nextVoteAt: null } });
  });
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));

  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(24);
  await expect(page.locator(".track").first()).toHaveAttribute("data-id", "song-0");
  // The first song is only peeking into the viewport beneath the introduction.
  if (position === "introduction") {
    await page.evaluate(() => window.scrollTo(0, 200));
    await page.reload();
    await expect(page.locator(".track")).toHaveCount(24);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(200);
  }
  const before = await page.evaluate(() => scrollY);
  expect(await page.locator(".track").first().evaluate((row) => row.getBoundingClientRect().top)).toBeGreaterThan(0);
  releaseCatalog();
  await expect(page.locator(".track").first()).toHaveAttribute("data-id", "song-24");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
});
}
