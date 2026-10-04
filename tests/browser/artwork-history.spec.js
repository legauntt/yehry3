import { test, expect } from "@playwright/test";
import artwork from "../../assets/artwork-catalog.js";
import { artworkVersions } from "../../assets/artwork-versions.js";

for (const width of [1440, 390]) test(`saved cover history works at ${width}px`, async ({ page }) => {
  const id = "distonyc-06d2b8c3c8dffed19df347bb";
  const songs = [{ id, title: "It Was Simple, Not Easy", collection: "distonyc", url: "/fixture.mp3", duration: 60, feedback: {} }];
  await page.route("**/yehry3/{catalog,songs/summary,songs/first-page}", route => route.fulfill({ json: { songs, total: 1, pageSize: 25, nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/");
  const trigger = page.locator(`[data-cover-open="${id}"]`);
  await trigger.click();
  const dialog = page.locator(".cover-viewer");
  await expect(dialog).toBeVisible();
  const versions = artworkVersions(artwork[id]);
  await expect(dialog.locator("[data-cover-version]")).toHaveCount(versions.length);
  await expect(dialog.locator("[data-cover-version]")).toHaveText(versions.map(version => version.label));
  const current = dialog.locator(".is-current-version");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(versions.at(-1).label);
  for (let index = versions.length - 1; index >= 0; index--) {
    await dialog.locator(`[data-cover-version="${index}"]`).click();
    await expect(dialog.locator("img")).toHaveAttribute("src", versions[index].src);
    await expect(dialog.locator("[data-cover-original]")).toHaveAttribute("href", versions[index].src);
    await expect(dialog.locator(`[data-cover-version="${index}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(current).toHaveText(versions.at(-1).label);
    await expect.poll(() => dialog.locator("img").evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  }
  await dialog.locator("[data-cover-zoom]").click();
  await expect(dialog).toHaveClass(/is-zoomed/);
  await dialog.locator(`[data-cover-version="${versions.length - 1}"]`).click();
  await expect(dialog).not.toHaveClass(/is-zoomed/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(dialog.locator("img")).toHaveAttribute("src", artwork[id].src);
});
