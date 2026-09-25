import { test, expect } from "@playwright/test";

const songs = ["alpha", "bravo", "charlie"].map((id, order) => ({
  id, title: id, duration: 60, order, collection: "tonyai",
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", publishedAt: "2026-01-01T00:00:00Z",
}));
const queue = { inStudio: [], queued: [], recent: [] };
const live = songs.map((song) => ({ ...song, pins: song.id === "alpha" ? 2 : 0,
  feedback: { pinned: song.id === "alpha" }, votes: 0 }));
function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}
async function fixtures(page) {
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: queue }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));
}

for (const order of ["pins first", "static first"]) {
  test(`pins appear before a stalled catalog and queue: ${order}`, async ({ page }) => {
    await fixtures(page);
    await page.setViewportSize({ width: order === "static first" ? 390 : 1440, height: 900 });
    const pins = gate(), fallback = gate();
    await page.route("**/catalog-summary.json", async (route) => {
      await fallback.promise;
      await route.fulfill({ json: { songs } });
    });
    await page.route("**/yehry3/song-pins", async (route) => {
      expect(route.request().headers()["x-visitor-id"]).toBeUndefined();
      await pins.promise;
      await route.fulfill({ json: { pins: [{ id: "charlie", pins: 3 }] } });
    });
    await page.route("**/yehry3/songs/summary", () => {});
    await page.route("**/yehry3/queue?*", () => {});
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (order === "static first") {
      fallback.release();
      await expect(page.locator("#tracks .track h3")).toHaveText(["alpha", "bravo", "charlie"]);
      await page.locator('[data-play="bravo"]').click();
      await expect.poll(() => page.locator("#audio").evaluate((audio) => audio.paused)).toBe(false);
      await page.locator("#audio").evaluate((audio) => { window.pinAudio = audio; audio.currentTime = 5; });
      pins.release();
    } else {
      pins.release();
      await page.waitForResponse((response) => response.url().endsWith("/song-pins"));
      fallback.release();
    }
    await expect(page.locator("#tracks .track h3")).toHaveText(["charlie", "alpha", "bravo"]);
    await expect(page.locator('[data-pin="charlie"]')).toContainText("3");
    await expect(page.locator('[data-pin="charlie"]')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (order === "static first") {
      expect(await page.locator("#audio").evaluate((audio) => audio === window.pinAudio && !audio.paused && audio.currentTime >= 5)).toBe(true);
    }
    await page.screenshot({ path: `artifacts/pins-${order.replace(" ", "-")}.png`, fullPage: true });
  });
}

for (const outcome of ["late", "failed"]) {
  test(`the live catalog wins when startup pins are ${outcome}`, async ({ page }) => {
    await fixtures(page);
    const pins = gate();
    await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs } }));
    await page.route("**/yehry3/song-pins", async (route) => {
      if (outcome === "failed") return route.fulfill({ status: 503, json: {} });
      await pins.promise;
      await route.fulfill({ json: { pins: [{ id: "charlie", pins: 3 }] } });
    });
    await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs: live, nextVoteAt: null } }));
    await page.goto("/");
    await expect(page.locator('[data-pin="alpha"]')).toBeEnabled();
    await expect(page.locator('[data-pin="alpha"]')).toHaveAttribute("aria-pressed", "true");
    if (outcome === "late") {
      const response = page.waitForResponse((response) => response.url().endsWith("/song-pins"));
      pins.release();
      await response;
      // Let the response's body and the page's update callback settle.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await expect(page.locator("#tracks .track h3")).toHaveText(["alpha", "bravo", "charlie"]);
    await expect(page.locator('[data-pin="charlie"]')).not.toContainText("3");
  });
}

test("live pin removals replace startup counts without restarting playback", async ({ page }) => {
  await fixtures(page);
  const catalog = gate();
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/song-pins", (route) => route.fulfill({ json: { pins: [{ id: "charlie", pins: 3 }] } }));
  await page.route("**/yehry3/songs/summary", async (route) => {
    await catalog.promise;
    await route.fulfill({ json: { songs: live, nextVoteAt: null } });
  });
  await page.goto("/");
  await expect(page.locator("#tracks .track").first()).toHaveAttribute("data-id", "charlie");
  await page.locator('[data-play="charlie"]').click();
  await expect.poll(() => page.locator("#audio").evaluate((audio) => audio.paused)).toBe(false);
  await page.locator("#audio").evaluate((audio) => { window.pinAudio = audio; audio.currentTime = 5; });
  catalog.release();
  await expect(page.locator("#tracks .track").first()).toHaveAttribute("data-id", "alpha");
  await expect(page.locator('[data-pin="charlie"]')).toBeEnabled();
  await expect(page.locator('[data-id="charlie"]')).not.toHaveClass(/pinned/);
  expect(await page.locator("#audio").evaluate((audio) => audio === window.pinAudio && !audio.paused && audio.currentTime >= 5)).toBe(true);
});
