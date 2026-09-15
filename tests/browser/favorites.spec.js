import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { lyricsHref } from "../../assets/song-links.js";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const song = catalog.songs.find((item) => item.collection === "fearhunger");
const otherSong = catalog.songs.find((item) => item.collection === "fearhunger" && item.id !== song.id);
const button = (page, item = song) => page.locator(`[data-save="${item.id}"]`);
const profileName = () => `Listener ${randomUUID().slice(0, 8)}`;
async function createProfile(page, name = profileName()) {
  await page.locator(".new-profile summary").click();
  await page.getByLabel("Profile name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create profile", exact: true }).click();
  await expect(page.locator("#profile-status")).toContainText("Synced across devices");
  return { name, id: await page.locator("#listener-profile").inputValue() };
}
async function refreshProfile(page) {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

test("favorites are shared across devices, survive navigation and keep playback continuous", async ({ page, browser }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?q=Fear%20and%20Hunger");
  await expect(button(page)).toBeVisible();
  const profile = await createProfile(page);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await button(page, otherSong).click();
  await expect(page.locator("#saved-only")).toHaveText("Saved songs (2)");
  await page.locator("#saved-only").click();
  await expect(page.locator("#tracks > .track")).toHaveCount(2);
  await expect(page.locator("#pending-tracks")).toBeHidden();
  await page.locator(`#tracks [data-play="${song.id}"]`).click();
  await expect.poll(() => page.locator("#audio").evaluate((audio) => audio.readyState)).toBeGreaterThan(0);
  await page.locator("#audio").evaluate(async (audio) => { audio.currentTime = 20; await audio.play(); });
  await page.locator("#saved-only").click();
  await expect.poll(() => page.locator("#audio").evaluate((audio) => !audio.paused && audio.currentTime >= 20)).toBe(true);
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await second.goto("http://127.0.0.1:8080/?q=Fear%20and%20Hunger");
    await expect(second.locator(`#listener-profile option[value="${profile.id}"]`)).toHaveCount(1);
    await second.getByLabel("Listener profile", { exact: true }).selectOption(profile.id);
    await expect(button(second)).toHaveAttribute("aria-pressed", "true");
    await second.locator("#saved-only").click();
    await expect(second.locator("#tracks > .track")).toHaveCount(2);
    await button(second, otherSong).click();
    await expect(second.locator("#tracks > .track")).toHaveCount(1);
    await refreshProfile(page);
    await expect(button(page, otherSong)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.locator("#audio").evaluate((audio) => !audio.paused && audio.currentTime >= 20)).toBe(true);
    await page.goto(lyricsHref(song));
    await expect(page.locator("#listener-profile")).toHaveValue(profile.id);
    await expect(button(page)).toHaveAttribute("aria-pressed", "true");
    await page.goto("/fearhunger/");
    await expect(button(page)).toHaveAttribute("aria-pressed", "true");
    await button(page, otherSong).click();
    await expect(button(page, otherSong)).toHaveAttribute("aria-pressed", "true");
    await page.goto(`/?profile=${profile.id}&saved=1`);
    await expect(page.locator("#tracks > .track")).toHaveCount(2);
    await page.reload();
    await expect(page.locator("#tracks > .track")).toHaveCount(2);
    await page.locator("#favorites").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/favorites-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator("#listener-profile").boundingBox()).width).toBeGreaterThan(280);
    await page.locator("#favorites").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/favorites-mobile.png" });
    expect(errors).toEqual([]);
  } finally { await secondContext.close(); }
});

test("profiles have separate collections; history and stale responses cannot switch them", async ({ page }) => {
  await page.goto("/?q=Fear%20and%20Hunger");
  const first = await createProfile(page);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  const second = await createProfile(page);
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  await page.locator("#saved-only").click();
  await expect(page.locator("#tracks")).toContainText("No saved songs yet");
  await expect(page.locator("#play-all")).toBeDisabled();
  await page.getByLabel("Listener profile", { exact: true }).selectOption(first.id);
  await expect(page.locator("#tracks > .track")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator("#listener-profile")).toHaveValue(second.id);
  await expect(page.locator("#tracks")).toContainText("No saved songs yet");
  await page.goForward();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route(`**/yehry3/profiles/${first.id}`, async (route) => {
    const response = await route.fetch();
    requested();
    await wait;
    await route.fulfill({ response });
  });
  await refreshProfile(page);
  await started;
  await page.getByLabel("Listener profile", { exact: true }).selectOption(second.id);
  await expect(page.locator("#profile-status")).toContainText(second.name);
  release();
  await expect(page.locator("#listener-profile")).toHaveValue(second.id);
  await expect(page.locator("#tracks")).toContainText("No saved songs yet");
});

test("failed saves are explicit and retry recovers without losing saved songs", async ({ page }) => {
  await page.goto("/?q=Fear%20and%20Hunger");
  const profile = await createProfile(page);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await page.route(`**/yehry3/profiles/${profile.id}/favorites`, (route) => route.abort());
  await button(page, otherSong).click();
  await expect(page.locator("#profile-status")).toContainText("Couldn’t confirm");
  await expect(button(page, otherSong)).toHaveAttribute("aria-pressed", "false");
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await page.unroute(`**/yehry3/profiles/${profile.id}/favorites`);
  await page.getByRole("button", { name: "Retry profiles", exact: true }).click();
  await expect(page.locator("#profile-status")).toContainText("Synced across devices");
  await button(page, otherSong).click();
  await expect(button(page, otherSong)).toHaveAttribute("aria-pressed", "true");
  await page.route("**/yehry3/profiles**", (route) => route.abort());
  await refreshProfile(page);
  await expect(page.locator("#profile-status")).toContainText("Couldn’t sync");
  await expect(button(page)).toBeDisabled();
  await page.locator("#saved-only").click();
  await expect(page.locator("#tracks > .track")).toHaveCount(2);
  await expect(page.locator("#play-all")).toBeEnabled();
});

test("profile links work without browser storage, and names render as text", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) Storage.prototype[method] = () => { throw new Error("Storage disabled"); };
  });
  await page.goto("/?q=Fear%20and%20Hunger");
  await button(page).click();
  await expect(page.locator("#profile-status")).toContainText("Choose or create");
  if (await page.locator(".new-profile").getAttribute("open") !== null) await page.locator(".new-profile summary").click();
  const profile = await createProfile(page, `<img src=x onerror=alert(1)> ${randomUUID().slice(0, 6)}`);
  await expect(page.locator("#profile-status")).toContainText("can’t remember");
  await expect(page.locator(".favorites-panel img")).toHaveCount(0);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  const href = await page.locator("#profile-link").getAttribute("href");
  await page.goto(href);
  await expect(page.locator("#tracks > .track")).toHaveCount(1);
  await expect(page.locator("#listener-profile")).toHaveValue(profile.id);
  await page.reload();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("a late failed refresh cannot undo a successful save, and tabs follow profile changes", async ({ page, context }) => {
  await page.goto("/?q=Fear%20and%20Hunger");
  const first = await createProfile(page);
  const tab = await context.newPage();
  await tab.goto("/?q=Fear%20and%20Hunger");
  await expect(tab.locator("#listener-profile")).toHaveValue(first.id);
  let release, requested;
  const wait = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route(`**/yehry3/profiles/${first.id}`, async (route) => {
    requested();
    await wait;
    await route.abort();
  });
  await refreshProfile(page);
  await started;
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  release();
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#profile-status")).toContainText(`Saved to ${first.name}`);
  const second = await createProfile(page);
  await expect(tab.locator("#listener-profile")).toHaveValue(second.id);
  await expect(button(tab)).toHaveAttribute("aria-pressed", "false");
});
