import { test, expect } from "@playwright/test";
import { songSummary } from "../../assets/song-summary.js";
import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const real = (catalog.songs || catalog).find(song => song.id?.startsWith("distonyc-"));
const target = { id: real.id, title: "Shared fixture", duration: 90, url: "/shared-fixture.wav", collection: "distonyc", votes: 0, order: -1, voiceModel: "v8" };
const filler = Array.from({ length: 8 }, (_, index) => ({
  id: `filler-${index}`, title: `Older song ${index}`, duration: 90, url: "/shared-fixture.wav",
  collection: "fearhunger", votes: 8 - index, order: -(index + 2),
}));
const songs = [...filler, target];
const queue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };

async function fixtures(page) {
  await page.route("**/shared-fixture.wav", route => route.fulfill({ body: Buffer.alloc(44), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
}

test("a shared song link badges the song for the life of the page", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/song/${target.id}/`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-shared/);
  await expect(row.locator(".shared-badge")).toHaveText("Shared with you just now");
  await expect(row).toBeInViewport();
  await expect(row).toHaveClass(/is-revealed/);
  await expect(row).not.toHaveClass(/is-revealed/, { timeout: 12000 }); // The pulse settles; the badge stays.
  await expect(row.locator(".shared-badge")).toBeVisible();
  // Every render resets each row's classes; the badge must be reapplied once the alert outline has expired.
  await page.evaluate(() => { const search = document.querySelector("#search"); search.value = "Shared"; search.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator(`.track[data-id="${target.id}"]`)).toHaveClass(/is-shared/);
  await expect(page.locator(`.track[data-id="${target.id}"]`)).not.toHaveClass(/is-revealed/);
  await expect(page.locator(`.track[data-id="${target.id}"] .shared-badge`)).toHaveCount(1);
  await page.reload();
  await expect(page.locator(`.track[data-id="${target.id}"]`)).not.toHaveClass(/is-shared/);
});

test("a completion alert or typed fragment is revealed but not called shared", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/#${target.id}`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row).toHaveClass(/is-revealed/);
  await expect(row).not.toHaveClass(/is-shared/);
  await expect(page.locator(".shared-badge")).toHaveCount(0);
});

test("the playing song and the player bar say Now playing", async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = function () { setTimeout(() => this.dispatchEvent(new Event("play")), 0); Object.defineProperty(this, "paused", { value: false, configurable: true }); return Promise.resolve(); }; });
  await page.goto("/");
  const first = page.locator("#tracks .track").first();
  await first.locator("[data-play]").click();
  await expect(page.locator(".player .eyebrow")).toHaveText("Now playing");
  await expect(page.locator(".player.is-playing")).toBeVisible();
  await expect(page.locator("#tracks .track.playing")).toHaveCount(1);
  const label = await page.locator("#tracks .track.playing").evaluate(el => getComputedStyle(el, "::before").content);
  expect(label).toBe('"Now playing"');
  const animation = await page.locator("#tracks .track.playing").evaluate(el => getComputedStyle(el).animationName);
  expect(animation).toBe("now-playing-pulse");
});

test("a shared song is followed to the page the live catalog settles it on", async ({ page }) => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `many-${index}`, title: `Song ${index}`, duration: 90, url: "/shared-fixture.wav",
    collection: "fearhunger", votes: 500 - index, order: 100 - index,
  }));
  const early = [{ ...target, votes: 9999, order: 1000 }, ...many];
  const settled = [{ ...target, votes: 0, order: -1000 }, ...many];
  await fixtures(page);
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: early.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", async route => {
    await new Promise(resolve => setTimeout(resolve, 1500)); // The live catalog lands after the link did.
    await route.fulfill({ json: { songs: settled.map(songSummary), nextVoteAt: null } });
  });
  await page.goto(`/song/${target.id}/`);
  const row = page.locator(`.track[data-id="${target.id}"]`);
  await expect(row.locator(".shared-badge")).toBeVisible();
  await expect(page.locator("[data-page-status]").first()).not.toHaveText("Page 1 of 3", { timeout: 8000 });
  await expect(row.locator(".shared-badge")).toBeVisible();
  await expect(row).toBeInViewport();
});
