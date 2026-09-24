import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// The dev server sends no headers; production refuses inline styles, so the page is served here under the real policy.
const hosting = JSON.parse(await readFile(new URL("../../staticwebapp.config.json", import.meta.url), "utf8"));
const policy = hosting.globalHeaders["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3000 http://localhost:3000");

// Local noon on each day, so the hour offsets never cross midnight whenever the spec runs.
const iso = (daysAgo, hours = 0) => { const d = new Date(); d.setHours(12 - hours, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return d.toISOString(); };
// A second of silence, so the play buttons have something real to play.
function silence() {
  const rate = 8000, samples = rate, data = Buffer.alloc(44 + samples);
  data.write("RIFF", 0); data.writeUInt32LE(36 + samples, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate, 28); data.writeUInt16LE(1, 32); data.writeUInt16LE(8, 34); data.write("data", 36); data.writeUInt32LE(samples, 40);
  data.fill(128, 44);
  return data;
}
const songs = [
  { id: "a1", url: "http://127.0.0.1:8080/audio/a1.wav", title: "Oldest", publishedAt: iso(9), duration: 200, musicBackend: "eleven_music" },
  { id: "b1", url: "http://127.0.0.1:8080/audio/b1.wav", title: "Busy one", publishedAt: iso(4), duration: 240, musicBackend: "local" },
  { id: "b2", url: "http://127.0.0.1:8080/audio/b2.wav", title: "Busy two", publishedAt: iso(4, 0.5), duration: 180, musicBackend: "local" },
  { id: "b3", url: "http://127.0.0.1:8080/audio/b3.wav", title: "Busy three with a title long enough to have to truncate on a narrow phone screen", publishedAt: iso(4, 1), duration: 150 },
  { id: "c1", url: "http://127.0.0.1:8080/audio/c1.wav", title: "Recent", publishedAt: iso(3), duration: 210, musicBackend: "eleven_music" },
];

async function mock(page) {
  await page.route("**/audio/*.wav", (route) => route.fulfill({ body: silence(), contentType: "audio/wav" }));
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
  // Spend rolls up per day, per week and overall, in dollars; a day of local songs is all free.
  await expect(page.locator(".tl-day").first().locator(".tl-spend")).toHaveText("$0.53 spent");
  await expect(page.locator(".tl-day").nth(1).locator(".tl-spend")).toHaveText("all free");
  await expect(page.locator(".tl-stat").nth(4)).toContainText("$1.03");
  await expect(page.locator(".tl-stat").nth(4)).toContainText("3 free songs");
  const weeks = await page.locator(".tl-week-sum").allTextContents();
  expect(weeks.length).toBeGreaterThan(0);
  expect(weeks.reduce((sum, text) => sum + Number(text.match(/(\d+) songs?/)[1]), 0)).toBe(5);
  expect(weeks.join(" ")).toContain("$");
  await expect(page.locator(".tl-list > li").first()).toHaveClass("tl-week");
  await expect(page.locator("a.tl-cell")).toHaveCount(3);
  await expect(page.locator('a.tl-cell[data-level="4"]')).toHaveCount(1);
  // Record sizes arrive through CSSOM, which the policy allows: the busiest day's record is the biggest.
  const discs = await page.locator(".tl-disc").evaluateAll((all) => all.map((disc) => Math.round(disc.getBoundingClientRect().width)));
  expect(discs[1]).toBeGreaterThan(discs[0]);
  expect(discs[1]).toBe(Math.round(38 * 1.3));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    // The calendar's tooltip stays whole and on screen, even at the strip's right edge.
    await page.locator("a.tl-cell").last().hover();
    await expect(page.locator(".tl-tip")).toBeVisible();
    await expect(page.locator(".tl-tip")).toHaveText(/: 1 song$/);
    const tip = await page.locator(".tl-tip").boundingBox();
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(width);
    await page.mouse.move(0, 0);
    await expect(page.locator(".tl-tip")).toBeHidden();
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
  await page.setViewportSize({ width: 1280, height: 1200 });
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

test("each song has a play button that drives the site player down the page", async ({ page }) => {
  await mock(page);
  await page.goto("/timeline/");
  await expect(page.locator(".tl-play")).toHaveCount(5);
  const first = page.locator(".tl-play").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-label", "Pause Recent");
  await expect(page.locator(".tl-song.tl-now .tl-title")).toHaveText("Recent");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  // The queue follows the page: after the newest song comes the busiest day's newest.
  await page.locator(".tl-play").nth(1).click();
  await expect(page.locator(".tl-song.tl-now .tl-title")).toHaveText("Busy one");
  expect(await page.locator(".tl-play").evaluateAll((all) => all.filter((b) => b.dataset.playing === "true").length)).toBe(1);
});
