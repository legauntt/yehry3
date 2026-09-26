import { openSongMenu } from "./helpers/song-menu.js";
import { test, expect } from "@playwright/test";

test("V7 studies retain creation times, lyrics, and measured issue notices", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-13T09:00:00Z") });
  await page.route("**/yehry3/songs/summary", (route) => route.abort());
  await page.goto("/");

  const visibleTitles = await page.locator(".track h3").allTextContents();
  const v7Titles = visibleTitles.filter((title) => title.endsWith("(Tony V7 Study)"));
  expect(v7Titles).toEqual([
    "The Last Light in the Station (Tony V7 Study)",
    "Spare Key Weather (Tony V7 Study)",
    "Telephone Wire (Tony V7 Study)",
  ]);
  const lastLight = page.locator('[data-id="the-last-light-in-the-station-tony-v7-study"]');
  const telephone = page.locator('[data-id="telephone-wire-tony-v7-study"]');
  await expect(lastLight.locator(".track-age")).toHaveAttribute(
    "datetime",
    "2026-09-13T07:56:33.561Z",
  );
  await expect(telephone.locator(".track-age")).toHaveAttribute(
    "datetime",
    "2026-09-13T07:33:08.013Z",
  );
  await lastLight.locator(".quality-notice summary").click();
  await expect(lastLight.locator(".quality-notice")).toContainText(
    "27 seconds after the last detected vocal",
  );
  await telephone.locator(".quality-notice summary").click();
  await expect(telephone.locator(".quality-notice")).toContainText(
    "1.6 seconds",
  );

  await openSongMenu(page.locator('[data-id="spare-key-weather-tony-v7-study"]'));
  await page
    .getByRole("link", { name: "Lyrics for Spare Key Weather (Tony V7 Study)" })
    .click();
  await expect(page).toHaveURL(/\/lyrics\/spare-key-weather-tony-v7-study-[0-9a-f]{6}\/$/);
  await expect(page.locator("h1")).toHaveText("Spare Key Weather (Tony V7 Study)");
  await expect(page.locator("button.lyric-line")).toHaveCount(48);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    /You left a key inside a coffee tin/,
  );
});
