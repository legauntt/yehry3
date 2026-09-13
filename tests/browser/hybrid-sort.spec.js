import { test, expect } from "@playwright/test";

test("fresh releases lead the default sort before older songs ranked by votes", async ({ page }) => {
  const now = Date.parse("2026-09-12T19:00:00Z");
  await page.clock.install({ time: new Date(now) });
  const song = (id, title, votes, order = 0) => ({
    id, title, votes, order, duration: 60, url: "/fixture.mp3", collection: "distonyc",
  });
  const songs = [
    song("old-low", "Old low", 2, 1),
    song("fresh-order", "Fresh from song order", 0, -(now - 2 * 60 * 60 * 1000)),
    song("old-high", "Old high", 40, 2),
    song("recent-queue", "Fresh from queue", 1, 3),
    song("old-middle", "Old middle", 12, -(now - 25 * 60 * 60 * 1000)),
  ];
  songs[0].publishedAt = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  await page.route("**/yehry3/songs", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [{ id: "recent-queue", publishedAt: new Date(now - 30 * 60 * 1000).toISOString() }],
  } }));

  await page.goto("/");
  await expect(page.getByLabel("Sort songs")).toHaveValue("hybrid");
  await expect(page.locator(".track h3")).toHaveText([
    "Fresh from queue", "Fresh from song order", "Old high", "Old middle", "Old low",
  ]);
  await expect(page.locator('[data-id="recent-queue"] .track-age')).toHaveText("30 minutes old");
  await expect(page.locator('[data-id="fresh-order"] .track-age')).toHaveText("2 hours old");
  await expect(page.locator('[data-id="old-middle"] .track-age')).toHaveText("1 day old");
  await expect(page.locator('[data-id="old-low"] .track-age')).toHaveText("3 days old");
  const unknownAge = page.locator('[data-id="old-high"] .track-age');
  await expect(unknownAge).toHaveText(/^\d+ hours old$/);
  const unknownAgeText = await unknownAge.textContent();
  expect(Number.parseInt(unknownAgeText, 10)).toBeGreaterThanOrEqual(24);
  expect(Number.parseInt(unknownAgeText, 10)).toBeLessThanOrEqual(72);
  await expect(unknownAge).toHaveAttribute("title", "Exact release time unavailable");
  await expect(page.locator('[data-id="recent-queue"] .track-age')).toHaveAttribute(
    "title",
    /Released Sep 12, 11:30 AM/,
  );
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-id="recent-queue"] .track-age')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByLabel("Sort songs").selectOption("catalog");
  await expect(page.locator(".track h3")).toHaveText([
    "Old low", "Fresh from song order", "Old high", "Fresh from queue", "Old middle",
  ]);
  await expect(unknownAge).toHaveText(unknownAgeText);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("catalog");
});
