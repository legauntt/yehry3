import { test, expect } from "@playwright/test";
import { songSummary } from "../../assets/song-summary.js";

const wav = () => {
  const buffer = Buffer.alloc(44 + 8000 * 2 * 4);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
};

const songs = [
  { id: "loop-first", title: "First around", duration: 4, url: "/loop-fixture.wav", collection: "tonyai", votes: 2, order: -2, voiceModel: "v7", lyrics: { text: "[Verse]\nRound and round it goes", kind: "written" } },
  { id: "loop-second", title: "Second around", duration: 4, url: "/loop-fixture.wav", collection: "tonyai", votes: 1, order: -1, voiceModel: "v7" },
];
const queue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };

async function fixtures(page) {
  await page.route("**/loop-fixture.wav", route => route.fulfill({ body: wav(), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  for (const song of songs) {
    await page.route(`**/yehry3/songs/${song.id}`, route => route.fulfill({ json: { song } }));
    await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  }
  await page.route("**/yehry3/listens", route => route.fulfill({ json: {} }));
}

test("the collection player repeats the chosen track instead of moving on", async ({ page }) => {
  await fixtures(page);
  await page.goto("/?sort=catalog");
  const loop = page.locator(".player [data-loop-toggle]");
  await expect(loop).toHaveText("Loop off");
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await page.locator('.track[data-id="loop-first"] [data-play]').click();
  await expect.poll(() => page.locator("#audio").evaluate(audio => audio.paused)).toBe(false);
  await loop.click();
  await expect(loop).toHaveText("Loop on");
  expect(await page.locator("#audio").evaluate(audio => audio.loop)).toBe(true);
  // A looping track never reports that it ended, so the queue stays put.
  await page.locator("#audio").evaluate(audio => { audio.currentTime = audio.duration - 0.2; });
  await page.waitForTimeout(1200);
  await expect(page.locator("#now-title")).toHaveText("First around");
  await loop.click();
  await expect(loop).toHaveText("Loop off");
  expect(await page.locator("#audio").evaluate(audio => audio.loop)).toBe(false);
  await page.locator("#next").click();
  await expect(page.locator("#now-title")).toHaveText("Second around");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(loop).toBeVisible();
  await expect(loop).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".player").screenshot({ path: "artifacts/loop/player-mobile.png" });
});

test("the repeat choice is shared with the lyric sheet and survives navigation", async ({ page }) => {
  await fixtures(page);
  await page.goto("/?sort=catalog");
  await page.locator('.track[data-id="loop-first"] [data-play]').click();
  await page.locator(".player [data-loop-toggle]").click();
  await page.goto("/lyrics/?song=loop-first");
  const loop = page.locator(".shared-song-player [data-loop-toggle]");
  await expect(loop).toHaveText("Loop on");
  await expect(loop).toHaveCount(1);
  expect(await page.locator("#audio").evaluate(audio => audio.loop)).toBe(true);
  await loop.click();
  await expect(loop).toHaveText("Loop off");
  expect(await page.locator("#audio").evaluate(audio => audio.loop)).toBe(false);
  await page.goto("/?sort=catalog");
  await page.locator('.track[data-id="loop-first"] [data-play]').click();
  await expect(page.locator(".player [data-loop-toggle]")).toHaveText("Loop off");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lyrics/?song=loop-first");
  await expect(page.locator(".shared-song-player [data-loop-toggle]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
