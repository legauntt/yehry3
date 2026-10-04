import { test, expect } from "@playwright/test";
import pageOneSongs from "./fixtures/song-video-page1.json" with { type: "json" };
import { videoVersions } from "../../assets/song-video-versions.js";

const songs = pageOneSongs.map(s => ({ ...s, collection: "distonyc", url: "/fixture.mp3", duration: 180, votes: 1, adminPinned: true, feedback: {} }));
test.beforeEach(async ({ page }) => {
  // A real, quiet PCM stream makes audio continuity observable without external media.
  const wav = Buffer.alloc(44 + 8000 * 2 * 180);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.route("**/fixture.mp3", r => r.fulfill({ contentType: "audio/wav", body: wav }));
  await page.route("**/yehry3/{catalog,songs/summary}", r => r.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", r => r.fulfill({ json: { songs } }));
  await page.route("**/yehry3/queue?*", r => r.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
});
const card = page => page.locator(`[data-id="${songs[0].id}"]`);

test("Play starts the picture while sound loads and volume reaches both endpoints", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const song = songs.find(s => s.videoAudio);
  const choice = videoVersions(song.id).at(-1);
  await page.addInitScript(() => {
    window.loopSources = [];
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this); window.loopSources.push(node); return node;
    };
  });
  await page.route(`**${choice.loopAudio}`, async route => { await gate; await route.continue(); });
  await page.goto("/");
  await page.locator(`[data-video-open="${song.id}"]`).click();
  const dialog = page.locator(".song-video-viewer");
  const video = dialog.locator("video");
  await dialog.locator("[data-video-play]").click();
  try {
    await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
    await expect(dialog.locator(".song-video-status")).toHaveText("Loading sound…");
    expect(await page.evaluate(() => window.loopSources.length)).toBe(0);
  } finally { release(); }
  await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(1);
  await expect(dialog.locator(".song-video-status")).toBeEmpty();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const slider = dialog.getByRole("slider", { name: "Video volume" });
    await slider.scrollIntoViewIfNeeded();
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    await expect(slider).toHaveValue("0");
    await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    await expect(slider).toHaveValue("1");
    expect(await video.evaluate(v => v.volume)).toBe(1);
    await slider.focus(); await page.keyboard.press("Home");
    await expect(slider).toHaveValue("0");
    await page.keyboard.press("End");
    await expect(slider).toHaveValue("1");
  }
  // Native controls must update the custom slider too.
  await video.evaluate(v => { v.volume = .4; v.muted = true; });
  await expect(dialog.getByRole("slider", { name: "Video volume" })).toHaveValue("0.4");
  await expect(dialog.getByLabel("Sound on", { exact: true })).not.toBeChecked();
  await page.screenshot({ path: "test-results/video-volume-phone.png" });
});

test("failed loop sound retries on Play and closing during loading leaves audio stopped", async ({ page }) => {
  const song = songs.find(s => s.videoAudio);
  const choice = videoVersions(song.id).at(-1);
  let attempts = 0;
  await page.route(`**${choice.loopAudio}`, route => ++attempts === 1 ? route.abort() : route.continue());
  await page.goto("/");
  await page.locator(`[data-video-open="${song.id}"]`).click();
  const dialog = page.locator(".song-video-viewer");
  await expect(dialog.locator(".song-video-status")).toContainText("audio could not load");
  await dialog.locator("[data-video-play]").click();
  await expect.poll(() => dialog.locator("video").evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
  await expect(dialog.locator(".song-video-status")).toBeEmpty();
  expect(attempts).toBe(2);
  await page.keyboard.press("Escape");

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**${choice.loopAudio}`, async route => { await gate; await route.continue(); });
  await page.locator(`[data-video-open="${song.id}"]`).click();
  await dialog.locator("[data-video-play]").click();
  await expect(dialog.locator(".song-video-status")).toHaveText("Loading sound…");
  await page.keyboard.press("Escape");
  release();
  await expect(dialog).not.toBeVisible();
  // The native dialog close event releases media on a subsequent event turn.
  await expect.poll(() => dialog.locator("video").evaluate(v => v.paused)).toBe(true);
});

test("sound video waits for Play, pauses the shared song and loops on a phone", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.loopSources = [];
    window.loopGains = [];
    const gain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this);
      node.meter = this.createAnalyser(); node.connect(node.meter);
      window.loopGains.push(node); return node;
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      window.loopSources.push(source);
      return source;
    };
  });
  const song = songs.find(s => s.videoAudio);
  await page.goto("/");
  await card(page).locator("[data-play]").click();
  const audio = page.locator("#audio");
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`[data-video-open="${song.id}"]`).click();
  const dialog = page.getByRole("dialog", { name: song.title, exact: true });
  const video = dialog.locator("video");
  await expect.poll(() => video.evaluate(v => v.readyState >= 1 && v.paused && !v.muted && v.currentTime === 0)).toBe(true);
  const position = await audio.evaluate(a => a.currentTime);
  await page.waitForTimeout(500);
  expect(await audio.evaluate(a => a.paused)).toBe(true);
  expect(await audio.evaluate(a => a.currentTime)).toBe(position);
  expect(await video.evaluate(v => v.currentTime)).toBe(0);
  const bounds = await dialog.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/morning-doomer-phone-play.png" });
  await dialog.getByRole("button", { name: "Play video with sound", exact: true }).click();
  await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && !v.muted)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(1);
  expect(await page.evaluate(() => window.loopSources[0].context.state)).toBe("running");
  const soundLevel = () => page.evaluate(() => {
    const samples = new Float32Array(2048);
    window.loopGains[0].meter.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  });
  await expect.poll(soundLevel).toBeGreaterThan(.01);
  // A real complete cycle verifies the audio node survives the native video seek.
  await expect.poll(() => video.evaluate(v => v.currentTime > 22), { timeout: 30000 }).toBe(true);
  await expect.poll(() => video.evaluate(v => !v.paused && !v.ended && v.currentTime < 2)).toBe(true);
  expect(await page.evaluate(() => window.loopSources.length)).toBe(1);
  expect(await page.evaluate(() => window.loopSources[0].loop)).toBe(true);
  await expect.poll(soundLevel).toBeGreaterThan(.01);
  await video.evaluate(v => { v.pause(); });
  await expect(dialog.getByRole("button", { name: "Play video with sound", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Play video with sound", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(2);
  await video.evaluate(v => { v.currentTime = 10; });
  await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(3);
  await video.evaluate(v => { v.currentTime = 0; v.dispatchEvent(new PointerEvent("pointerup")); });
  await expect.poll(() => page.evaluate(() => window.loopSources.length)).toBe(4);
  await dialog.getByLabel("Sound on", { exact: true }).uncheck();
  await expect.poll(() => page.evaluate(() => window.loopGains[0].gain.value)).toBe(0);
  await dialog.getByLabel("Sound on", { exact: true }).check();
  await dialog.getByRole("slider", { name: "Video volume" }).fill("0.5");
  await expect.poll(() => page.evaluate(() => window.loopGains[0].gain.value)).toBe(.5);
  await page.keyboard.press("Escape");
  expect(await audio.evaluate((a, position) => a.paused && a.currentTime === position, position)).toBe(true);
});

test("returning home while Distonyc loads keeps the catalog and video controls", async ({ page }) => {
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { requested = resolve; });
  await page.route("**/yehry3/voice-models", async route => {
    requested();
    await gate;
    await route.fulfill({ json: { models: [] } });
  });
  await page.goto("/");
  await expect(card(page)).toBeVisible();
  await page.locator('header a[href="/distonyc/"]').click();
  await started;
  await page.locator('a[aria-label="yehry3 home"]').click();
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  release();
  await page.waitForTimeout(700);
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  await expect(page.locator("#password")).toHaveCount(0);
});

test("idle hover loads one silent square preview and stops on exit, scroll and refresh", async ({ page }) => {
  const requests = [];
  page.on("request", r => { if (/\/song-videos(?:-v1)?\//.test(r.url())) requests.push(r.url()); });
  await page.goto("/");
  await card(page).scrollIntoViewIfNeeded();
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
  expect(requests).toHaveLength(0);
  const box = await card(page).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(0);
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.waitForTimeout(1200);
  expect(requests).toHaveLength(0);
  const video = card(page).locator(".song-video-preview");
  await expect(video).toBeVisible({ timeout: 12000 });
  await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
  expect(await video.evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }))).toEqual({ width: songs[0].videoWidth || 576, height: songs[0].videoHeight || 1024, duration: songs[0].videoDuration || 15 });
  const frame = await video.boundingBox();
  expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
  await page.screenshot({ path: "test-results/song-video-grid.png" });
  await page.mouse.move(5, 5);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await card(page).hover();
  await expect(video).toBeVisible({ timeout: 12000 });
  await page.mouse.wheel(0, 80);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await card(page).hover();
  await expect(video).toBeVisible({ timeout: 12000 });
  // A catalog update replaces this card's inner content while the pointer stays still.
  await card(page).evaluate(row => {
    const fresh = row.cloneNode(true);
    fresh.querySelector("video")?.remove();
    row.replaceChildren(...fresh.childNodes);
  });
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
});

test("failed preview keeps the cover usable and page navigation releases the viewer", async ({ page }) => {
  await page.route(/\/song-videos(?:-v1)?\/[^/]+\.mp4/, r => r.abort());
  await page.goto("/");
  await card(page).hover();
  await page.waitForTimeout(2600);
  await expect(card(page).locator(".is-video-playing")).toHaveCount(0);
  await expect(card(page).locator("img.track-art")).toBeVisible();
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-status")).toContainText("could not load");
  await page.keyboard.press("Escape");
  await page.locator('header a[href="/distonyc/"]').click();
  await expect(page.locator(".song-video-viewer")).toHaveCount(0);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await page.locator('a[aria-label="yehry3 home"]').click();
  await expect(page.locator(".song-video-viewer")).toHaveCount(1);
  await expect(card(page).locator("[data-video-open]")).toBeVisible();
});

test("video modal supports keyboard and pauses songs only for sound clips", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("/");
  await expect(page.locator("[data-video-open]")).toHaveCount(24);
  await card(page).locator("[data-play]").click();
  await expect.poll(() => page.locator("audio").evaluateAll(items => items.some(a => !a.paused && a.currentTime > 0))).toBe(true);
  const before = await page.locator("audio").evaluateAll(items => items.find(a => !a.paused).currentTime);
  for (const song of songs) {
    const trigger = page.locator(`[data-video-open="${song.id}"]`);
    await expect(trigger).toHaveAttribute("title", `Watch ${song.videoDuration || 15}-second video`);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: song.title, exact: true });
    await expect(dialog).toBeVisible();
    const video = dialog.locator("video");
    if (song.videoAudio) {
      await expect.poll(() => video.evaluate(v => v.readyState >= 1 && v.paused && !v.muted && v.currentTime === 0)).toBe(true);
      expect(await page.locator("audio").evaluateAll(items => items.every(a => a.paused))).toBe(true);
      await dialog.getByRole("button", { name: "Play video with sound", exact: true }).click();
    }
    await expect.poll(() => video.evaluate((v, sound) => !v.paused && v.currentTime > 0 && v.muted === !sound, Boolean(song.videoAudio))).toBe(true);
    const dimensions = await video.evaluate(v => [v.videoWidth, v.videoHeight, v.duration]);
    expect(dimensions.slice(0, 2)).toEqual([song.videoWidth || 576, song.videoHeight || 1024]);
    expect(dimensions[2]).toBeCloseTo(song.videoDuration || 15, 2);
    await expect(dialog.locator("[data-video-description]")).toHaveText(song.videoAudio
      ? `${song.videoDuration}-second video with chorus audio · Press Play to watch with sound`
      : `${song.videoDuration || 15}-second silent video`);
    if (song.videoAudio) {
      await expect(trigger).toHaveClass(/song-video-button-doomer/);
      await expect(trigger).toHaveAttribute("aria-label", `Watch video with chorus audio for ${song.title}`);
      await expect(dialog.getByLabel("Sound on", { exact: true })).toBeChecked();
      await page.screenshot({ path: "test-results/morning-doomer-video.png" });
    }
    if (song.videoWidth === song.videoHeight) {
      const frame = await video.boundingBox();
      expect(Math.abs(frame.width - frame.height)).toBeLessThan(2);
    }
    expect(await page.locator("audio").evaluateAll(items => items.some(a => !a.paused))).toBe(!song.videoAudio);
    if (song === songs[0]) {
      const choices = videoVersions(song.id);
      await expect(dialog.locator(".song-video-versions button")).toHaveText(choices.map(choice => choice.label));
      await expect(dialog.locator(".is-current-version")).toHaveCount(1);
      await expect(dialog.locator(".is-current-version")).toHaveText(choices.at(-1).label);
      const old = dialog.getByRole("button", { name: "Version A", exact: true });
      await old.focus();
      await page.keyboard.press("Enter");
      await expect(old).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.locator(".is-current-version")).toHaveText(choices.at(-1).label);
      await expect(video).toHaveAttribute("src", choices[0].src);
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
      await dialog.getByRole("button", { name: `Version ${choices.at(-1).label} (latest)`, exact: true }).click();
      await expect(video).toHaveAttribute("src", choices.at(-1).src);
      await expect.poll(() => video.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
      expect(await page.locator("audio").evaluateAll(items => items.some(a => !a.paused))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator(".song-video-viewer video")).not.toHaveAttribute("src", /.+/);
  }
  await card(page).locator("[data-cover-open]").click();
  await expect(page.locator(".cover-viewer")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.locator("#audio").evaluate(a => a.currentTime)).toBeGreaterThan(before);
  expect(await page.locator("#audio").evaluate(a => a.paused)).toBe(true);
});

test("reduced motion suppresses autoplay; phone and list keep a usable modal button", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await card(page).hover();
  await page.waitForTimeout(2300);
  await expect(page.locator(".song-video-preview")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-viewer")).toBeVisible();
  await page.getByRole("button", { name: "Version A", exact: true }).click();
  await expect.poll(() => page.locator(".song-video-viewer video").evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page.locator(".song-video-viewer").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Close video", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await card(page).locator("[data-video-open]").click();
  await expect(page.locator(".song-video-viewer")).toBeVisible();
  await expect.poll(() => page.locator(".song-video-viewer video").evaluate(v => v.currentTime > 0)).toBe(true);
  await page.screenshot({ path: "test-results/song-video-phone.png" });
});

test("every preserved version plays and rapid switching recovers from a failed version", async ({ page }) => {
  test.setTimeout(240000);
  await page.goto("/");
  for (const song of songs) {
    await page.locator(`[data-video-open="${song.id}"]`).click();
    const dialog = page.locator(".song-video-viewer");
    for (const choice of videoVersions(song.id).slice(0, -1)) {
      await dialog.getByRole("button", { name: `Version ${choice.label}`, exact: true }).click();
      await expect(dialog.locator("video")).toHaveAttribute("src", choice.src);
      if (choice.audio) await dialog.getByRole("button", { name: "Play video with sound", exact: true }).click();
      await expect.poll(() => dialog.locator("video").evaluate((v, sound) => !v.paused && v.currentTime > 0 && v.muted === !sound, Boolean(choice.audio)), { timeout: 20000 }).toBe(true);
    }
    await page.keyboard.press("Escape");
  }
  const choices = videoVersions(songs[0].id);
  await page.route(choices[0].src, route => route.abort());
  await card(page).locator("[data-video-open]").click();
  const dialog = page.locator(".song-video-viewer");
  await dialog.getByRole("button", { name: "Version A", exact: true }).click();
  await expect(dialog.locator(".song-video-status")).toContainText("could not load");
  await dialog.getByRole("button", { name: `Version ${choices.at(-1).label} (latest)`, exact: true }).click();
  await expect.poll(() => dialog.locator("video").evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
  await expect(dialog.locator(".song-video-status")).toBeEmpty();
  await dialog.locator(".song-video-versions").evaluate(group => {
    const buttons = group.querySelectorAll("button");
    buttons[0].click();
    buttons[buttons.length - 1].click();
    buttons[0].click();
    buttons[buttons.length - 1].click();
  });
  await expect.poll(() => dialog.locator("video").evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
  await expect(dialog.locator(".song-video-status")).toBeEmpty();
});
