import { test, expect } from "@playwright/test";

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const songs = [
  { id: "p1", title: "Paid one", publishedAt: iso(9), duration: 200, musicBackend: "eleven_music" },
  { id: "p2", title: "Paid two", publishedAt: iso(2), duration: 240, musicBackend: "eleven_music" },
  { id: "f1", title: "Free one", publishedAt: iso(2), duration: 180, musicBackend: "local" },
  { id: "o1", title: "Old one", publishedAt: iso(12), duration: 150 },
];
const budget = {
  enabled: true, capCents: 20000, reservedCents: 6500, remainingCents: 13500,
  provider: { creditsRemaining: 110000, creditLimit: 200000, remainingCents: 2000, availableCents: 1850, tier: "creator",
    resetAt: iso(-10), observedAt: iso(0.02), fresh: true, estimatedCentsPerMinute: 15 },
};

async function mock(page) {
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/music-backends", (route) => route.fulfill({ json: budget }));
}

test("totals, day/week charts, ledger and the signed-out budget prompt", async ({ page }) => {
  await mock(page);
  await page.goto("/audtism/");
  await expect(page.locator(".audit-tile strong")).toHaveText(["4", "13 min", "$1.10", "55 ¢"]);
  await expect(page.locator("#audit-budget")).toContainText("Sign in on Make a request");
  await expect(page.locator("#audit-songs .audit-col")).toHaveCount(13);
  await expect(page.locator("#audit-songs .audit-peak")).toHaveText("2");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  const weeks = await page.locator("#audit-songs .audit-col").count();
  expect(weeks).toBeGreaterThanOrEqual(2);
  expect(weeks).toBeLessThanOrEqual(3);
  await expect(page.locator("#audit-table tbody tr").first().locator("th")).toContainText("Week of");
  await page.reload();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".audit-table-wrap").evaluate((wrap) => wrap.scrollWidth <= wrap.clientWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await page.locator("#audit-songs .audit-col").last().focus();
  await page.screenshot({ path: "artifacts/audtism/mobile.png", fullPage: true });
});

test("signed-in submitters see the credits and the cap", async ({ page }) => {
  await mock(page);
  await page.addInitScript(() => localStorage.setItem("yehry3:auth:submitter", JSON.stringify({ token: "test-token", password: "pw" })));
  await page.goto("/audtism/");
  await expect(page.locator("#audit-budget")).toContainText("110,000 of 200,000 left");
  await expect(page.locator("#audit-budget")).toContainText("$18.50 of generation");
  await expect(page.locator("#audit-budget")).toContainText("$135.00 of $200.00 left");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: "artifacts/audtism/desktop.png", fullPage: true });
});

test("the shell swaps into Aud'tism from the collection footer without reloading", async ({ page }) => {
  await mock(page);
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/");
  await page.evaluate(() => { window.sameDocument = true; });
  await page.locator(".site-footer").getByRole("link", { name: "Aud'tism" }).click();
  await expect(page).toHaveURL(/\/audtism\/$/);
  await expect(page.locator(".audit-tile strong").first()).toHaveText("4");
  expect(await page.evaluate(() => window.sameDocument)).toBe(true);
});
