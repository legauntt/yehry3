import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// The dev server sends no headers; production refuses inline styles, so the page is served here under the real policy.
const hosting = JSON.parse(await readFile(new URL("../../staticwebapp.config.json", import.meta.url), "utf8"));
const policy = hosting.globalHeaders["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3000 http://localhost:3000");

// Local noon on each day, so the hour offsets never cross midnight whenever the spec runs.
const iso = (daysAgo, hours = 0) => { const d = new Date(); d.setHours(12 - hours, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d.toISOString(); };
const songs = [
  { id: "a1", title: "Oldest", publishedAt: iso(9), duration: 200, musicBackend: "eleven_music" },
  { id: "b1", title: "Busy one", publishedAt: iso(4), duration: 240, musicBackend: "local" },
  { id: "b2", title: "Busy two", publishedAt: iso(4, 0.5), duration: 180, musicBackend: "local" },
  { id: "b3", title: "Busy three with a title long enough to have to truncate on a narrow phone screen", publishedAt: iso(4, 1), duration: 150 },
  { id: "c1", title: "Recent", publishedAt: iso(3), duration: 210, musicBackend: "eleven_music" },
];

async function mock(page) {
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/timeline/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
}

test("release days, folded quiet days, the calendar strip and sized records", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mock(page);
  await page.goto("/timeline/");
  await expect(page.locator(".tl-stat strong").first()).toHaveText("5");
  await expect(page.locator(".tl-day")).toHaveCount(3);
  await expect(page.locator(".tl-gap")).toHaveText([/3 quiet days/, /4 quiet days/]);
  await expect(page.locator(".tl-day").nth(1)).toContainText("busiest");
  await expect(page.locator(".tl-day").last().locator(".tl-badge")).toHaveText("The first one");
  await expect(page.locator(".tl-day").first().locator(".tl-title")).toHaveAttribute("href", "/#c1");
  await expect(page.locator(".tl-day").nth(1).locator(".song-cost.free")).toHaveCount(2);
  await expect(page.locator(".tl-day").first().locator(".song-cost")).toHaveText("53 ¢");
  await expect(page.locator("a.tl-cell")).toHaveCount(3);
  await expect(page.locator('a.tl-cell[data-level="4"]')).toHaveCount(1);
  // Record sizes arrive through CSSOM, which the policy allows: the busiest day's record is the biggest.
  const discs = await page.locator(".tl-disc").evaluateAll((all) => all.map((disc) => Math.round(disc.getBoundingClientRect().width)));
  expect(discs[1]).toBeGreaterThan(discs[0]);
  expect(discs[1]).toBe(Math.round(38 * 1.3));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Nothing spills out of a day card, and every title keeps some room.
    expect(await page.locator(".tl-day-card").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth))).toBe(true);
    expect(Math.min(...await page.locator(".tl-title").evaluateAll((all) => all.map((title) => title.getBoundingClientRect().width)))).toBeGreaterThan(40);
  }
  await page.screenshot({ path: "artifacts/timeline/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: "artifacts/timeline/desktop.png", fullPage: true });
});

test("release days rise into view as they scroll in", async ({ page }) => {
  await mock(page);
  await page.goto("/timeline/");
  await expect(page.locator(".tl-day").first()).toHaveClass(/tl-in/);
  await page.locator(".tl-day").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".tl-day").last()).toHaveClass(/tl-in/);
});

test("the shell swaps into Timeline from the collection footer without reloading", async ({ page }) => {
  await mock(page);
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/");
  await page.evaluate(() => { window.sameDocument = true; });
  await page.locator(".site-footer").getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/\/timeline\/$/);
  await expect(page.locator(".tl-day")).toHaveCount(3);
  expect(await page.evaluate(() => window.sameDocument)).toBe(true);
});
