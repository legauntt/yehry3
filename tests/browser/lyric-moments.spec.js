import { test, expect } from "@playwright/test";
const song = { id: "moment-song", title: "A moment in the song", duration: 180, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  lyrics: { kind: "written", text: "First line\nSecond line\nLast line", cues: [{ line: 0, start: 1, end: 3 }, { line: 1, start: 4, end: 8 }, { line: 2, start: 9, end: 13 }] } };
async function setup(page, next = song) {
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: next }));
  await page.route(`**/yehry3/songs/${song.id}`, route => route.fulfill({ json: { song: next } }));
  await page.route("**/yehry3/profiles**", route => route.fulfill({ json: { profiles: [] } }));
}
test("share the exact playback moment with its lyric line and restore paused", async ({ page, context }) => {
  await setup(page); await page.goto(`/lyrics/?song=${song.id}#lyric-line-2`);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(4);
  await page.locator("audio").evaluate(audio => { audio.currentTime = 6.4; });
  await page.getByRole("button", { name: /Share this moment/ }).click();
  const link = await page.locator("#moment-link").inputValue();
  expect(new URL(link).searchParams.get("t")).toBe("6.4");
  expect(new URL(link).hash).toBe("#lyric-line-2");
  const recipient = await context.newPage(); await setup(recipient); await recipient.goto(link);
  await expect.poll(() => recipient.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(6.4, 1);
  expect(await recipient.locator("audio").evaluate(audio => audio.paused)).toBe(true);
  await recipient.locator("#lyric-line-3").click();
  expect(new URL(recipient.url()).searchParams.has("t")).toBe(false);
  await expect.poll(() => recipient.locator("audio").evaluate(audio => audio.currentTime)).toBe(9);
  await recipient.getByRole("button", { name: /Share this moment/ }).click();
  await recipient.locator("#lyric-line-2").click();
  await expect(recipient.locator(".lyric-line.is-linked")).toHaveCount(1);
  await expect(recipient.locator("#lyric-line-2")).toHaveClass(/is-linked/);
  await recipient.locator("#lyric-line-3").click();
  await recipient.reload();
  await expect.poll(() => recipient.locator("audio").evaluate(audio => audio.currentTime)).toBe(9);
  await recipient.close();
});
test("timestamp sharing works without lyric cues and fits mobile", async ({ page }) => {
  await setup(page, { ...song, lyrics: { ...song.lyrics, cues: [] } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/lyrics/?song=${song.id}&t=12.5`);
  await expect(page.locator('.karaoke-note')).toContainText('Line timing is unavailable');
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBeCloseTo(12.5, 1);
  await page.getByRole("button", { name: /Share this moment/ }).click();
  await expect(page.locator("#moment-link")).toHaveValue(/t=12.5$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/lyric-moment-mobile.png", fullPage: true });
});

test("unsupported lines stay readable while supported lines still seek", async ({ page }) => {
  await setup(page, { ...song, lyrics: { ...song.lyrics, cues: [song.lyrics.cues[0], song.lyrics.cues[2]] } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/lyrics/?song=${song.id}#lyric-line-3`);
  await expect(page.locator(".lyrics-text")).toContainText("Second line");
  await expect(page.locator("button.lyric-line")).toHaveCount(2);
  await expect(page.locator('.karaoke-note')).toContainText('Select a timed lyric');
  await expect(page.locator("#lyric-line-2")).toHaveCount(0);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(9);
  await page.locator("#lyric-line-1").click();
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(1);
});
test("background refresh preserves the playing audio and does not reapply a shared timestamp", async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await setup(page);
  await page.route(`**/yehry3/songs/${song.id}`, async route => { await gate; await route.fulfill({ json: { song: { ...song, title: "Refreshed title" } } }); });
  await page.goto(`/lyrics/?song=${song.id}&t=4#lyric-line-2`);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(4);
  await page.locator("audio").evaluate(async audio => { window.momentAudio = audio; await audio.play(); audio.currentTime = 10; });
  release();
  await expect(page.locator("h1")).toHaveText("Refreshed title");
  expect(await page.locator("audio").evaluate(audio => audio === window.momentAudio && !audio.paused && audio.currentTime >= 10)).toBe(true);
  await expect(page.locator("#share-moment")).toHaveCount(1);
});
test("invalid timestamps preserve old line links and large timestamps stay inside the recording", async ({ page }) => {
  await setup(page);
  await page.goto(`/lyrics/?song=${song.id}&t=-10#lyric-line-2`);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.currentTime)).toBe(4);
  await page.goto(`/lyrics/?song=${song.id}&t=80000`);
  await expect.poll(() => page.locator("audio").evaluate(audio => audio.readyState > 0 && audio.currentTime <= audio.duration && audio.currentTime > 0)).toBe(true);
  expect(await page.locator("audio").evaluate(audio => audio.paused)).toBe(true);
});
