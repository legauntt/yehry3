import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { lyricsHref, songAlias } from "../../assets/song-links.js";

const song = {
  id: "lyrics-before-deployment", title: "Fresh from the studio", duration: 180,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  lyrics: { kind: "written", text: "First line\nSecond line\nLast line", cues: [
    { line: 0, start: 1, end: 3 }, { line: 1, start: 4, end: 8 }, { line: 2, start: 9, end: 13 },
  ] },
};
const compact = { id: song.id, title: song.title, hasLyrics: true };
const href = lyricsHref(song);
async function apiSong(page) {
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [compact] } }));
  await page.route(`**/yehry3/songs/${song.id}`, route => route.fulfill({ json: { song } }));
  await page.route("**/yehry3/profiles**", route => route.fulfill({ json: { profiles: [] } }));
  await page.route("**/yehry3/listens", route => route.fulfill({ json: {} }));
}

test("a new pretty link opens before deployment and keeps its shared moment, playback and download", async ({ page, browser }) => {
  await apiSong(page);
  // Neither a missing detail file nor a stalled static catalog may hold up a new release.
  await page.route("**/catalog-summary.json", () => {});
  const response = await page.goto(`${href}?t=6.4#lyric-line-2`);
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain(`data-song-id="${song.id}"`);
  await expect(page.locator("h1")).toHaveText(song.title, { timeout: 2500 });
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(6.4, 1);
  await page.locator("audio").evaluate(async audio => { await audio.play(); audio.currentTime = 7; });
  await expect.poll(() => page.locator("audio").evaluate(audio => !audio.paused && audio.currentTime >= 7)).toBe(true);
  await page.locator("audio").evaluate(audio => audio.pause());
  await page.getByRole("button", { name: /Share this moment/ }).click();
  const link = await page.locator("#moment-link").inputValue();
  expect(new URL(link).pathname).toBe(href);
  expect(new URL(link).searchParams.has("song")).toBe(false);
  expect(new URL(link).hash).toBe("#lyric-line-2");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download lyrics" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${song.title}-lyrics.txt`);
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk;
  expect(text).toContain(song.lyrics.text);

  // A recipient has no cached song or prior visit to the collection.
  const recipient = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await apiSong(recipient);
    await recipient.goto(link);
    await expect(recipient.locator("h1")).toHaveText(song.title);
    await expect.poll(() => recipient.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(Number(new URL(link).searchParams.get("t")), 1);
    expect(await recipient.locator("audio").evaluate(audio => audio.paused)).toBe(true);
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await recipient.screenshot({ path: "artifacts/lyrics-fallback-mobile.png", fullPage: true });
  } finally { await recipient.close(); }
});

test("cached pretty links reopen during an API outage before the static page exists", async ({ page }) => {
  await apiSong(page);
  await page.goto(href);
  await expect(page.locator("h1")).toHaveText(song.title);
  await page.route("**/yehry3/songs/**", route => route.abort());
  await page.route("**/catalog-summary.json", route => route.abort());
  await page.reload();
  await expect(page.locator("h1")).toHaveText(song.title, { timeout: 2500 });
  expect(new URL(page.url()).pathname).toBe(href);
});

test("the static catalog resolves a pretty link without storage or a responding API", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.route("**/yehry3/songs/**", () => {});
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [compact] } }));
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.goto(href);
  await expect(page.locator("h1")).toHaveText(song.title, { timeout: 2500 });
});

test("generated lyrics keep their own HTML and need no alias lookup", async ({ page }) => {
  const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
  const published = catalog.songs.find(song => song.collection === "fearhunger");
  const known = lyricsHref(published);
  const lookupRequests = [];
  page.on("request", request => { if (/\/songs\/summary|\/catalog-summary\.json/.test(request.url())) lookupRequests.push(request.url()); });
  await page.route(`**/yehry3/songs/${published.id}`, route => route.fulfill({ json: { song: published } }));
  for (const path of [known, known.slice(0, -1), `${known}index.html`]) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`data-song-id="${published.id}"`);
    expect(html).toContain(`<meta property="og:url" content="https://yehry3.app${known}" />`);
    await expect(page.locator("h1")).toHaveText(published.title);
  }
  expect(lookupRequests).toEqual([]);
});

test("an incorrect full alias cannot select a song by hash and unrelated 404s remain 404s", async ({ page }) => {
  await apiSong(page);
  const detailRequests = [];
  page.on("request", request => { if (request.url().endsWith(`/songs/${song.id}`)) detailRequests.push(request.url()); });
  await page.goto(`/lyrics/wrong-title-${songAlias(song).slice(-6)}/`);
  await expect(page.locator("h1")).toHaveText("This sheet is not available yet.");
  expect(detailRequests).toEqual([]);
  const missing = await page.goto("/not-a-lyric-page/");
  expect(missing.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Lost between tracks.");
});
