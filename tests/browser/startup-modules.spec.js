import { test, expect } from "@playwright/test";
import { openSongMenu } from "./helpers/song-menu.js";

test("listening defers studio, details and Redraw; navigation keeps the same player", async ({ page }) => {
  const requests = [], errors = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#play-all")).toBeEnabled();
  for (const file of ["studio-pages", "generation", "request-materials", "lyric-workshop", "queue", "lyrics", "original-prompt", "art-remix"])
    expect(requests).not.toContain(`/assets/${file}.js`);
  await page.evaluate(() => { window.originalAudio = window.yehry3Player.audio; });
  await openSongMenu(page.locator(".track").first());
  await page.locator("[data-art]").first().click();
  await expect(page.locator("dialog.art-remix")).toBeVisible();
  expect(requests).toContain("/assets/art-remix.js");
  await page.keyboard.press("Escape");
  for (const [path, selector] of [["/distonyc/", "#login-form"], ["/admin/", "#login-form"], ["/queue/", "#queue-updated"], ["/", "#tracks .track"]]) {
    await page.evaluate(async path => (await import("/assets/shell.js")).navigate(path), path);
    await expect(page.locator(selector).first()).toBeVisible();
    expect(await page.evaluate(() => window.originalAudio === window.yehry3Player.audio)).toBe(true);
  }
  expect(requests).toContain("/assets/studio-pages.js");
  expect(requests).toContain("/assets/queue.js");
  expect(errors).toEqual([]);
});

test("a slow lazy route cannot mount over a later navigation", async ({ page }) => {
  let release, requested;
  const held = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { requested = resolve; });
  await page.route("**/assets/studio-pages.js", async route => { requested(); await held; await route.continue(); });
  await page.goto("/");
  await expect(page.locator("#play-all")).toBeEnabled();
  await page.evaluate(() => { void import("/assets/shell.js").then(shell => shell.navigate("/distonyc/")); });
  await arrived;
  await page.evaluate(async () => (await import("/assets/shell.js")).navigate("/queue/"));
  await expect(page.locator("#queue-updated")).toBeVisible();
  release();
  await page.waitForTimeout(400);
  await expect(page.locator("#queue-updated")).toBeVisible();
  await expect(page.locator("#login-form")).toHaveCount(0);
});
