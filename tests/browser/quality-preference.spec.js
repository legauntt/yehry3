import { test, expect } from "@playwright/test";

const key = "yehry3:show-quality-issues";
const song = {
  id: "preference-song", title: "A song with an issue", duration: 240,
  url: "/test.mp3", collection: "distonyc", collections: ["distonyc", "fearhunger"],
  reviewState: "needs_review", validationFailures: ["voice_validation"],
  qualityIssues: [{ code: "long_instrumental_break", seconds: 35.04 }],
  lyrics: { text: "The saved lyric sheet.", kind: "written" },
};

test.beforeEach(async ({ context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await context.route("**/yehry3/{catalog,songs/summary}", route => route.fulfill({ json: { songs: [song], nextVoteAt: null } }));
  await context.route("**/yehry3/catalog/state", route => route.fulfill({ json: { feedback: {} } }));
  await context.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [song] } }));
  await context.route("**/yehry3/songs/preference-song", route => route.fulfill({ json: { song } }));
  await context.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [{ ...song, status: "published", idea: song.title, publishedAt: new Date().toISOString() }],
    queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));
});

test("issues default on and the preference persists across reloads and listening pages", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Open display settings" });
  await expect(page.locator(".catalog-filters")).not.toHaveAttribute("open", "");
  await expect(opener).toBeVisible();
  await opener.click();
  const toggle = page.getByRole("checkbox", { name: "Show review notes" });
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await expect(page.locator(".badge.needs_review")).toBeVisible();
  await toggle.uncheck();
  await expect(page.locator(".quality-notice")).toBeHidden();
  await expect(page.locator(".badge.needs_review")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("false");
  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  for (const path of ["/", "/lyrics/?song=preference-song", "/queue/", "/fearhunger/"]) {
    await page.goto(path);
    await expect(page.locator(".quality-notice").filter({ hasText: "35 seconds" })).toHaveCount(1);
    await expect(page.locator(".quality-notice:visible")).toHaveCount(0);
    await expect(page.locator(".badge.needs_review:visible")).toHaveCount(1);
  }
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator(".quality-notice").filter({ hasText: "35 seconds" })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("true");
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("dialog", { name: "Display settings" }).screenshot({ path: "artifacts/quality-preference-mobile.png" });
});

test("Backstage review reasons remain visible with listening notices disabled", async ({ page }) => {
  const prompt = {
    id: "review-request", status: "published", prompt: "A song needing repair",
    details: {}, priority: 0, version: 1, reviewState: "needs_review",
    confirmedAt: "2026-10-04T12:00:00Z", history: [],
    result: { validationFailures: ["vocal_dropout"] },
  };
  await page.addInitScript(key => localStorage.setItem(key, "false"), key);
  await page.route("**/yehry3/admin/prompts?**", route => route.fulfill({ json: {
    prompts: [prompt], total: 1, page: 0, counts: {}, transitions: {}, workers: [],
  } }));
  await page.route("**/yehry3/admin/prompts/review-request", route => route.fulfill({ json: {
    prompt, transitions: {}, workers: [],
  } }));
  await page.route("**/yehry3/admin/prompts/review-request/logs", route => route.fulfill({ json: { entries: [] } }));
  await page.goto("/admin/review-request");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator(".admin-queue .quality-notice")).toBeVisible();
  for (const path of ["/admin/review-request", "/admin/?status=all"]) {
    await page.goto(path);
    const notice = page.locator(".admin-queue .quality-notice");
    await expect(notice).toBeVisible();
    await notice.locator("summary").click();
    await expect(notice.locator("p")).toContainText("Automatic validation detected missing vocal passages.");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(notice.locator("p")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/");
  await expect(page.locator('[data-id="preference-song"] .quality-notice')).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("false");
});

test("open tabs follow changes and clearing the preference restores the default", async ({ page, context }) => {
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  const second = await context.newPage();
  await second.goto("/");
  await second.locator(".catalog-filters > summary").click();
  // The fallback catalog can paint before the fixture response arrives.
  const notice = second.locator('[data-id="preference-song"] .quality-notice');
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await page.getByRole("checkbox", { name: "Show review notes" }).uncheck();
  await expect(notice).toBeHidden();
  await expect(second.locator('[data-id="preference-song"] .badge.needs_review')).toBeVisible();
  await second.getByRole("button", { name: "Open display settings" }).click();
  await expect(second.getByRole("checkbox", { name: "Show review notes" })).not.toBeChecked();
  await page.evaluate(key => localStorage.removeItem(key), key);
  await expect(notice).toBeVisible();
  await expect(second.getByRole("checkbox", { name: "Show review notes" })).toBeChecked();
});

test("blocked localStorage still allows the current page to toggle notices", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  await page.getByRole("button", { name: "Open display settings" }).click();
  const toggle = page.getByRole("checkbox", { name: "Show review notes" });
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await expect(page.locator(".badge.needs_review")).toBeVisible();
  await toggle.uncheck();
  await expect(page.locator(".quality-notice")).toBeHidden();
  await expect(page.locator(".badge.needs_review")).toBeVisible();
  await toggle.check();
  await expect(page.locator(".quality-notice")).toBeVisible();
  const continuous = page.getByRole("checkbox", { name: "Continuous record spins" });
  const playback = page.getByRole("checkbox", { name: "Spin while music plays" });
  await continuous.check();
  await playback.check();
  await expect(page.locator(".record")).toHaveAttribute("data-spin-rate", "1.25");
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(continuous).toBeChecked();
  await expect(playback).toBeChecked();
  await expect(page.locator(".settings-new")).toBeHidden();
  await continuous.uncheck();
  await expect.poll(() => page.locator(".record").evaluate(element => element.getAnimations().length)).toBe(0);
});

test("record preferences and the new indicator persist across navigation and sync between tabs", async ({ page, context }) => {
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  const opener = page.getByRole("button", { name: "Open display settings" });
  await expect(page.locator(".settings-new")).toBeVisible();
  await expect(opener).toHaveAccessibleDescription("New bat flight patterns available.");
  const second = await context.newPage();
  await second.goto("/");
  await second.locator(".catalog-filters > summary").click();
  await expect(second.locator(".settings-new")).toBeVisible();
  await opener.click();
  await expect(second.locator(".settings-new")).toBeHidden();
  await second.getByRole("button", { name: "Open display settings" }).click();
  await page.getByRole("checkbox", { name: "Continuous record spins" }).check();
  await page.getByRole("checkbox", { name: "Spin while music plays" }).check();
  await expect(second.getByRole("checkbox", { name: "Continuous record spins" })).toBeChecked();
  await expect(second.getByRole("checkbox", { name: "Spin while music plays" })).toBeChecked();
  await expect(second.locator(".record")).toHaveAttribute("data-spin-rate", "1.25");
  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  await expect(page.locator(".settings-new")).toBeHidden();
  await expect(page.locator(".record")).toHaveAttribute("data-spin-rate", "1.25");
  await page.goto("/queue/");
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  await expect(page.locator(".settings-new")).toBeHidden();
  await opener.click();
  await expect(page.getByRole("checkbox", { name: "Continuous record spins" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Spin while music plays" })).toBeChecked();
  await page.evaluate(() => localStorage.clear());
  await expect(second.getByRole("checkbox", { name: "Continuous record spins" })).not.toBeChecked();
  await expect(second.getByRole("checkbox", { name: "Spin while music plays" })).not.toBeChecked();
  await expect.poll(() => second.locator(".record").evaluate(element => element.getAnimations().length)).toBe(0);
  await second.getByRole("button", { name: "Close display settings" }).click();
  await expect(second.locator(".settings-new")).toBeVisible();
});

test("new preferences use a still badge with reduced motion and fit a small screen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  const opener = page.getByRole("button", { name: "Open display settings" });
  await expect(page.locator(".settings-new")).toBeVisible();
  expect(await opener.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await opener.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/new-preferences-mobile.png" });
  await opener.click();
  await expect(page.locator(".settings-new")).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Display settings" });
  const playback = page.getByRole("checkbox", { name: "Spin while music plays" });
  await playback.scrollIntoViewIfNeeded();
  await expect(playback).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: "artifacts/record-preferences-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("the hero record spins on arrival and remains interactive with reduced motion", async ({ page }) => {
  await page.goto("/");
  await page.locator(".catalog-filters > summary").click();
  const record = page.locator(".record");
  await expect(record).toHaveAttribute("data-motion", "active");
  await expect(record).toHaveAttribute("role", "button");
  await expect(record).toHaveAttribute("aria-label", "Spin the record");
  await expect(record).toHaveClass(/record-spin-intro/);
  await record.click({ force: true });
  await expect(record).toHaveAttribute("data-spin-speed", "1");
  await record.click({ force: true });
  await expect(record).toHaveAttribute("data-spin-speed", "2");
  await record.press("Enter");
  await record.press(" ");
  await record.click({ force: true });
  await record.click({ force: true });
  await expect(record).toHaveAttribute("data-spin-speed", "5");
  expect(await record.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const frames = animation.effect.getKeyframes();
    return {
      iterations: animation.effect.getTiming().iterations,
      playbackRate: animation.playbackRate,
      transforms: frames.map((frame) => frame.transform),
    };
  })).toEqual({
    iterations: Infinity,
    playbackRate: 5,
    transforms: ["rotate(0turn)", "rotate(1turn)"],
  });
  await page.waitForTimeout(650);
  await record.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.currentTime = 400;
    animation.playbackRate = 0.121;
  });
  await expect.poll(() => record.evaluate((element) => element.getAnimations().length)).toBe(0);
  const restingAngle = await record.evaluate((element) => Number.parseFloat(element.style.transform.match(/-?[\d.]+/)?.[0]));
  expect(restingAngle).toBeGreaterThan(80);
  expect(restingAngle).toBeLessThan(100);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(record).toHaveAttribute("data-motion", "reduced");
  await expect(record).not.toHaveAttribute("data-spin-speed");
  await expect(record).not.toHaveAttribute("data-spin-rate");
  await expect(record).not.toHaveClass(/record-spin/);
  await expect.poll(() => record.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.reload();
  await page.locator(".catalog-filters > summary").click();
  await expect(record).toHaveAttribute("data-motion", "reduced");
  await expect(record).toHaveClass(/record-spin-intro/);
  expect(await record.evaluate((element) => element.getAnimations()[0].effect.getTiming().iterations)).toBe(3);
  await record.click({ force: true });
  await expect(record).toHaveAttribute("data-spin-speed", "1");
  expect(await record.evaluate((element) => element.getAnimations()[0].effect.getKeyframes()
    .map((frame) => frame.transform))).toEqual(["rotate(0turn)", "rotate(1turn)"]);
});
