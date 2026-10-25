import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { lyricsHref } from "../../assets/song-links.js";

const id = "distonyc-e87d33434caabdd9e3d27ab3";
const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url)));
const song = catalog.songs.find(song => song.id === id);
const draft = JSON.parse(await readFile(new URL(`../../lyric-transcripts/${id}.whisper.json`, import.meta.url)));
const transcriptPath = `**/lyric-transcripts/${id}.whisper.json`;
const choose = (page, view) => page.getByRole("combobox", { name: "Lyric view", exact: true }).selectOption(view);

async function setup(page, next = song) {
  // Read-only even when pointed at production; use a local audio fixture for playback.
  await page.route("**/yehry3/**", route => route.fulfill({ json: { songs: [], profiles: [], listeners: [] } }));
  await page.route(`**/yehry3/songs/${next.id}`, route => route.fulfill({ json: { song: next } }));
  await page.route(`**/songs/${next.id}.json`, route => route.fulfill({ json: next }));
  await page.route(next.url, async route => {
    const response = await route.fetch({ url: new URL("/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", test.info().project.use.baseURL).href });
    await route.fulfill({ response }); // Preserve the server's byte-range/seek support.
  });
}

test("Whisper has its own words, times, uncertainty, downloads and print without replacing the playing audio", async ({ page }) => {
  await setup(page);
  await page.goto(`${lyricsHref(song)}?view=original`);
  await expect(page.locator('#lyric-view option[value="whisper"]')).toBeEnabled();
  await page.locator("#sheet-play").click();
  await expect.poll(() => page.locator("audio").evaluate(audio => !audio.paused)).toBe(true);
  await page.locator("audio").evaluate(audio => { window.keptAudio = audio; audio.currentTime = 11; });
  await choose(page, "whisper");
  await expect(page.locator('[data-lyric-text="1"]')).toHaveText("For candy by the doorway counted every head");
  expect(await page.locator("audio").evaluate(audio => audio === window.keptAudio && !audio.paused && audio.currentTime >= 11)).toBe(true);
  await expect(page.locator("button.lyric-line")).toHaveCount(44);
  await expect(page.locator(".lyric-uncertain")).toHaveCount(5);
  await expect(page.locator(".karaoke-note")).toContainText("Unreviewed");
  await page.locator("audio").evaluate(audio => audio.pause());
  await page.locator("#lyric-line-2").click();
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(10.58, 2);
  expect(new URL(page.url()).searchParams.get("view")).toBe("whisper");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download lyrics", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${song.title}-lyrics-whisper.txt`);
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk;
  expect(text).toContain("Lyrics (Whisper)");
  expect(text).toContain("For candy by the doorway counted every head [?]");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".lyric-print-note")).toContainText("no listener has checked");
  await expect(page.locator(".lyric-uncertain").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await choose(page, "original");
  await expect(page.locator(".lyrics-text")).toContainText("Put candy");
  expect(new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).searchParams.get("t")).toBe("10.58");
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(10.58, 2);
});

test("a shared Whisper line overrides saved preferences and stays on the same recording time across views", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("yehry3:lyric-view", "ipa"));
  await page.goto(`${lyricsHref(song)}?view=whisper#lyric-line-2`);
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(10.58, 2);
  expect(await page.locator("audio").evaluate(audio => audio.paused)).toBe(true);
  await page.getByRole("button", { name: /Share this moment/ }).click();
  await choose(page, "original");
  const original = new URL(await page.locator("#moment-link").inputValue());
  expect(original.searchParams.get("t")).toBe("10.6");
  expect(original.searchParams.get("view")).toBe("original");
  await choose(page, "whisper");
  const whisper = new URL(await page.locator("#moment-link").inputValue());
  expect(whisper.searchParams.get("view")).toBe("whisper");
  expect(whisper.hash).toBe("#lyric-line-2");
  await page.reload();
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(10.58, 2);
});

test("unavailable and mismatched transcripts fall back honestly, and network failure can be retried", async ({ page }) => {
  const missing = { ...song, id: "no-performance-transcript" };
  await setup(page, missing);
  await page.goto(`/lyrics/?song=${missing.id}&view=whisper#lyric-line-2`);
  await expect(page.locator("#lyric-view-note")).toContainText("no Whisper transcription");
  await expect(page.locator(".lyrics-text")).toContainText("Put candy");
  await expect(page.locator('#lyric-view option[value="whisper"]')).toBeDisabled();
  expect(new URL(page.url()).hash).toBe("");
  await setup(page);
  await page.route(transcriptPath, route => route.fulfill({ json: { ...draft, audioSha256: "0".repeat(64) } }));
  await page.goto(`${lyricsHref(song)}?view=whisper`);
  await expect(page.locator("#lyric-view-note")).toContainText("could not be loaded");
  await expect(page.locator(".lyrics-text")).toContainText("Put candy");
  await page.unroute(transcriptPath);
  await choose(page, "whisper");
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
});

test("slow transcript fetches cannot overwrite newer choices; mobile remains compact", async ({ page }) => {
  await setup(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(transcriptPath, async route => { await gate; await route.continue(); });
  await page.goto(`${lyricsHref(song)}?view=original`);
  await choose(page, "whisper");
  await expect(page.locator(".lyric-views")).toHaveAttribute("aria-busy", "true");
  await choose(page, "original");
  release();
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "original");
  await choose(page, "whisper");
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
  expect((await page.locator(".lyric-toolbar").boundingBox()).height).toBeLessThan(60);
  await page.screenshot({ path: "artifacts/whisper-desktop.png" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) expect((await page.locator(".lyric-toolbar").boundingBox()).height).toBeLessThan(108);
    await page.screenshot({ path: `artifacts/whisper-${width}.png` });
  }
});

test("released mixes and empty recognition are attributed without inventing lyrics", async ({ page }) => {
  await setup(page);
  const mixed = { ...draft, input: "released-recording", inputSha256: draft.audioSha256 };
  await page.route(transcriptPath, route => route.fulfill({ json: mixed }));
  await page.goto(`${lyricsHref(song)}?view=whisper`);
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
  await page.getByRole("button", { name: "About this lyric view", exact: true }).click();
  await expect(page.locator("#lyric-view-note")).toContainText("released recording, including instruments");
  await page.route(transcriptPath, route => route.fulfill({ json: { ...mixed, segments: [], outcome: "no-words-recognized" } }));
  await page.reload();
  await expect(page.locator(".lyrics-text")).toContainText("Whisper did not recognize any words");
  await expect(page.locator("button.lyric-line")).toHaveCount(0);
  await expect(page.locator(".lyrics-text")).not.toContainText("Put candy");
  await expect(page.locator(".karaoke-note")).toContainText("No words recognized");
});

test("a newly published transcript becomes available on an open sheet", async ({ page }) => {
  await setup(page);
  let available = false;
  await page.route("**/assets/lyric-transcripts.json", route => route.fulfill({ json: available
    ? { [id]: { audioUrl: song.url, methods: ["whisper"] } } : {} }));
  await page.goto(`${lyricsHref(song)}?view=original`);
  await expect(page.locator('#lyric-view option[value="whisper"]')).toBeDisabled();
  await page.locator(".lyrics-text").evaluate(sheet => { window.keptSheet = sheet; });
  available = true;
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 61000;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator('#lyric-view option[value="whisper"]')).toBeEnabled();
  expect(await page.locator(".lyrics-text").evaluate(sheet => sheet === window.keptSheet)).toBe(true);
  await choose(page, "whisper");
  await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", "whisper");
});
