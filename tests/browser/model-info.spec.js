import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const studies = catalog.songs.filter((song) => song.id.endsWith("tony-v7-study"));

test("model comparison is keyboard accessible, keeps playback running and remains available when issue notices are hidden", async ({ page }) => {
  await page.route("**/yehry3/songs", (route) => route.fulfill({ json: {
    songs: studies.map((song) => ({ ...song, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3" })), nextVoteAt: null,
  } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: { inStudio: [], queued: [], recent: [], queuedTotal: 0, page: 0, pageSize: 50 } }));
  await page.addInitScript(() => localStorage.setItem("yehry3:show-quality-issues", "false"));
  await page.goto("/?q=Tony%20V7%20Study");
  await expect(page.locator("[data-model-info]")).toHaveCount(3);
  await expect(page.locator(".quality-notice:visible")).toHaveCount(0);
  await page.getByRole("button", { name: `Play ${studies[0].title}`, exact: true }).click();
  const audio = page.locator("#audio");
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(0.1);
  const trigger = page.locator("[data-model-info]").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Tony V6 vs Tony V7" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("without saved-favorite weighting");
  await expect(dialog).toContainText("not proof of better Tony likeness");
  await expect(dialog).toContainText("V6 remains the production default");
  await expect(page.getByRole("button", { name: "Close comparison" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.closest("dialog")?.id)).toBe("model-comparison");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close comparison" })).toBeFocused();
  const current = await audio.evaluate((element) => element.currentTime);
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(current + 0.1);
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
  await page.keyboard.press("Escape");
  await page.goto(`/lyrics/?song=${studies[0].id}`);
  await page.getByRole("button", { name: "V6 vs V7 ⓘ", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tony V6 vs Tony V7" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "V6 vs V7 ⓘ", exact: true })).toBeFocused();
});
