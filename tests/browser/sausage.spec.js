import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const tour = JSON.parse(await readFile(new URL("../../sausage/tour.json", import.meta.url), "utf8"));
const hosting = JSON.parse(await readFile(new URL("../../staticwebapp.config.json", import.meta.url), "utf8"));
const policy = hosting.globalHeaders["Content-Security-Policy"].replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3000");
const songs = tour.runs.map(r => r.song);

test.beforeEach(async ({ page }) => {
  await page.route("**/yehry3/**", route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/songs/summary") ? { songs, nextVoteAt: null }
      : path.includes("/queue") ? { inStudio: [], queued: [], recent: [] }
      : path.includes("/profiles") ? { profiles: [], total: 0 }
      : path.includes("/events") ? { version: "1", topics: { listeners: { listeners: [], total: 0 } } }
      : { listeners: [], total: 0 };
    return route.fulfill({ json: body });
  });
  await page.routeWebSocket("**/yehry3/events/socket", socket => socket.close());
  await page.route("**/sausage/", async route => {
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
});

test("both real timelines, keyboard stages, shared links and responsive layout under CSP", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/sausage/");
  await expect(page.locator("#tour-song")).toHaveText("Drink It Back, Bucko");
  await expect(page.locator("#tour-total")).toHaveText("≈ 3m 36s");
  await expect(page.locator("#tour-prev")).toBeDisabled();
  await expect(page.locator("#tour-audio")).toBeHidden();
  await page.getByRole("button", { name: "1. Seed", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#stage-title")).toHaveText("Let it simmer.");
  await page.locator('[data-kitchen="ace"]').click();
  await expect(page.locator("#stage-time")).toHaveText("≈ 3m 32s here");
  await expect(page.locator("#tour-total")).toHaveText("≈ 8m 14s");
  await expect(page).toHaveURL(/#ace\/handoff$/);
  await page.reload();
  await expect(page.locator("#stage-title")).toHaveText("Let it simmer.");
  await expect(page.locator('[data-kitchen="ace"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "6. Checks", exact: true }).click();
  await expect(page.locator("#stage-footnote")).toContainText("second take was no closer");
  await page.getByRole("button", { name: "7. Record", exact: true }).click();
  await expect(page.locator("#tour-next")).toBeDisabled();
  await expect(page.locator("#full-song-link")).toHaveAttribute("href", `/#${songs[1].id}`);
  await page.locator("#tour-quality summary").click();
  await expect(page.locator("#tour-quality")).toContainText("Long instrumental ending");
  await expect(page.locator("#tour-quality")).toContainText("could not confirm");
  const bars = await page.locator(".time-bar").evaluateAll(rows => rows.map(row => [...row.querySelectorAll("button")].reduce((n, b) => n + b.getBoundingClientRect().width, 0)));
  expect(bars[0] / bars[1]).toBeCloseTo(216 / 494, 1);
  await page.screenshot({ path: "artifacts/sausage/desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("#tour-audio")).toBeVisible();
  }
  await page.screenshot({ path: "artifacts/sausage/mobile.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.yehry3Theme.setDark(true));
  await expect(page.locator('.kitchens button[data-kitchen="ace"]')).toHaveCSS("background-color", "rgb(231, 237, 223)");
  await page.screenshot({ path: "artifacts/sausage/dark.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("real excerpt playback, seeking and layer continuity; stage changes stop audio", async ({ page }) => {
  await page.goto("/sausage/#emp/band");
  const audio = page.locator("#tour-audio");
  await expect(audio).toHaveJSProperty("readyState", 4);
  await audio.evaluate(async a => { a.currentTime = 6; await a.play(); });
  await expect.poll(() => audio.evaluate(a => a.currentTime)).toBeGreaterThan(6);
  await page.getByRole("button", { name: "Guide vocal", exact: true }).click();
  await expect(audio).toHaveAttribute("src", "/sausage/audio/emp-guide.mp3");
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime >= 6)).toBe(true);
  await audio.evaluate(a => { a.pause(); a.currentTime = 11; });
  await page.getByRole("button", { name: "Tony solo", exact: true }).click();
  await expect.poll(() => audio.evaluate(a => a.currentTime)).toBeCloseTo(11, 0);
  await expect(audio).toHaveJSProperty("paused", true);
  await page.locator('[data-kitchen="ace"]').click();
  await expect(audio).toHaveAttribute("src", "/sausage/audio/ace-generated.mp3");
  await expect(audio).toHaveJSProperty("paused", true);
  await expect.poll(() => audio.evaluate(a => a.currentTime)).toBe(0);
  await audio.evaluate(a => a.play());
  await page.getByRole("button", { name: "4. Separate", exact: true }).click();
  await expect(audio).toHaveJSProperty("paused", true);
  // All ten retained layers decode, including both final mixes.
  for (const key of ["emp", "ace"]) {
    await page.locator(`[data-kitchen="${key}"]`).click();
    for (const layer of Object.keys(tour.runs[0].clips)) {
      await page.locator(`[data-layer="${layer}"]`).click();
      await expect.poll(() => audio.evaluate(a => Number.isFinite(a.duration) && a.duration > 23 && a.duration < 25)).toBe(true);
      await expect(page.locator("#audio-error")).toBeHidden();
    }
  }
});

test("the shared player survives navigation; excerpts never play over it", async ({ page }) => {
  // Use real local final excerpts for the full-song player in this isolated interaction test.
  for (const r of tour.runs) await page.route(r.song.url, async route => route.fulfill({ body: await readFile(new URL(`../../${r.clips.final.slice(1)}`, import.meta.url)), contentType: "audio/mpeg" }));
  await page.goto("/sausage/#emp/record");
  await page.locator("#play-full").click();
  await expect.poll(() => page.evaluate(() => !window.yehry3Player.audio.paused)).toBe(true);
  await page.evaluate(() => { window.sameTourDocument = true; window.tourPlayer = window.yehry3Player.audio; });
  await page.locator(".site-header").getByRole("link", { name: "The collection", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => !window.yehry3Player.audio.paused)).toBe(true);
  await page.locator(".site-footer").getByRole("link", { name: "How the Tony C is made", exact: true }).click();
  await expect(page.locator("#tour-song")).toHaveText("Drink It Back, Bucko");
  expect(await page.evaluate(() => window.sameTourDocument && window.tourPlayer === window.yehry3Player.audio)).toBe(true);
  await page.getByRole("button", { name: "3. Band", exact: true }).click();
  await page.locator("#tour-audio").evaluate(a => a.play());
  await expect.poll(() => page.evaluate(() => window.yehry3Player.audio.paused)).toBe(true);
  await page.evaluate(() => { window.oldExcerpt = document.querySelector("#tour-audio"); });
  await page.locator(".site-header").getByRole("link", { name: "The collection", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.oldExcerpt.paused && !window.oldExcerpt.getAttribute("src"))).toBe(true);
});

test("missing tour data and audio errors have usable recovery", async ({ page }) => {
  await page.route("**/sausage/tour.json", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/sausage/");
  await expect(page.getByRole("link", { name: "Try opening it again" })).toBeVisible();
  await page.unroute("**/sausage/tour.json");
  await page.route("**/sausage/audio/emp-generated.mp3", route => route.fulfill({ status: 404, body: "missing" }));
  await page.getByRole("link", { name: "Try opening it again" }).click();
  await page.getByRole("button", { name: "3. Band", exact: true }).click();
  await expect(page.locator("#audio-error")).toBeVisible();
  await page.getByRole("button", { name: "Guide vocal", exact: true }).click();
  await expect(page.locator("#audio-error")).toBeHidden();
  await expect.poll(() => page.locator("#tour-audio").evaluate(a => a.readyState)).toBeGreaterThan(0);
});
