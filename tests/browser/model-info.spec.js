import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const studies = catalog.songs.filter((song) => song.id.endsWith("tony-v7-study"));

test("model comparison lives with the request selector while generated songs keep distinct badges", async ({ page }) => {
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: {
    songs: studies,
    nextVoteAt: null,
  } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: {
    inStudio: [],
    queued: [],
    recent: [],
    queuedTotal: 0,
    page: 0,
    pageSize: 50,
  } }));
  await page.goto("/?q=Tony%20V7%20Study");
  await expect(page.locator("[data-model-info]")).toHaveCount(0);
  await expect(page.locator(".voice-model-badge.v7")).toHaveCount(3);

  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page.getByLabel("Your prompt").fill("An original Tony song about a key left under the porch.");
  await page.getByRole("button", { name: "Find the direction" }).click();
  const trigger = page.getByRole("button", { name: "Compare voices ⓘ", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Tony V6, V7 and V8" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("without saved-favorite weighting");
  await expect(dialog).toContainText("better Tony likeness or musical quality has not been established");
  await expect(dialog).toContainText("V7 remains the default");
  await expect(page.getByRole("heading", { name: "Tony V6, V7 and V8" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.closest("dialog")?.id)).toBe("model-comparison");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close comparison" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Close comparison" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/model-comparison-mobile.png" });
});
