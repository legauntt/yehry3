import { test, expect } from "@playwright/test";
import { mockCatalogState } from "./helpers/catalog.js";

const songs = ["Scythe", "Csaw", "Pancakeo", "Scythecrow", ""].map((authoredBy, order) => ({
  id: `author-${order}`, title: `Song ${order}`, authoredBy, order,
  duration: 60, collection: "distonyc", url: "/fixture.mp3", votes: 0,
}));
async function open(page, name = "Scythe (2)", url = "/?author=me") {
  await page.addInitScript(name => localStorage.setItem("yehry3:authored-by", name), name);
  await mockCatalogState(page, () => songs);
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.goto(url);
}

test("my authorship ignores room numbers, survives reload and follows name changes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".track h3")).toHaveText(["Song 0", "Song 1"]);
  await expect(page.locator("#active-filters")).toContainText("Authored by me");
  await page.reload();
  await expect(page.locator(".track h3")).toHaveText(["Song 0", "Song 1"]);
  await page.evaluate(async () => (await import("/assets/authored-by.js")).rememberAuthor("Pancakeo (3)"));
  await expect(page.locator(".track h3")).toHaveText(["Song 2"]);
  await page.evaluate(() => {
    localStorage.setItem("yehry3:authored-by", "scythe (10)");
    window.dispatchEvent(new StorageEvent("storage", { key: "yehry3:authored-by", storageArea: localStorage }));
  });
  await expect(page.locator(".track h3")).toHaveText(["Song 0", "Song 1"]);
  await page.locator(".catalog-filters > summary").click();
  await page.getByLabel("Author", { exact: true }).selectOption("all");
  await expect(page.locator(".track h3")).toHaveCount(5);
  expect(new URL(page.url()).searchParams.has("author")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.locator(".track h3")).toHaveText(["Song 0", "Song 1"]);
});

test("an unset name does not match anonymous songs", async ({ page }) => {
  await open(page, "");
  await expect(page.locator("#track-count")).toContainText("0 songs");
  await expect(page.locator(".track h3")).toHaveCount(0);
});
