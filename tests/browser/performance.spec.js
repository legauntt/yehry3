import { test, expect } from "@playwright/test";
const song = { id: "performance-song", title: "Saved performance song", duration: 240, collection: "distonyc", url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", lyrics: { text: "First line\nSecond line", kind: "written", cues: [{ line: 0, start: 1, end: 3 }, { line: 1, start: 4, end: 6 }] }, originalPrompt: { idea: "The saved idea", direction: "Acoustic", keep: "Warm vocals", basisSongs: [], voiceModel: "v7" }, songPlan: { version: 1, title: "Saved plan", recipe: "new", style: "rock", duration: 240, bpm: 100, keyscale: "D minor", arrangement: "Piano", lyrics: "Saved planned words" } };

test("saved prompt renders before a stalled API, then refreshes without closing details", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.route(`**/yehry3/songs/${song.id}`, async route => { await gate; await route.fulfill({ json: { song: { ...song, title: "Fresh title", originalPrompt: { ...song.originalPrompt, references: [], lyricSheet: null } } } }); });
  await page.goto(`/original-prompt/?song=${song.id}`);
  await expect(page.locator("h1")).toHaveText(song.title, { timeout: 2500 });
  await page.locator(".plan-lyrics summary").click();
  release();
  await expect(page.locator("h1")).toHaveText("Fresh title");
  await expect(page.locator(".plan-lyrics")).toHaveAttribute("open", "");
  expect(requests.filter(url => /\/yehry3\/songs$|\/catalog\.json$/.test(url))).toEqual([]);
  // A deployment's older static snapshot must not overwrite newer cached data.
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.route(`**/yehry3/songs/${song.id}`, () => {});
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Fresh title", { timeout: 2500 });
});

test("lyric refresh preserves the playing audio element and current position", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.route(`**/yehry3/songs/${song.id}`, async route => { await gate; await route.fulfill({ json: { song: { ...song, title: "Fresh lyric title" } } }); });
  await page.goto(`/lyrics/?song=${song.id}`);
  await expect(page.locator("h1")).toHaveText(song.title);
  await page.locator("#sheet-play").click();
  await page.locator("audio").evaluate(async audio => { window.playingAudio = audio; await audio.play(); audio.currentTime = 5; });
  release();
  await expect(page.locator("h1")).toHaveText("Fresh lyric title");
  const playback = await page.locator("audio").evaluate(audio => ({ same: window.playingAudio === audio, paused: audio.paused, time: audio.currentTime }));
  expect(playback.same).toBe(true);
  expect(playback.paused).toBe(false);
  expect(playback.time).toBeGreaterThanOrEqual(5);
});

test("unavailable browser storage still uses the independent per-song static fallback", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.route(`**/yehry3/songs/${song.id}`, () => {});
  await page.goto(`/original-prompt/?song=${song.id}`);
  await expect(page.locator("h1")).toHaveText(song.title, { timeout: 2500 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("new queued details load from the single API without a published static file", async ({ page }) => {
  const id = `distonyc-${"c".repeat(24)}`;
  await page.route(`**/yehry3/songs/${id}`, route => route.fulfill({ json: { song: { id, idea: "New request", status: "queued", originalPrompt: song.originalPrompt } } }));
  await page.goto(`/original-prompt/?song=${id}`);
  await expect(page.locator("h1")).toHaveText("New request");
  await expect(page.locator("#song-plan")).toContainText("after planning finishes");
});

test("catalog refresh is compact and hidden tabs do not poll songs", async ({ page }) => {
  await page.clock.install();
  let count = 0;
  const heavyRequests = [];
  page.on("request", request => { if (/\/yehry3\/songs$|\/catalog\.json$/.test(request.url())) heavyRequests.push(request.url()); });
  page.on("response", response => { if (response.url().endsWith("/songs/summary")) count++; });
  await page.goto("/");
  await expect.poll(() => count).toBe(1);
  const data = await page.evaluate(async () => {
    const api = await import("/assets/api.js");
    return api.api("/songs/summary");
  });
  expect(data.songs.length).toBeGreaterThan(50);
  expect(data.songs.every(item => !item.lyrics && !item.songPlan && !item.originalPrompt)).toBe(true);
  const before = count;
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await page.clock.fastForward(60001);
  expect(count).toBe(before);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => count).toBe(before + 1);
  expect(heavyRequests).toEqual([]);
});

test("Fear and Hunger keeps prompt and lyric links with compact metadata", async ({ page }) => {
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [{ ...song, collection: "fearhunger", lyrics: undefined, originalPrompt: undefined, songPlan: undefined, hasLyrics: true, hasOriginalPrompt: true, hasSongPlan: true }], nextVoteAt: null } }));
  await page.goto("/fearhunger/");
  const card = page.locator('.track[data-song-id="performance-song"]');
  await expect(card.locator('.original-prompt-link')).toBeVisible();
  await expect(card.locator('.original-prompt-link')).toHaveAttribute("href", "/original-prompt/?song=performance-song");
  await expect(card.locator('.lyrics-link')).toBeVisible();
});
