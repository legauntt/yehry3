import { test, expect, chromium } from "@playwright/test";

const song = {
  id: "lyric-scroll-test", title: "A long lyric sheet", duration: 180,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  lyrics: {
    kind: "written",
    text: Array.from({ length: 80 }, (_, i) => `The night is young, line ${i + 1}`).join("\n"),
    cues: Array.from({ length: 80 }, (_, i) => ({ line: i, start: i * 2, end: i * 2 + 2 })),
  },
};
const resume = page => page.getByRole("button", { name: "Resume auto-scroll", exact: true });
async function setup(page, { delayedRefresh = false } = {}) {
  // Public reads are fixtures and all writes are intercepted, including live runs.
  await page.route("**/yehry3/**", route => route.fulfill({ json: { songs: [], profiles: [], listeners: [] } }));
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/yehry3/songs/${song.id}`, async route => {
    if (delayedRefresh) await gate;
    await route.fulfill({ json: { song: delayedRefresh ? { ...song, title: "Refreshed lyric sheet" } : song } });
  });
  await page.goto(`/lyrics/?song=${song.id}#lyric-line-31`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lyric-line-31")).toHaveClass(/is-active/);
  await page.locator("audio").evaluate(async audio => {
    window.keptAudio = audio;
    audio.muted = true;
    await audio.play();
  });
  await expect(resume(page)).toBeHidden();
  return release;
}
async function seek(page, line) {
  await page.locator("audio").evaluate((audio, time) => { audio.currentTime = time; }, (line - 1) * 2);
  await expect(page.locator(`#lyric-line-${line}`)).toHaveClass(/is-active/);
}
async function centered(page, line) {
  await expect.poll(() => page.locator(`#lyric-line-${line}`).evaluate(element => {
    const box = element.getBoundingClientRect();
    return Math.abs((box.top + box.bottom) / 2 - innerHeight / 2);
  })).toBeLessThan(6);
}
async function staysPut(page, position) {
  await expect.poll(() => page.evaluate(position => Math.abs(scrollY - position), position)).toBeLessThan(3);
  // Let media timeupdates and any incorrect smooth scroll finish.
  await page.waitForTimeout(700);
  expect(await page.evaluate(position => Math.abs(scrollY - position), position)).toBeLessThan(3);
}

for (const direction of [-1, 1]) {
  test(`wheel ${direction < 0 ? "up" : "down"} pauses following until resume without disturbing playback`, async ({ page }) => {
    await setup(page);
    await page.mouse.move(1000, 550);
    await page.mouse.wheel(0, direction * 650);
    await expect(resume(page)).toBeVisible();
    const position = await page.evaluate(() => scrollY);
    await seek(page, 50);
    await staysPut(page, position);
    if (direction > 0) await page.screenshot({ path: "artifacts/lyric-scroll-desktop.png" });
    const time = await page.locator("audio").evaluate(audio => audio.currentTime);
    await resume(page).click();
    await expect(resume(page)).toBeHidden();
    await centered(page, 50);
    expect(await page.locator("audio").evaluate((audio, time) =>
      audio === window.keptAudio && !audio.paused && audio.currentTime >= time && audio.currentTime < time + 3, time)).toBe(true);
    await seek(page, 65);
    await centered(page, 65);
    await expect(resume(page)).toBeHidden();
  });
}

test("keyboard scrolling from a lyric pauses; resume while paused does not start playback", async ({ page }) => {
  await setup(page);
  await page.locator("#lyric-line-31").focus();
  await page.keyboard.press("PageUp");
  await expect(resume(page)).toBeVisible();
  await page.locator("audio").evaluate(audio => audio.pause());
  await seek(page, 45);
  await resume(page).click();
  await centered(page, 45);
  expect(await page.locator("audio").evaluate(audio => audio.paused)).toBe(true);
});

test("scrollbar input pauses following", async () => {
  // Playwright normally hides native scrollbars in headless Chromium.
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    await setup(page);
    expect(await page.evaluate(() => document.documentElement.clientWidth < innerWidth)).toBe(true);
    await page.mouse.click(1435, 820);
    await expect(resume(page)).toBeVisible();
    await page.waitForTimeout(400);
    const position = await page.evaluate(() => scrollY);
    await seek(page, 50);
    await staysPut(page, position);
  } finally { await browser.close(); }
});

test("wheel input interrupts an in-progress automatic scroll", async ({ page }) => {
  await setup(page);
  await seek(page, 65);
  await page.mouse.move(1000, 550);
  await page.mouse.wheel(0, -650);
  await expect(resume(page)).toBeVisible();
  await page.waitForTimeout(400);
  const position = await page.evaluate(() => scrollY);
  await seek(page, 70);
  await staysPut(page, position);
});

test("automatic centering and horizontal scrolling keep following; small vertical input needs real movement", async ({ page }) => {
  await setup(page);
  await seek(page, 50);
  await centered(page, 50);
  await expect(resume(page)).toBeHidden();
  await page.mouse.move(1000, 550);
  await page.mouse.wheel(200, 0);
  await page.waitForTimeout(300);
  await expect(resume(page)).toBeHidden();
  await page.mouse.wheel(0, 2);
  await page.waitForTimeout(300);
  await expect(resume(page)).toBeHidden();
  await seek(page, 65);
  await centered(page, 65);
  await expect(resume(page)).toBeHidden();
});

test("reading position and paused following survive a background refresh and view changes", async ({ page }) => {
  const release = await setup(page, { delayedRefresh: true });
  await page.mouse.move(1000, 550);
  await page.mouse.wheel(0, 650);
  await expect(resume(page)).toBeVisible();
  const position = await page.evaluate(() => scrollY);
  release();
  await expect(page.locator("h1")).toHaveText("Refreshed lyric sheet");
  await expect(resume(page)).toBeVisible();
  await seek(page, 50);
  await staysPut(page, position);
  await page.getByRole("combobox", { name: "Lyric view", exact: true }).selectOption("phonics");
  await expect(resume(page)).toBeVisible();
  const afterView = await page.evaluate(() => scrollY);
  await seek(page, 65);
  await staysPut(page, afterView);
});

test("a phone swipe pauses scrolling and the resume control fits with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await setup(page);
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 650 }] });
    for (const y of [600, 500, 400, 300, 200]) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y }] });
      await page.waitForTimeout(40);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(resume(page)).toBeVisible();
    await page.waitForTimeout(600);
    const position = await page.evaluate(() => scrollY);
    await seek(page, 50);
    await staysPut(page, position);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await resume(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: "artifacts/lyric-scroll-mobile.png" });
    await resume(page).tap();
    await centered(page, 50);
    await expect(resume(page)).toBeHidden();
  } finally { await context.close(); }
});
