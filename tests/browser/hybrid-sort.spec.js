import { test, expect } from "@playwright/test";

const song = (id, title, votes, order = 0) => ({
  id, title, votes, order, duration: 60, url: "/fixture.mp3", collection: "distonyc",
});

test("fresh releases lead the default sort before older songs ranked by votes", async ({ page }) => {
  const now = Date.parse("2026-09-12T19:00:00Z");
  await page.clock.install({ time: new Date(now) });
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
  await expect(unknownAge).toHaveText(/^(24 hours|1 day|[2-3] days) old$/);
  const unknownAgeText = await unknownAge.textContent();
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

test("unknown ages increase with catalog order and stay attached after sorting", async ({ page }) => {
  const songs = [
    song("first", "Echo", 1, 1),
    song("second", "Delta", 1, 2),
    song("third", "Charlie", 1, 3),
    song("fourth", "Bravo", 1, 4),
    song("fifth", "Alpha", 1, 5),
  ];
  await page.route("**/yehry3/songs", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));

  await page.goto("/?sort=catalog");
  await expect(page.locator(".track h3")).toHaveText(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
  await expect(page.locator(".track-age")).toHaveText([
    "24 hours old", "1 day old", "2 days old", "2 days old", "3 days old",
  ]);

  await page.getByLabel("Sort songs").selectOption("title");
  await expect(page.locator(".track h3")).toHaveText(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
  await expect(page.locator(".track-age")).toHaveText([
    "3 days old", "2 days old", "2 days old", "1 day old", "24 hours old",
  ]);
});

test("older release ages use progressively larger calendar units", async ({ page }) => {
  const now = Date.parse("2026-09-12T19:00:00Z");
  await page.clock.install({ time: new Date(now) });
  const ages = [
    ["days", "Days", 3 * 24 * 60 * 60 * 1000],
    ["weeks", "Weeks", 14 * 24 * 60 * 60 * 1000],
    ["months", "Months", 90 * 24 * 60 * 60 * 1000],
    ["years", "Years", 2 * 365 * 24 * 60 * 60 * 1000],
  ];
  const songs = ages.map(([id, title, elapsed], index) => ({
    ...song(id, title, 0, index + 1),
    publishedAt: new Date(now - elapsed).toISOString(),
  }));
  await page.route("**/yehry3/songs", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));

  await page.goto("/?sort=catalog");
  await expect(page.locator(".track-age")).toHaveText([
    "3 days old", "2 weeks old", "3 months old", "2 years old",
  ]);
});
