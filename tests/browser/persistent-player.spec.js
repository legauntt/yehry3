import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { songSummary } from "../../assets/song-summary.js";
import { lyricsHref } from "../../assets/song-links.js";

// Moving between pages must not stop the music or send the avatars away and back.
test.use({ reducedMotion: "reduce" });

const wav = (seconds = 240) => {
  const rate = 8000, buffer = Buffer.alloc(44 + rate * seconds);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate, 28);
  buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  buffer.fill(128, 44);
  return buffer;
};
const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const real = (catalog.songs || catalog).find((song) => song.id?.startsWith("distonyc-") && song.lyrics?.cues?.length && song.remixOf);
const songs = [
  { id: "stay-first", title: "First to stay", duration: 240, url: "/stay-fixture.wav", collection: "tonyai", votes: 2, order: -2, voiceModel: "v7", hasLyrics: false },
  { id: "stay-second", title: "Second to stay", duration: 240, url: "/stay-fixture.wav", collection: "tonyai", votes: 1, order: -1, voiceModel: "v7", hasLyrics: false },
  { id: "stay-third", title: "Third to stay", duration: 240, url: "/stay-fixture.wav", collection: "tonyai", votes: 0, order: -3, voiceModel: "v7", hasLyrics: false },
];
const queue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };
const you = { id: "aaaaaaaaaaaaaa00", name: "happy-rabbit", anonymous: true, emoji: "🐇", hue: 120 };
const other = { id: "bbbbbbbbbbbbbb01", name: "Jesse Gauntt", anonymous: false, emoji: "🦊", hue: 20, song: null, since: null };

async function studio(page) {
  const state = { reports: [], left: [], polls: 0 };
  const body = () => ({ version: "1000000000000001", listeners: [{ ...you, song: null, since: null }, other], total: 2, beatMs: 25000 });
  for (const url of ["**/stay-fixture.wav", `**/${real.url.split("/").slice(3).join("/")}`, `**/${new URL(real.remixOf.url).pathname.slice(1)}`])
    await page.route(url, (route) => route.fulfill({ body: wav(), contentType: "audio/wav", headers: { "Accept-Ranges": "bytes" } }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: queue }));
  await page.route("**/yehry3/mixtapes**", (route) => route.fulfill({ json: { mixtapes: [], page: 0, hasMore: false } }));
  await page.route("**/yehry3/listens", (route) => route.fulfill({ json: {} }));
  await page.routeWebSocket("**/yehry3/events/socket", (line) => line.close({ code: 1013 }));
  const events = () => ({ version: body().version + "0000000000000001", topics: { listeners: body(), catalog: { version: "0000000000000001" } } });
  await page.route(/\/yehry3\/(?:listeners|events)(?:[/?]|$)/, async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") { state.left.push(new URL(request.url()).pathname.split("/").pop()); return route.fulfill({ json: { left: true } }); }
    if (request.method() === "POST") {
      state.reports.push(request.postDataJSON());
      return route.fulfill({ json: { you, ...body() } });
    }
    state.polls++;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: events() }).catch(() => {});
  });
  return state;
}
// Marks the page's own JavaScript world: a full page load would lose it, a swap keeps it.
const mark = (page) => page.evaluate(() => { window.__stays = "still here"; window.__audio = window.yehry3Player.audio; });
const stayed = (page) => page.evaluate(() => window.__stays === "still here" && window.__audio === window.yehry3Player.audio);
const playing = (page) => page.evaluate(() => { const audio = window.yehry3Player.audio; return !audio.paused && !audio.ended && audio.currentTime > 0.2; });

test("a song keeps playing, and the room stays, as pages change", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".room-seat")).toHaveCount(2);
  await page.locator('.track[data-id="stay-first"] [data-play]').click();
  await expect(page.locator("#site-player")).toBeVisible();
  await expect(page.locator("#site-player #now-title")).toHaveText("First to stay");
  await expect.poll(() => playing(page)).toBe(true);
  await expect.poll(() => state.reports.at(-1)?.songId, { timeout: 8000 }).toBe("stay-first");
  await mark(page);
  const tab = state.reports[0].tab;

  for (const [name, path] of [["Mixtapes", "/mixtapes/"], ["The queue", "/queue/"], ["Backstage", "/admin/"], ["Make a request", "/distonyc/"], ["The collection", "/"]]) {
    await page.locator('.site-header nav').getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(path === "/" ? /^[^/]+\/\/[^/]+\/(\?.*)?$/ : new RegExp(`${path}$`));
    await expect(page.locator("main#main h1").first()).toBeVisible();
    expect(await stayed(page), `${name} kept the page's world`).toBe(true);
    expect(await playing(page), `${name} kept the song playing`).toBe(true);
    await expect(page.locator("#site-player")).toBeVisible();
    await expect(page.locator("#site-player #now-title")).toHaveText("First to stay");
    // The avatars are on every page, and the same two people sit there throughout.
    await expect(page.locator(".room-seat")).toHaveCount(2);
    await expect(page.locator(".site-header nav [aria-current='page']")).toHaveCount(1);
  }
  expect(state.left).toEqual([]);
  expect(new Set(state.reports.map((report) => report.tab))).toEqual(new Set([tab]));

  // History works without a reload, and the collection page draws itself again against the playing song.
  await page.goBack();
  await expect(page).toHaveURL(/\/distonyc\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/$/);
  expect(await stayed(page)).toBe(true);
  await page.goForward();
  await expect(page).toHaveURL(/\/distonyc\/$/);
  expect(await playing(page)).toBe(true);
  await page.locator(".site-header nav").getByRole("link", { name: /^The collection/ }).click();
  await expect(page.locator('.track[data-id="stay-first"]')).toHaveClass(/playing/);
  await expect(page.locator('.track[data-id="stay-first"] [data-play]')).toHaveAttribute("aria-pressed", "true");

  // The bar is the player wherever the visitor is: it pauses, and moves along the queue.
  await page.locator(".site-header nav").getByRole("link", { name: /^Mixtapes/ }).click();
  await page.locator("#site-player #next").click();
  await expect(page.locator("#site-player #now-title")).toHaveText("Second to stay");
  await expect.poll(() => playing(page)).toBe(true);
  await page.locator("#site-player #previous").click();
  await expect(page.locator("#site-player #now-title")).toHaveText("First to stay");
  await page.evaluate(() => window.yehry3Player.pause());
  await expect(page.locator("#site-player")).toHaveClass(/(?!.*is-playing)/);
  await expect(page.locator("#site-player .eyebrow")).toHaveText("Paused");
});

test("a link that leaves the swapped pages is an ordinary page load", async ({ page }) => {
  await studio(page);
  await page.goto("/?sort=catalog");
  await page.locator('.track[data-id="stay-first"] [data-play]').click();
  await mark(page);
  await page.locator(".site-footer").getByRole("link", { name: /Fear & Hunger/ }).click();
  await expect(page).toHaveURL(/\/fearhunger\/$/);
  expect(await page.evaluate(() => window.__stays)).toBeUndefined();
  await expect(page.locator(".room-seat")).toHaveCount(2);
});

test("a lyric sheet plays on the site's player and the song stays as the visitor leaves", async ({ page }) => {
  const state = await studio(page);
  const cue = real.lyrics.cues.find((line) => line.start > 5) || real.lyrics.cues[1];
  await page.goto(lyricsHref(real));
  const sheet = page.locator(".lyrics-sheet");
  await expect(sheet.locator("h1")).toHaveText(real.title);
  await expect(page.locator(".room-seat")).toHaveCount(2);
  await expect(page.locator("#site-player")).toBeHidden();
  // With the player idle, a line chosen readies the song at that place, paused: nothing starts by itself.
  const line = sheet.locator(`button.lyric-line[data-start="${cue.start}"]`).first();
  await line.click();
  await expect(page.locator("#site-player")).toBeVisible();
  await expect(page.locator("#site-player .eyebrow")).toHaveText("Paused");
  await expect(sheet.locator("#sheet-play")).toHaveText("Resume");
  expect(await page.evaluate(() => window.yehry3Player.audio.paused)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeCloseTo(cue.start, 0);
  await sheet.locator("#sheet-play").click();
  await expect(sheet.locator("#sheet-play")).toHaveText("Pause");
  await expect(page.locator("#site-player #now-title")).toContainText(real.title);
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(cue.start - 0.5);
  await expect(line).toHaveClass(/is-active/);
  await mark(page);
  await expect.poll(() => state.reports.at(-1)?.songId).toBe(real.id);

  // Leaving for the collection changes nothing about the song.
  await page.locator(".site-header nav").getByRole("link", { name: /^The collection/ }).click();
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  expect(await stayed(page)).toBe(true);
  expect(await playing(page)).toBe(true);
  await expect(page.locator("#site-player #now-title a")).toHaveAttribute("href", lyricsHref(real));
  // The bar's title returns to the sheet, which finds its song already playing.
  await page.locator("#site-player #now-title a").click();
  await expect(sheet.locator("#sheet-play")).toHaveText("Pause");
  // Audio keeps advancing during navigation; a short cue may already be over.
  await expect(sheet.locator(".lyric-line.is-active")).toHaveCount(1);
  expect(await playing(page)).toBe(true);
  await sheet.locator("#sheet-play").click();
  await expect(sheet.locator("#sheet-play")).toHaveText("Resume");
  expect(await page.evaluate(() => window.yehry3Player.audio.paused)).toBe(true);
});

test("a remix's comparison switches recordings on the player, each keeping its place", async ({ page }) => {
  await studio(page);
  await page.goto(lyricsHref(real));
  const comparison = page.locator("#compare-original");
  await comparison.locator("summary").click();
  await page.locator("#sheet-play").click();
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(0.6);
  await page.evaluate(() => { window.yehry3Player.audio.currentTime = 30; });
  await comparison.locator("[data-compare-original]").click();
  await expect.poll(() => page.evaluate(() => window.yehry3Player.current?.id)).toBe(real.remixOf.songId);
  await expect(comparison.locator("[data-compare-now]")).toHaveText("Playing the original.");
  await page.evaluate(() => { window.yehry3Player.audio.currentTime = 90; });
  await comparison.locator("[data-compare-remix]").click();
  await expect.poll(() => page.evaluate(() => window.yehry3Player.current?.id)).toBe(real.id);
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(29.5);
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeLessThan(36);
  await comparison.locator("[data-compare-original]").click();
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(89.5);
});

test("a mixtape keeps playing after the visitor leaves it, and the deck picks it up on return", async ({ page }) => {
  await studio(page);
  await page.goto("/mixtapes/new");
  await expect(page.locator("#tape-catalog .tape-pick")).toHaveCount(3);
  for (const id of ["stay-second", "stay-third"]) await page.locator(`[data-add="${id}"][data-to="a"]`).click();
  await page.locator("#play-tape").click();
  await expect(page.locator("#tape-now")).toHaveText("Second to stay");
  await expect(page.locator("#site-player #now-title")).toHaveText("Second to stay");
  await mark(page);
  await page.locator(".site-header nav").getByRole("link", { name: /^The queue/ }).click();
  await expect(page).toHaveURL(/\/queue\/$/);
  expect(await stayed(page)).toBe(true);
  await expect.poll(() => playing(page)).toBe(true);
  await page.locator("#site-player #next").click();
  await expect(page.locator("#site-player #now-title")).toHaveText("Third to stay");
  await page.goBack();
  await expect(page).toHaveURL(/\/mixtapes\/new$/);
  await expect(page.locator("#tape-mode")).toContainText("PLAYING");
  await expect(page.locator("#tape-now")).toHaveText("Third to stay");
  expect(await stayed(page)).toBe(true);
});

test("a lyric sheet opened while another song plays leaves that song alone until asked", async ({ page }) => {
  await studio(page);
  await page.goto("/?sort=catalog");
  await page.locator('.track[data-id="stay-first"] [data-play]').click();
  await expect.poll(() => playing(page)).toBe(true);
  // A full page load would lose the song, so the sheet is opened through a link in the page.
  await page.evaluate((href) => { const link = document.createElement("a"); link.href = href; link.textContent = "sheet"; document.querySelector("main").append(link); }, `${lyricsHref(real)}?t=30`);
  await page.getByRole("link", { name: "sheet", exact: true }).click();
  const sheet = page.locator(".lyrics-sheet");
  await expect(sheet.locator("h1")).toHaveText(real.title);
  expect(await page.evaluate(() => window.yehry3Player.current.id)).toBe("stay-first");
  expect(await playing(page)).toBe(true);
  await expect(sheet.locator("#sheet-play")).toHaveText("Play");
  await expect(sheet.locator("#sheet-time")).toContainText("Starts at 0:30");
  await sheet.locator("#sheet-play").click();
  await expect.poll(() => page.evaluate(() => window.yehry3Player.current.id)).toBe(real.id);
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(29.5);
});
