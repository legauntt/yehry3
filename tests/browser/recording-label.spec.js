import { test, expect } from "@playwright/test";
test.use({ timezoneId: "Asia/Tokyo" });

const first = {
  id: "distonyc-f47a3eb436748f0b2e3d6ccf", title: "9-11'd Again",
  publishedAt: "2026-09-13T23:32:46Z", collection: "distonyc",
  duration: 180, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", votes: 0,
};
const second = {
  ...first, id: "distonyc-27549fcecb0991a55825d859", title: "9-11’d Again",
  publishedAt: "2026-09-15T19:44:59Z", collection: "fearhunger", votes: 5,
};
const label = (page, id) => page.locator(`.track[data-id="${id}"] .recording-label`);
async function catalog(page, readSongs) {
  // Keep every API operation local, including any listening events.
  await page.route("**/yehry3/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs: readSongs() } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs: readSongs(), nextVoteAt: null } }));
}

test("duplicate labels survive pagination, sorting, collection filters and the offline catalog", async ({ page }) => {
  // Aliases are shared across browsers; the hover detail retains Pacific time.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const songs = [first, ...Array.from({ length: 25 }, (_, index) => ({
    ...first, id: `unique-${index}`, title: `Unique song ${index}`,
  })), second];
  await catalog(page, () => songs);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track")).toHaveCount(24);
  await expect(label(page, first.id)).toHaveText("pop-duck");
  await expect(label(page, first.id)).toHaveAttribute("title", "Recording pop-duck · Released Sep 13, 2026 · 4:32 PM PDT");
  await expect(page.locator(".track .recording-label")).toHaveCount(1);
  await page.locator('[data-catalog-page="1"]').first().click();
  await expect(label(page, second.id)).toHaveText("lunar-duck");
  await page.locator(".catalog-filters > summary").click();
  await page.locator("#sort").selectOption("votes");
  await expect(page.locator(".track").first()).toHaveAttribute("data-id", second.id);
  await expect(label(page, first.id)).toHaveText("pop-duck");
  await page.locator("#collection-filter").selectOption("fearhunger");
  await expect(page.locator(".track")).toHaveCount(1);
  await expect(label(page, second.id)).toBeVisible();
  await page.route("**/yehry3/songs/summary", (route) => route.abort());
  await page.reload();
  await expect(page.locator("#vote-note")).toContainText("offline");
  await expect(label(page, second.id)).toHaveText("lunar-duck");
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", /Recording lunar-duck/);
});

test("a newly duplicated title labels the playing recording without interrupting playback or seeking", async ({ page }) => {
  let songs = [first];
  await catalog(page, () => songs);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track")).toHaveCount(1);
  await expect(page.locator(".recording-label")).toHaveCount(0);
  await page.locator(`[data-play="${first.id}"]`).click();
  await expect.poll(() => page.locator("#audio").evaluate((audio) => audio.paused)).toBe(false);
  await page.locator("#audio").evaluate((audio) => {
    window.recordingAudio = audio;
    window.recordingSource = audio.currentSrc;
    audio.currentTime = 12;
  });
  songs = [first, second];
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#now-recording .recording-label")).toHaveText("pop-duck");
  const playback = await page.locator("#audio").evaluate((audio) => ({
    same: audio === window.recordingAudio && audio.currentSrc === window.recordingSource,
    paused: audio.paused, time: audio.currentTime,
  }));
  expect(playback.same).toBe(true);
  expect(playback.paused).toBe(false);
  expect(playback.time).toBeGreaterThanOrEqual(12);
  await page.locator(`[data-play="${second.id}"]`).click();
  await expect(page.locator("#now-recording .recording-label")).toHaveText("lunar-duck");
  await expect(page.locator("#now-title")).toHaveText(second.title);
  await page.locator(".collection").screenshot({ path: "artifacts/recording-label-desktop.png" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(label(page, second.id)).toBeVisible();
    await page.screenshot({ path: `artifacts/recording-label-mobile-${width}.png`, fullPage: true });
  }
});

test("matching minutes and unknown dates retain distinct escaped recording identifiers", async ({ page }) => {
  const title = 'Same <img src=x onerror="window.unescaped=true"> title';
  const songs = [
    { ...first, title, id: "distonyc-abcdef100000000000000000", publishedAt: "2026-01-15T19:44:01Z" },
    { ...first, title, id: "distonyc-abcdef200000000000000000", publishedAt: "2026-01-15T19:44:59Z" },
    { ...first, title, id: "distonyc-123456100000000000000000", publishedAt: null },
    { ...first, title, id: "distonyc-123456200000000000000000", publishedAt: "invalid" },
  ];
  await catalog(page, () => songs);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track .recording-label")).toHaveCount(4);
  await expect(label(page, songs[0].id)).toHaveText("mossy-pika");
  await expect(label(page, songs[1].id)).toHaveText("calm-snail");
  await expect(label(page, songs[2].id)).toHaveText("hazy-lion");
  await expect(label(page, songs[3].id)).toHaveText("wavy-crow");
  await expect(label(page, songs[0].id)).toHaveAttribute("title", /Released Jan 15, 2026 · 11:44 AM PST/);
  await expect(label(page, songs[2].id)).toHaveAttribute("title", /Release time unavailable/);
  for (const text of await page.locator(".track .recording-label").allTextContents()) {
    expect(text).toMatch(/^[a-z]+-[a-z]+$/);
    expect(text.length).toBeLessThanOrEqual(10);
  }
  await expect(page.locator(".track-heading img")).toHaveCount(0);
  expect(await page.evaluate(() => window.unescaped)).toBeUndefined();
});

test("colliding word pairs stay distinct when catalog order and release dates change", async ({ page }) => {
  let songs = [
    { ...first, id: "collision-80", publishedAt: null },
    { ...first, id: "collision-52", publishedAt: null },
  ];
  await catalog(page, () => songs);
  await page.goto("/?sort=catalog");
  await expect(label(page, "collision-52")).toHaveText("lil-toad");
  await expect(label(page, "collision-80")).toHaveText("lil-tuna");
  songs = songs.toReversed().map(song => ({ ...song, publishedAt: first.publishedAt }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(label(page, "collision-52")).toHaveAttribute("title", /Released Sep 13, 2026/);
  await expect(label(page, "collision-52")).toHaveText("lil-toad");
  await expect(label(page, "collision-80")).toHaveText("lil-tuna");
  await page.reload();
  await expect(label(page, "collision-52")).toHaveText("lil-toad");
  await expect(label(page, "collision-80")).toHaveText("lil-tuna");
});
