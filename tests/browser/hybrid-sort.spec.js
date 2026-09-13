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
  await page.route("**/yehry3/songs", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [{ id: "recent-queue", publishedAt: new Date(now - 30 * 60 * 1000).toISOString() }],
  } }));

  await page.goto("/");
  await expect(page.getByLabel("Sort songs")).toHaveValue("hybrid");
  await expect(page.locator(".track h3")).toHaveText([
    "Fresh from queue", "Fresh from song order", "Old high", "Old middle", "Old low",
  ]);
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);

  await page.getByLabel("Sort songs").selectOption("catalog");
  await expect(page.locator(".track h3")).toHaveText([
    "Old low", "Fresh from song order", "Old high", "Fresh from queue", "Old middle",
  ]);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("catalog");
});
