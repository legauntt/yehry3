import { test, expect } from "@playwright/test";

const key = "yehry3:show-quality-issues";
const song = {
  id: "preference-song", title: "A song with an issue", duration: 240,
  url: "/test.mp3", collection: "distonyc", collections: ["distonyc", "fearhunger"],
  qualityIssues: [{ code: "long_instrumental_break", seconds: 35.04 }],
  lyrics: { text: "The saved lyric sheet.", kind: "written" },
};

test.beforeEach(async ({ context }) => {
  await context.route("**/yehry3/songs", route => route.fulfill({ json: { songs: [song], nextVoteAt: null } }));
  await context.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], queued: [], recent: [{ ...song, status: "published", idea: song.title, publishedAt: new Date().toISOString() }],
    queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));
});

test("issues default on and the preference persists across reloads and listening pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open display settings" }).click();
  const toggle = page.getByRole("checkbox", { name: 'Show “Has issues”' });
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await toggle.uncheck();
  await expect(page.locator(".quality-notice")).toBeHidden();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("false");
  await page.reload();
  for (const path of ["/", "/lyrics/?song=preference-song", "/queue/", "/fearhunger/"]) {
    await page.goto(path);
    await expect(page.locator(".quality-notice").filter({ hasText: "35 seconds" })).toHaveCount(1);
    await expect(page.locator(".quality-notice:visible")).toHaveCount(0);
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator(".quality-notice").filter({ hasText: "35 seconds" })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("true");
  await page.goto("/");
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("dialog", { name: "Display settings" }).screenshot({ path: "artifacts/quality-preference-mobile.png" });
});

test("open tabs follow changes and clearing the preference restores the default", async ({ page, context }) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".quality-notice")).toBeVisible();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await page.getByRole("checkbox", { name: 'Show “Has issues”' }).uncheck();
  await expect(second.locator(".quality-notice")).toBeHidden();
  await second.getByRole("button", { name: "Open display settings" }).click();
  await expect(second.getByRole("checkbox", { name: 'Show “Has issues”' })).not.toBeChecked();
  await page.evaluate(key => localStorage.removeItem(key), key);
  await expect(second.locator(".quality-notice")).toBeVisible();
  await expect(second.getByRole("checkbox", { name: 'Show “Has issues”' })).toBeChecked();
});

test("blocked localStorage still allows the current page to toggle notices", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open display settings" }).click();
  const toggle = page.getByRole("checkbox", { name: 'Show “Has issues”' });
  await expect(toggle).toBeChecked();
  await expect(page.locator(".quality-notice")).toBeVisible();
  await toggle.uncheck();
  await expect(page.locator(".quality-notice")).toBeHidden();
  await toggle.check();
  await expect(page.locator(".quality-notice")).toBeVisible();
});

test("the hero record starts moving and honors reduced motion", async ({ page }) => {
  await page.goto("/");
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
  await expect(record).toHaveAttribute("data-motion", "reduced");
  await expect(record).not.toHaveClass(/record-spin/);
  await record.click({ force: true });
  await expect(record).toHaveAttribute("data-spin-speed", "1");
  expect(await record.evaluate((element) => element.getAnimations()[0].effect.getKeyframes()
    .map((frame) => frame.transform))).toEqual(["rotate(0turn)", "rotate(1turn)"]);
});
