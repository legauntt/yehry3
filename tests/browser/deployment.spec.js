import { test, expect } from "@playwright/test";

// `code` is the published code version; a page's own is in its yehry3-code meta tag.
async function published(page, updatedAt, code = "0000000000000000") {
  await page.route("**/deployment.json*", route =>
    updatedAt === null
      ? route.fulfill({ status: 500, json: {} })
      : route.fulfill({ json: { updatedAt, updatedLabel: "Test build", code } }));
}

const laterThanThisBuild = () => new Date(Date.now() + 3600000).toISOString();
const thisCode = page => page.locator('meta[name="yehry3-code"]').getAttribute("content");

test("a newer build offers a refresh without taking one", async ({ page }) => {
  await published(page, laterThanThisBuild(), "aaaaaaaaaaaaaaaa");
  await page.goto("/queue/");
  const refresh = page.getByRole("button", { name: "Update available ↻" });
  await expect(refresh).toBeVisible();
  await expect(page.locator(".update-banner")).toContainText("A newer version of yehry3 is ready");
  expect(await page.evaluate(() => document.body.dataset.updateAvailable)).toBe("true");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Keep this version for now" }).click();
  await expect(page.locator(".update-banner")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.updateAvailable)).toBe(undefined);
  // "Not now" silences that code version only, however many builds ship it.
  await published(page, new Date(Date.now() + 5400000).toISOString(), "aaaaaaaaaaaaaaaa");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await published(page, new Date(Date.now() + 7200000).toISOString(), "bbbbbbbbbbbbbbbb");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".update-banner")).toBeVisible();
});

test("a newer build with the same code stays quiet (song, lyric and clip publications)", async ({ page }) => {
  await published(page, null);
  await page.goto("/");
  const code = await thisCode(page);
  expect(code).toMatch(/^[0-9a-f]{16}$/);
  await published(page, laterThanThisBuild(), code);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  // A record from before code versions existed cannot tell code from data either.
  await published(page, new Date(Date.now() + 7200000).toISOString(), "");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
});

test("the current build and an unreachable record leave the page alone", async ({ page }) => {
  await published(page, null);
  await page.goto("/");
  await expect(page.locator(".update-banner")).toHaveCount(0);
  const stamp = await page.locator(".deployment-stamp time").getAttribute("datetime");
  await published(page, stamp, "cccccccccccccccc");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  // An older edge copy of the record must not read as an update, even with different code.
  await published(page, new Date(Date.parse(stamp) - 60000).toISOString(), "cccccccccccccccc");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
});

test("a tab that has been open through a code deployment notices when it returns", async ({ page }) => {
  await published(page, null);
  await page.goto("/");
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await published(page, laterThanThisBuild(), "dddddddddddddddd");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".update-banner")).toBeVisible();
  await expect(page.locator("#tracks")).toBeVisible(); // The collection keeps working meanwhile.
});
