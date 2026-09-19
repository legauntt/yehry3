import { test, expect } from "@playwright/test";

async function published(page, updatedAt) {
  await page.route("**/deployment.json*", route =>
    updatedAt === null
      ? route.fulfill({ status: 500, json: {} })
      : route.fulfill({ json: { updatedAt, updatedLabel: "Test build" } }));
}

const laterThanThisBuild = () => new Date(Date.now() + 3600000).toISOString();

test("a newer build offers a refresh without taking one", async ({ page }) => {
  await published(page, laterThanThisBuild());
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
  // "Not now" silences that build only.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await published(page, new Date(Date.now() + 7200000).toISOString());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".update-banner")).toBeVisible();
});

test("the current build and an unreachable record leave the page alone", async ({ page }) => {
  await published(page, null);
  await page.goto("/");
  await expect(page.locator(".update-banner")).toHaveCount(0);
  const stamp = await page.locator(".deployment-stamp time").getAttribute("datetime");
  await published(page, stamp);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await published(page, new Date(Date.parse(stamp) - 60000).toISOString());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator(".update-banner")).toHaveCount(0);
});

test("a tab that has been open through a deployment notices when it returns", async ({ page }) => {
  await published(page, null);
  await page.goto("/");
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await published(page, laterThanThisBuild());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".update-banner")).toBeVisible();
  await expect(page.locator("#tracks")).toBeVisible(); // The collection keeps working meanwhile.
});
