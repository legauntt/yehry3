import { test, expect } from "@playwright/test";
import { songSummary } from "../../assets/song-summary.js";
import { readFile } from "node:fs/promises";

const released = { id: `distonyc-${"b".repeat(24)}`, title: "Just released", duration: 90, url: "/release-fixture.wav", collection: "distonyc", votes: 0, order: -1, voiceModel: "v8" };
const filler = Array.from({ length: 30 }, (_, index) => ({
  id: `filler-${index}`, title: `Older song ${String(index).padStart(2, "0")}`,
  duration: 90, url: "/release-fixture.wav", collection: "fearhunger", votes: 30 - index, order: -(index + 2),
}));
const songs = [...filler, released];
const queued = { id: `distonyc-${"c".repeat(24)}`, idea: "Still cooking", title: null, status: "queued", voiceModel: "v7", updatedAt: new Date().toISOString(), originalPrompt: { idea: "Still cooking", direction: "", keep: "", basisSongs: [], voiceModel: "v7" } };
const queue = { inStudio: [], needsAttention: [], queued: [queued], recent: [], queuedTotal: 1, inStudioTotal: 0, page: 0, pageSize: 50 };

async function fixtures(page) {
  await page.route("**/release-fixture.wav", route => route.fulfill({ body: Buffer.alloc(44), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/yehry3/queue/distonyc-*", route => route.fulfill({ json: queued }));
}

test("a completion alert opens the listening room, not the queue", async () => {
  const worker = await readFile(new URL("../../notifications-sw.js", import.meta.url), "utf8");
  expect(worker).toContain('new URL("/", self.location.origin)');
  expect(worker).not.toContain('new URL("/queue/"');
});

test("the released song is found whatever filter or page was left behind", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/?collection=fearhunger&q=Older&page=2#${released.id}`);
  const row = page.locator(`.track[data-id="${released.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/is-revealed/);
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator("#collection-filter")).toHaveValue("all");
  await expect(row).toBeInViewport();
  await expect(page.locator(`.track[data-id="${released.id}"] [data-play]`)).toBeVisible();
  expect(await page.locator("#audio").count()).toBe(1);
  expect(await page.locator("#audio").evaluate(audio => audio.paused)).toBe(true); // Landing never autoplays.
});

test("an unfinished request lands on its still-generating row and an unknown fragment does nothing", async ({ page }) => {
  await fixtures(page);
  await page.goto(`/#${queued.id}`);
  const pending = page.locator(`.pending-track[data-id="${queued.id}"]`);
  await expect(pending).toHaveClass(/is-revealed/);
  await expect(pending.locator(".voice-model-badge")).toHaveText("V7");
  await page.goto("/?sort=catalog#not-a-song-here");
  await expect(page.locator("#tracks .track").first()).toBeVisible();
  await expect(page.locator(".is-revealed")).toHaveCount(0);
});
