import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const recording = catalog.songs.find(song => song.url.startsWith("/fearhunger/"));
const song = (id, title, extra) => ({ id, title, duration: 180, url: recording.url, votes: 0, hasLyrics: true, ...extra });
const songs = [
  song("pitch-clean", "Clean Song", { collection: "tonyai", collections: ["tonyai", "distonyc"], pitchRepair: "clean" }),
  song("pitch-haunted", "Haunted Song", { collection: "distonyc", collections: ["distonyc", "fearhunger"], pitchRepair: "haunted" }),
  song("pitch-wild", "Wild Song", { collection: "distonyc", pitchRepair: "wild" }),
  song("pitch-none", "Older Song", { collection: "tonyai" }),
];

test("rows show the pitch badge and no longer spend space on the Tony AI and Distonyc labels", async ({ page }) => {
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track")).toHaveCount(4);
  const row = (title) => page.locator(".track", { hasText: title });
  for (const [title, mode, label] of [["Clean Song", "clean", "Clean"], ["Haunted Song", "haunted", "Haunted"], ["Wild Song", "wild", "Wild"]]) {
    const badge = row(title).locator(".pitch-badge");
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveClass(new RegExp(mode));
    await expect(badge).toHaveText(label);
    await expect(badge).toHaveAttribute("title", `Tony’s pitch: ${label}`);
  }
  await expect(row("Older Song").locator(".pitch-badge")).toHaveCount(0);
  // Only the exceptional collection keeps its label; rows in just the two main collections have none.
  await expect(row("Haunted Song").locator(".track-collections")).toHaveText("Fear & Hunger");
  await expect(row("Clean Song").locator(".track-collections")).toHaveCount(0);
  await expect(row("Wild Song").locator(".track-collections")).toHaveCount(0);
  await expect(page.locator("#tracks")).not.toContainText(/Tony AI|Distonyc requests/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
