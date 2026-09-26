import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { lyricsHref } from "../../assets/song-links.js";

const song = {
  id: "lyric-views-test", title: "Very Serious Singing", duration: 180,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  lyrics: { kind: "written", text: "[Chorus]\nThe night is young!\nHello, Tony.\n\nZxyzzë <3", cues: [
    { line: 1, start: 4, end: 8 }, { line: 2, start: 9, end: 13 },
  ] },
};
async function setup(page, next = song) {
  // Also makes live verification read-only: no votes, listens or presence writes.
  await page.route("**/yehry3/**", route => route.fulfill({ json: { songs: [], profiles: [], listeners: [] } }));
  await page.route(`**/yehry3/songs/${next.id}`, route => route.fulfill({ json: { song: next } }));
  await page.route(`**/songs/${next.id}.json`, route => route.fulfill({ json: next }));
}
const first = page => page.locator('#lyric-line-2 [data-lyric-text]');
const choose = (page, view) => page.getByRole("combobox", { name: "Lyric view", exact: true }).selectOption(view);

test("views keep the same playing audio, cue buttons and shared line; downloads and print follow the view", async ({ page }) => {
  await setup(page);
  let dictionaries = 0;
  page.on("request", request => { if (request.url().endsWith("/lyric-pronunciations.json")) dictionaries++; });
  await page.goto(`/lyrics/?song=${song.id}#lyric-line-3`);
  await expect(first(page)).toHaveText("The night is young!");
  expect(dictionaries).toBe(0);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(9);
  await page.locator("#lyric-line-3").evaluate(line => { window.keptLyric = line; });
  await page.locator("audio").evaluate(audio => { window.keptAudio = audio; });
  await page.locator("#sheet-play").click();
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.paused)).toBe(false);
  const repeat = page.locator(".lyric-toolbar [data-loop-toggle]");
  await repeat.click();
  await expect(repeat).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("audio").evaluate(audio => audio.loop)).toBe(true);
  await repeat.click();
  await choose(page, "ipa");
  await expect(first(page)).toHaveText("/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
  expect(await page.locator("audio").evaluate(audio => audio === window.keptAudio && !audio.paused && audio.currentTime >= 9)).toBe(true);
  expect(await page.locator("#lyric-line-3").evaluate(line => line === window.keptLyric)).toBe(true);
  await expect(page.locator("#lyric-line-3")).toHaveClass(/is-linked/);
  await page.locator("audio").evaluate(audio => audio.pause());
  await page.locator("#lyric-line-2").click();
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(4);
  await choose(page, "phonics");
  await expect(first(page)).toHaveText("dhuh nyte iz yuhng!");
  await expect(page.locator(".lyric-heading")).toHaveText("[Chorus]");
  await expect(page.locator('[data-lyric-text="4"]')).toHaveText("Zxyzzë <3");
  expect(dictionaries).toBe(1);
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download lyrics", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${song.title}-lyrics-phonics.txt`);
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk;
  expect(text).toContain("[Chorus]\ndhuh nyte iz yuhng!");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".lyric-view-controls")).toBeHidden();
  await expect(first(page)).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.screenshot({ path: "artifacts/lyric-views-desktop.png", fullPage: true });
  await choose(page, "original");
  await expect(first(page)).toHaveText("The night is young!");
  await expect(page.locator("#download-lyrics")).toHaveAttribute("download", `${song.title}-lyrics.txt`);
});

test("the choice survives reload and navigation, syncs tabs, and all views fit a phone", async ({ page, context }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/lyrics/?song=${song.id}`);
  for (const view of ["ipa", "phonics", "diacritics"]) {
    await choose(page, view);
    await expect(page.locator(".lyrics-text")).toHaveAttribute("data-lyric-view", view);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(first(page)).toHaveText("Thë nïght ïs ÿöüng!");
  await page.screenshot({ path: "artifacts/lyric-views-mobile.png", fullPage: true });
  await page.reload();
  await expect(first(page)).toHaveText("Thë nïght ïs ÿöüng!");
  await page.goto("/lyrics/");
  await expect(page.locator("h1")).toHaveText("This sheet is not available yet.");
  await page.goBack();
  await expect(first(page)).toHaveText("Thë nïght ïs ÿöüng!");
  const second = await context.newPage();
  try {
    await setup(second);
    await second.goto(`/lyrics/?song=${song.id}`);
    await expect(first(second)).toHaveText("Thë nïght ïs ÿöüng!");
    await choose(second, "phonics");
    await expect(first(page)).toHaveText("dhuh nyte iz yuhng!");
  } finally { await second.close(); }
});

test("blocked storage and a failed dictionary keep lyrics usable and allow retry", async ({ page }) => {
  await setup(page);
  let releaseSong;
  const songGate = new Promise(resolve => { releaseSong = resolve; });
  await page.route(`**/yehry3/songs/${song.id}`, async route => {
    await songGate;
    await route.fulfill({ json: { song: { ...song, title: "Refreshed without storage" } } });
  });
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.route("**/assets/lyric-pronunciations.json", route => route.abort());
  await page.goto(`/lyrics/?song=${song.id}`);
  await choose(page, "ipa");
  await expect(page.locator("#lyric-view-note")).toContainText("missed rehearsal");
  await expect(first(page)).toHaveText("The night is young!");
  await page.unroute("**/assets/lyric-pronunciations.json");
  await choose(page, "ipa");
  await expect(first(page)).toHaveText("/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
  await choose(page, "diacritics");
  await expect(first(page)).toHaveText("Thë nïght ïs ÿöüng!");
  releaseSong();
  await expect(page.locator("h1")).toHaveText("Refreshed without storage");
  await expect(first(page)).toHaveText("Thë nïght ïs ÿöüng!");
});

test("a slow pronunciation load cannot overwrite a newer choice or a refreshed sheet", async ({ page }) => {
  await setup(page);
  let releaseDictionary, releaseSong;
  const dictionaryGate = new Promise(resolve => { releaseDictionary = resolve; });
  const songGate = new Promise(resolve => { releaseSong = resolve; });
  await page.route("**/assets/lyric-pronunciations.json", async route => { await dictionaryGate; await route.continue(); });
  await page.route(`**/yehry3/songs/${song.id}`, async route => {
    await songGate;
    await route.fulfill({ json: { song: { ...song, title: "Refreshed singing" } } });
  });
  await page.goto(`/lyrics/?song=${song.id}`);
  await choose(page, "ipa");
  await expect(page.locator("#lyric-view-note")).toContainText("Warming up");
  await choose(page, "diacritics");
  releaseSong();
  await expect(page.locator("h1")).toHaveText("Refreshed singing");
  releaseDictionary();
  await choose(page, "phonics");
  await expect(first(page)).toHaveText("dhuh nyte iz yuhng!");
  await expect(page.locator("#lyric-view")).toHaveCount(1);
});

test("format links override a recipient's preference and preserve the shared moment", async ({ page, browser }) => {
  await setup(page);
  await page.goto(`/lyrics/?song=${song.id}&t=6.4&view=ipa#lyric-line-2`);
  await expect(first(page)).toHaveText("/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(6.4, 1);
  await choose(page, "phonics");
  await expect(first(page)).toHaveText("dhuh nyte iz yuhng!");
  let url = new URL(page.url());
  expect(url.searchParams.get("song")).toBe(song.id);
  expect(url.searchParams.get("view")).toBe("phonics");
  expect(url.searchParams.get("t")).toBe("6.4");
  expect(url.hash).toBe("#lyric-line-2");
  await page.getByRole("button", { name: /Share this moment/ }).click();
  await choose(page, "ipa");
  await expect(first(page)).toHaveText("/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
  const link = await page.locator("#moment-link").inputValue();
  expect(new URL(link).searchParams.get("view")).toBe("ipa");
  const recipient = await browser.newPage();
  try {
    await setup(recipient);
    await recipient.addInitScript(() => localStorage.setItem("yehry3:lyric-view", "diacritics"));
    await recipient.goto(link);
    await expect(first(recipient)).toHaveText("/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
    expect(await recipient.locator("audio").evaluate(audio => audio.paused)).toBe(true);
    await choose(page, "original");
    await recipient.goto(page.url());
    await expect(first(recipient)).toHaveText("The night is young!");
    await choose(page, "ipa");
    await page.locator("#lyric-line-3").click();
    url = new URL(page.url());
    expect(url.searchParams.get("view")).toBe("ipa");
    expect(url.searchParams.has("t")).toBe(false);
    expect(url.hash).toBe("#lyric-line-3");
    await recipient.goto(`/lyrics/?song=${song.id}&view=unknown`);
    await expect(first(recipient)).toHaveText("The night is young!");
  } finally { await recipient.close(); }
});

test("the toolbar is one desktop row, wraps on phones, and its icon panels are keyboard accessible", async ({ page }) => {
  const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
  const pictured = catalog.songs.find(song => song.title === "Yeah After Midnight");
  expect(pictured).toBeTruthy();
  await setup(page, pictured);
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto(lyricsHref(pictured));
  const toolbar = page.locator(".lyric-toolbar");
  await expect(page.getByRole("combobox", { name: "Lyric view", exact: true })).toBeVisible();
  expect((await toolbar.boundingBox()).height).toBeLessThan(60);
  await page.getByRole("button", { name: "More song options", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  await expect(toolbar.getByRole("link", { name: /The collection/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Print", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "More song options", exact: true })).toBeFocused();
  await page.getByRole("button", { name: /Listener profile/ }).click();
  await expect(page.locator("#listener-profile")).toBeVisible();
  await page.getByRole("button", { name: "About this lyric view", exact: true }).click();
  await expect(page.locator("#listener-profile")).toBeHidden();
  await expect(page.locator("#lyric-view-note")).toBeVisible();
  await page.locator("h1").click();
  await expect(page.locator("#lyric-view-note")).toBeHidden();
  await page.screenshot({ path: "artifacts/lyrics-compact-desktop.png" });
  await choose(page, "ipa");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) expect((await toolbar.boundingBox()).height).toBeLessThan(108);
    await page.getByRole("button", { name: "More song options", exact: true }).click();
    await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `artifacts/lyrics-compact-${width}.png` });
  }
});
