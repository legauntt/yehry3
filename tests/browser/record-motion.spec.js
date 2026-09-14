import { test, expect } from "@playwright/test";

const song = {
  id: "record-test", title: "Record playback test", duration: 263.44,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", collection: "fearhunger",
};

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [song], nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], needsAttention: [], queued: [], recent: [],
    queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));
  await page.route("**/yehry3/profiles*", route => route.fulfill({ json: { profiles: [] } }));
});

for (const reducedMotion of ["reduce", "no-preference"]) {
  test(`slow loading preserves the arrival spin (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    let releaseArtwork;
    const artworkReady = new Promise(resolve => { releaseArtwork = resolve; });
    await page.route("**/band-vinyl-v1.webp", async route => {
      await artworkReady;
      await route.continue();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const record = page.getByRole("button", { name: "Spin the record", exact: true });
    await expect(record).toBeVisible();
    try {
      // Longer than the whole intro: it must not get used up during loading.
      await page.waitForTimeout(4400);
      await expect(record).not.toHaveClass(/record-spin/);
      expect(await record.evaluate(element => element.getAnimations().length)).toBe(0);
    } finally {
      releaseArtwork();
    }
    await page.waitForLoadState("load");
    await expect(record).toHaveClass(/record-spin-intro/);
    const transform = await record.evaluate(element => getComputedStyle(element).transform);
    await expect.poll(() => record.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform);
    await expect(record).not.toHaveClass(/record-spin-intro/, { timeout: 7000 });
    expect(await record.evaluate(element => element.getAnimations().length)).toBe(0);

    if (reducedMotion === "reduce") {
      await page.clock.install();
      await page.clock.runFor(60000);
      await expect(record).not.toHaveClass(/record-spin/);
    }
  });
}

test("clicking during load keeps control and does not interrupt music or seeking", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let releaseArtwork;
  const artworkReady = new Promise(resolve => { releaseArtwork = resolve; });
  await page.route("**/band-vinyl-v1.webp", async route => {
    await artworkReady;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const record = page.getByRole("button", { name: "Spin the record", exact: true });
  try {
    await expect(record).toBeVisible();
    await record.click({ force: true });
    await expect(record).toHaveAttribute("data-spin-speed", "1");
  } finally {
    releaseArtwork();
  }
  await page.waitForLoadState("load");
  await page.waitForTimeout(150);
  await expect(record).not.toHaveClass(/record-spin-intro/);
  expect(await record.evaluate(element => element.getAnimations().length)).toBe(1);

  await page.getByRole("button", { name: "Play Record playback test", exact: true }).click();
  const audio = page.locator("#audio");
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0);
  await audio.evaluate(element => { element.currentTime = 30; });
  await record.click({ force: true });
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(30);
  expect(await audio.evaluate(element => element.paused)).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await record.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(record).toBeVisible();
  await page.screenshot({ path: "artifacts/record-load-mobile.png", fullPage: false });
});

test("a background load waits until the page is visible to spin", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  });
  await page.goto("/");
  const record = page.getByRole("button", { name: "Spin the record", exact: true });
  await expect(record).not.toHaveClass(/record-spin/);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(record).toHaveClass(/record-spin-intro/);
  const transform = await record.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => record.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform);
});

for (const reducedMotion of ["reduce", "no-preference"]) {
  test(`continuous spins hold their speed and still respond to clicks (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    const record = page.getByRole("button", { name: "Spin the record", exact: true });
    await record.click({ force: true });
    await page.getByRole("button", { name: "Open display settings" }).click();
    const continuous = page.getByRole("checkbox", { name: "Continuous record spins" });
    await expect(continuous).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Spin while music plays" })).not.toBeChecked();
    await continuous.check();
    await page.getByRole("button", { name: "Close display settings" }).click();
    await record.click({ force: true });
    const rate = await record.evaluate(element => element.getAnimations()[0].playbackRate);
    const transform = await record.evaluate(element => getComputedStyle(element).transform);
    await page.waitForTimeout(1600);
    expect(await record.evaluate(element => element.getAnimations()[0].playbackRate)).toBe(rate);
    await expect.poll(() => record.evaluate(element => getComputedStyle(element).transform)).not.toBe(transform);
    await record.press("Enter");
    expect(await record.evaluate(element => element.getAnimations()[0].playbackRate)).toBeGreaterThan(rate);
    expect(await page.locator("#audio").evaluate(element => element.paused)).toBe(true);

    await page.reload();
    await expect(record).toHaveAttribute("data-spin-rate", "1.25");
    await expect(record).not.toHaveClass(/record-spin-intro/);
    await page.getByRole("button", { name: "Open display settings" }).click();
    await expect(continuous).toBeChecked();
    await continuous.uncheck();
    await expect.poll(() => record.evaluate(element => element.getAnimations().length)).toBe(0);
  });

  test(`playback spins follow play and pause without affecting audio or seeking (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    const record = page.getByRole("button", { name: "Spin the record", exact: true });
    const audio = page.locator("#audio");
    await page.getByRole("button", { name: "Play Record playback test", exact: true }).click();
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0);
    await audio.evaluate(element => { element.currentTime = 30; });
    await page.getByRole("button", { name: "Open display settings" }).click();
    const playback = page.getByRole("checkbox", { name: "Spin while music plays" });
    const continuous = page.getByRole("checkbox", { name: "Continuous record spins" });
    await playback.check();
    await expect(record).toHaveAttribute("data-spin-rate", "1.25");
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(30);
    expect(await audio.evaluate(element => element.paused)).toBe(false);
    await audio.evaluate(element => element.pause());
    await expect.poll(() => record.evaluate(element => element.getAnimations().length)).toBe(0);
    await audio.evaluate(element => element.play());
    await expect(record).toHaveAttribute("data-spin-rate", "1.25");
    await audio.evaluate(element => { element.currentTime = 60; });
    await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(60);
    await playback.uncheck();
    await expect.poll(() => record.evaluate(element => element.getAnimations().length)).toBe(0);
    expect(await audio.evaluate(element => element.paused)).toBe(false);
    await playback.check();
    await continuous.check();
    await audio.evaluate(element => element.pause());
    await expect(record).toHaveAttribute("data-spin-rate", "1.25");
    await continuous.uncheck();
    await expect.poll(() => record.evaluate(element => element.getAnimations().length)).toBe(0);
  });
}
