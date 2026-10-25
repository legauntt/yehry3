import { test, expect } from "@playwright/test";

const songs = ["one", "two"].map(id => ({
  id, title: `Song ${id}`, url: `/${id}.wav`, duration: 20, collection: "tonyai",
}));
const clips = songs.map(song => ({ ...song,
  lines: [[2, 4, `${song.id} first words`], [8, 10, `${song.id} later words`]],
  moments: [[0, 0], [1, 1]],
}));
const silence = (seconds = 20) => {
  const data = Buffer.alloc(8000 * seconds, 128), head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28); head.writeUInt16LE(1, 32);
  head.writeUInt16LE(8, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
};

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/catalog/state", route => route.fulfill({ json: { feedback: {} } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips } }));
  await page.route(/\/(one|two)\.wav$/, route => {
    const body = silence();
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: "audio/wav",
      headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${body.length}` } : {}) },
      body: body.subarray(start, end + 1) });
  });
  await page.addInitScript(() => {
    window.__clips = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.isConnected) window.__clips.push(this);
      return play.call(this);
    };
    Math.random = () => 0.5;
  });
});

test("a cold preview click samples only its song and preserves the main player's position", async ({ page }) => {
  // Missing cue metadata must never fall back to either fixed gag.
  await page.route("**/egg-clips.json", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Play Song two", exact: true }).click();
  await expect.poll(() => page.locator("#audio").evaluate(audio => !audio.paused)).toBe(true);
  await page.locator("#audio").evaluate(audio => { audio.currentTime = 12; });
  const art = page.locator('[data-id="one"] .track-art');
  const preview = page.getByRole("button", { name: "Play a random clip from Song one", exact: true });
  await preview.click();
  await expect(preview).toHaveClass(/is-playing/);
  await expect(art).toHaveClass(/egg-shock/);
  const heard = await page.evaluate(() => {
    const clip = window.__clips.at(-1), main = document.querySelector("#audio");
    return { sources: window.__clips.map(audio => new URL(audio.src).pathname), time: clip.currentTime,
      playing: !clip.paused, mainPaused: main.paused, position: main.currentTime };
  });
  expect(heard.sources).toEqual(["/one.wav"]);
  expect(heard.time).toBeGreaterThanOrEqual(6);
  expect(heard.time).toBeLessThan(8);
  expect(heard.playing).toBe(true);
  expect(heard.mainPaused).toBe(true);
  expect(heard.position).toBeGreaterThanOrEqual(12);
  await page.locator("#audio").evaluate(audio => audio.play());
  await expect(art).not.toHaveClass(/egg-shock/);
  await expect(preview).not.toHaveClass(/is-playing/);
  await expect.poll(() => page.evaluate(() => window.__clips.at(-1).paused)).toBe(true);
  expect(await page.locator("#audio").evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(heard.position);
});

test("keyboard previews follow their own sung lines and stop at the slice boundary", async ({ page }) => {
  await page.goto("/");
  const art = page.locator('[data-id="one"] .track-art');
  const preview = page.getByRole("button", { name: "Play a random clip from Song one", exact: true });
  const loaded = page.waitForResponse("**/egg-clips.json");
  await preview.focus();
  await loaded;
  await preview.press("Enter");
  await expect(page.locator(".egg-caption-title")).toHaveText("♪ Song one");
  await expect(page.locator(".egg-caption-words")).toHaveText("one later words");
  await expect.poll(() => page.evaluate(() => window.__clips.at(-1).currentTime)).toBeGreaterThanOrEqual(8);
  await expect(art).not.toHaveClass(/egg-shock/, { timeout: 5000 });
  await expect(page.locator(".egg-caption")).toHaveCount(0);
  expect(await page.evaluate(() => window.__clips.at(-1).paused)).toBe(true);
  await page.evaluate(() => { Math.random = () => 0; });
  await preview.press("Space");
  await expect(page.locator(".egg-caption-words")).toHaveText("one first words");
  expect(await page.evaluate(() => window.__clips.map(audio => new URL(audio.src).pathname))).toEqual(["/one.wav", "/one.wav"]);
});

test("clicking a saved cover opens its viewer without sampling audio", async ({ page }) => {
  const song = { ...songs[0], id: "distonyc-06d2b8c3c8dffed19df347bb" };
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs: [song] } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [song] } }));
  await page.goto("/");
  const art = page.locator(`[data-id="${song.id}"] img.track-art`);
  await expect(art).toHaveAttribute("srcset", /webp/);
  await expect(page.locator(".cover-enlarge")).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await art.click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".cover-viewer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".cover-viewer")).not.toBeVisible();
  }
  expect(await page.evaluate(() => window.__clips.length)).toBe(0);
  await expect(art).not.toHaveClass(/egg-shock/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "List", exact: true }).click();
  const preview = page.getByRole("button", { name: "Play a random clip from Song one", exact: true });
  const loaded = page.waitForResponse("**/egg-clips.json");
  await preview.focus();
  await loaded;
  await preview.click();
  await expect(art).toHaveClass(/egg-shock/);
  await expect(page.locator(".cover-viewer")).not.toBeVisible();
  expect(await page.evaluate(() => window.__clips.map(audio => new URL(audio.src).pathname))).toEqual(["/one.wav"]);
  await page.screenshot({ path: "artifacts/song-preview-mobile.png" });
});

test("the record samples random songs without repeated picks or idle lyric popups on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("yehry3:record-lyric-captions", "true");
    localStorage.setItem("yehry3:record-lyric-audio", "true");
    window.__spoken = [];
    speechSynthesis.speak = utterance => window.__spoken.push(utterance.text);
  });
  await page.goto("/");
  const record = page.locator(".record");
  await record.dispatchEvent("recordidle");
  await record.click({ force: true });
  expect(await page.evaluate(() => window.__clips.length)).toBe(0);
  await page.waitForTimeout(1100);
  // A cover tap does not count towards the record's triple-click.
  await page.locator('[data-id="one"] .track-art').click();
  await record.click({ force: true, clickCount: 2 });
  expect(await page.evaluate(() => window.__clips.length)).toBe(0);
  await record.click({ force: true });
  await expect(page.locator(".egg-caption-title")).toHaveText("♪ Song two");
  const box = await page.locator(".egg-caption").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const color = await record.evaluate(element => getComputedStyle(element).filter);
  await expect.poll(() => record.evaluate(element => getComputedStyle(element).filter)).not.toBe(color);
  // The record keeps spinning, but its lyric bubble must not chase the rotating bounds.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(120);
    const nextBox = await page.locator(".egg-caption").boundingBox();
    expect(nextBox.x).toBeCloseTo(box.x, 0);
    expect(nextBox.y).toBeCloseTo(box.y, 0);
    expect(await page.locator(".egg-caption, .egg-caption-words").evaluateAll(elements =>
      elements.every(element => element.getAnimations().length === 0))).toBe(true);
  }
  await page.screenshot({ path: "artifacts/record-clip-mobile.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await record.click({ force: true, clickCount: 3 });
  await expect(page.locator(".egg-caption-title")).toHaveText("♪ Song one");
  await expect(record).toHaveCSS("animation-name", "none");
  await expect(record).not.toHaveCSS("filter", "none");
  expect(await page.evaluate(() => window.__clips.map(audio => new URL(audio.src).pathname))).toEqual(["/two.wav", "/one.wav"]);
  await expect(page.locator(".egg-caption")).toHaveCount(0, { timeout: 5000 });
  await expect(record).not.toHaveClass(/egg-shock/);
  await expect(record).toHaveCSS("filter", "none");
  await page.clock.install();
  await page.clock.runFor(60000);
  await expect(page.locator(".record-lyric, .egg-caption")).toHaveCount(0);
  expect(await page.evaluate(() => window.__spoken)).toEqual([]);
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(page.getByRole("checkbox", { name: /Lyric captions|Lyric audio/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /lyric/i })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Continuous record spins" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("unknown durations use real metadata and clicks outside the triple-click window stay silent", async ({ page }) => {
  const unknown = { ...songs[0], duration: undefined };
  await page.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs: [unknown] } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [unknown] } }));
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips: [] } }));
  await page.goto("/");
  const art = page.locator('[data-id="one"] .track-art');
  await art.click();
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 2 });
  expect(await page.evaluate(() => window.__clips.length)).toBe(0);
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  await expect(art).toHaveClass(/egg-shock/);
  const time = await page.evaluate(() => window.__clips.at(-1).currentTime);
  expect(time).toBeGreaterThanOrEqual(6);
  expect(time).toBeLessThan(8);
});

test("slow seeks and buffering keep the caption and picture with the sound", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true, get() { return this.__time || 0; }, set(value) { this.__pending = value; },
    });
    HTMLMediaElement.prototype.play = function () {
      window.__sung = this;
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
  });
  await page.goto("/");
  const art = page.locator('[data-id="one"] .track-art');
  const loaded = page.waitForResponse("**/egg-clips.json");
  await art.click();
  await loaded;
  await art.click({ clickCount: 2 });
  await expect(art).toHaveClass(/egg-loading/);
  await expect(art).not.toHaveClass(/egg-shock/);
  await expect(page.locator(".egg-caption")).toHaveCount(0);
  await page.evaluate(() => { window.__sung.__time = 8.05; window.__sung.dispatchEvent(new Event("timeupdate")); });
  await expect(page.locator(".egg-caption-words")).toHaveText("one later words");
  await page.evaluate(() => window.__sung.dispatchEvent(new Event("waiting")));
  await expect(art).toHaveClass(/egg-stalled/);
  await page.evaluate(() => window.__sung.dispatchEvent(new Event("playing")));
  await expect(art).not.toHaveClass(/egg-stalled/);
});
