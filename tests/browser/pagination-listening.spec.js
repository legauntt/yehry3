import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const catalog = JSON.parse(await readFile(new URL("../../catalog.json", import.meta.url), "utf8"));
const recording = catalog.songs.find(song => song.url.startsWith("/fearhunger/"));
const fixtures = () => Array.from({ length: 123 }, (_, index) => ({
  id: `test-${index}`, title: `Track ${String(index + 1).padStart(3, "0")}`, duration: 180,
  url: recording.url, collection: index < 60 ? "tonyai" : "distonyc", votes: index,
  playCount: index, lastPlayedAt: index ? new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString() : null,
}));
async function mock(page, songs) {
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs } }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { inStudio: [], queued: [], recent: [] } }));
  await page.route("**/yehry3/listens", route => route.fulfill({ json: { counted: true, playCount: 1, lastPlayedAt: new Date().toISOString() } }));
}
const nextPage = page => page.getByRole("button", { name: "Next page" }).first();

test("123-song pagination supports deep links, history, filtering, sorting and mobile controls", async ({ page }) => {
  await mock(page, fixtures());
  await page.goto("/?sort=catalog&page=5");
  await expect(page.locator(".track")).toHaveCount(23);
  await expect(page.locator(".track-number").first()).toHaveText("101");
  await expect(page.locator("#track-count")).toHaveText("123 songs · Showing 101–123");
  await expect(page.locator(".listening-overview")).not.toHaveAttribute("open", "");
  await expect(page.locator("#listening-total")).toBeHidden();
  await page.locator(".listening-overview > summary").press("Enter");
  await expect(page.locator("#listening-total")).toBeVisible();
  await expect(page.locator("#listening-total")).toHaveText("7,503");
  await expect(page.locator("#listening-reach")).toHaveText("122 of 123");
  await expect(page.locator("#listening-latest")).not.toHaveText("—");
  await expect(nextPage(page)).toBeDisabled();
  await page.getByRole("button", { name: "Previous page" }).first().click();
  await expect(page).toHaveURL(/page=4/);
  await expect(page.locator(".track-number").first()).toHaveText("76");
  await page.reload();
  await expect(page.locator(".track-number").first()).toHaveText("76");
  await page.locator(".catalog-filters > summary").click();
  await page.getByLabel("Collection", { exact: true }).selectOption("tonyai");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(page.locator("#track-count")).toHaveText("60 songs · Showing 1–25");
  await expect(page.locator("#listening-total")).toHaveText("1,770");
  await expect(page.locator("#listening-reach")).toHaveText("59 of 60");
  await page.goBack();
  await expect(page.locator(".track-number").first()).toHaveText("76");
  await page.getByLabel("Search songs").fill("Track 12");
  await expect(page.locator(".track")).toHaveCount(4);
  await expect(page.locator("#listening-total")).toHaveText("482");
  await expect(page.locator("[data-catalog-pagination]:visible")).toHaveCount(0);
  await page.getByLabel("Search songs").fill("missing");
  await expect(page.locator("#tracks")).toContainText("No songs match");
  await expect(page.locator("#listening-total")).toHaveText("0");
  await expect(page.locator("#listening-latest")).toHaveText("None recorded");
  await page.getByLabel("Search songs").fill("");
  await page.locator(".listening-overview > summary").click();
  await page.getByRole("button", { name: "Most listened to" }).click();
  await expect(page.getByLabel("Sort songs")).toHaveValue("plays");
  await expect(page.getByRole("button", { name: "Most listened to" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".track h3").first()).toHaveText("Track 123");
  await expect(page.locator(".track-listening").first()).toContainText("122 listens");
  await page.reload();
  await expect(page.getByLabel("Sort songs")).toHaveValue("plays");
  await expect(page.locator("#most-listened")).toBeHidden();
  await page.locator(".catalog-filters > summary").click();
  for (const [sort, first] of [["plays", "Track 123"], ["least-played", "Track 001"], ["least-recent", "Track 001"]]) {
    await page.getByLabel("Sort songs").selectOption(sort);
    await expect(page.locator(".track h3").first()).toHaveText(first);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nextPage(page).click();
  await expect(page.locator(".track-number").first()).toHaveText("26");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/catalog-pagination-mobile.png" });
  await page.locator(".listening-overview > summary").click();
  await page.locator(".listening-overview").screenshot({ path: "artifacts/listening-dashboard-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".listening-overview").screenshot({ path: "artifacts/listening-dashboard-desktop.png" });
});

test("page changes and refresh preserve playback and seeking, and Next crosses the page boundary", async ({ page }) => {
  const songs = fixtures();
  await mock(page, songs);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".track")).toHaveCount(25);
  await page.locator("[data-play]").last().click();
  const audio = page.locator("#audio");
  await expect.poll(() => audio.evaluate(audio => audio.paused)).toBe(false);
  await audio.evaluate(audio => { window.testAudio = audio; audio.currentTime = 30; });
  await nextPage(page).click();
  await expect(page.locator(".track-number").first()).toHaveText("26");
  expect(await audio.evaluate(audio => audio === window.testAudio && !audio.paused && audio.currentTime >= 30)).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".track-number").first()).toHaveText("26");
  expect(await audio.evaluate(audio => audio === window.testAudio && !audio.paused && audio.currentTime >= 30)).toBe(true);
  await page.getByRole("button", { name: "Next song", exact: true }).click();
  await expect(page.locator("#now-title")).toHaveText("Track 026");
  await page.getByRole("button", { name: "Play the collection" }).click();
  await expect(page.locator("#now-title")).toHaveText("Track 001");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("late live data and saved-profile loading retain requested pages; invalid pages are clamped", async ({ page }) => {
  const songs = fixtures(), profile = { id: "faaa0000-0000-4000-8000-000000000001", name: "Some saved", songIds: songs.slice(0, 60).map(song => song.id), revision: 1 };
  await mock(page, songs);
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.slice(0, 2) } }));
  await page.route("**/yehry3/profiles?*", route => route.fulfill({ json: { profiles: [profile], hasMore: false } }));
  await page.route(`**/yehry3/profiles/${profile.id}`, async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ json: { profile } });
  });
  await page.goto(`/?sort=catalog&page=3&saved=1&profile=${profile.id}`);
  await expect(page.locator(".track-number").first()).toHaveText("51");
  await expect(page).toHaveURL(/page=3/);
  await expect(page.locator(".catalog-filters")).not.toHaveAttribute("open", "");
  await expect(page.locator(".active-filter")).toHaveText(["Saved songs", "Sort: Latest additions"]);
  await expect(page.locator("#listening-total")).toHaveText("1,770");
  await expect(page.locator("#listening-reach")).toHaveText("59 of 60");
  await page.locator(".profile-details > summary").click();
  await page.locator("#saved-only").click();
  await expect(page.locator(".track-number").first()).toHaveText("01");
  await expect(page.locator("#listening-total")).toHaveText("7,503");
  await expect(page.locator(".active-filter")).toHaveText(["Sort: Latest additions"]);
  await page.goBack();
  await expect(page.locator(".active-filter")).toHaveText(["Saved songs", "Sort: Latest additions"]);
  await expect(page.locator(".track-number").first()).toHaveText("51");
  await page.goto("/?sort=catalog&page=999");
  await expect(page).toHaveURL(/page=5/);
  await expect(page.locator(".track")).toHaveCount(23);
  await page.goto("/?sort=catalog&page=oops");
  await expect(page.locator(".track-number").first()).toHaveText("01");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
});

test("real main and lyric playback records durable stats, with cross-page deduplication", async ({ page, request }) => {
  test.setTimeout(70000);
  const reports = [];
  page.on("response", async response => {
    if (response.url().endsWith("/listens") && response.request().method() === "POST") reports.push(await response.json());
  });
  await page.goto(`/?q=${encodeURIComponent(recording.title)}`);
  await expect(page.locator(".track")).toHaveCount(1);
  expect(reports).toHaveLength(0);
  await page.locator("[data-play]").click();
  await expect.poll(() => reports.length, { timeout: 18000 }).toBe(1);
  expect(reports[0].counted).toBe(true);
  const count = reports[0].playCount;
  await expect(page.locator(".track-listening")).toContainText(`${count} listen`);
  await expect(page.locator("#listening-total")).toHaveText(String(count));
  await page.locator("#audio").evaluate(async audio => { audio.pause(); audio.currentTime = 60; await audio.play(); });
  await page.goto(`/lyrics/?song=${recording.id}`);
  await page.locator("audio").evaluate(audio => audio.play());
  await expect.poll(() => reports.length, { timeout: 18000 }).toBe(2);
  expect(reports[1].counted).toBe(false);
  expect(reports[1].playCount).toBe(count);
  await expect(page.locator("[data-listening-stats]")).toContainText(`${count} listen`);
  const apiBase = await page.evaluate(async () => (await import("/assets/config.js")).API_BASE);
  const song = (await (await request.get(`${apiBase}/songs/${recording.id}`)).json()).song;
  expect(song.playCount).toBe(count);
  expect(Date.parse(song.lastPlayedAt)).toBeGreaterThan(Date.now() - 60000);
});

test("tracking outages retry the same request without interrupting playback", async ({ page }) => {
  const songs = fixtures();
  await mock(page, songs);
  const requests = [];
  await page.route("**/yehry3/listens", route => {
    requests.push(route.request().postDataJSON());
    return requests.length === 1 ? route.abort() : route.fulfill({ json: { counted: true, playCount: 1, lastPlayedAt: new Date().toISOString() } });
  });
  await page.goto("/?sort=catalog");
  await page.locator("[data-play]").first().click();
  await expect.poll(() => requests.length, { timeout: 25000 }).toBe(2);
  expect(requests[0].requestId).toBe(requests[1].requestId);
  expect(await page.locator("#audio").evaluate(audio => !audio.paused && audio.currentTime > 10)).toBe(true);
  await expect(page.locator("#message")).not.toContainText("unreachable");
});

test("unavailable catalog or saved-profile statistics stay unknown rather than showing zero", async ({ page }) => {
  const songs = fixtures();
  await mock(page, songs);
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: songs.map(({ playCount, lastPlayedAt, ...song }) => song) } }));
  await page.route("**/yehry3/songs/summary", route => route.abort());
  await page.goto("/?sort=plays");
  await expect(page.locator("#listening-scope")).toContainText("temporarily unavailable");
  await expect(page.locator("#listening-total")).toHaveText("—");
  await expect(page.locator(".track")).toHaveCount(25);
  await page.unroute("**/yehry3/songs/summary");
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs, nextVoteAt: null } }));
  const id = "faaa0000-0000-4000-8000-000000000001";
  await page.route(`**/yehry3/profiles/${id}`, route => route.fulfill({ status: 404, json: { error: "Profile not found" } }));
  await page.goto(`/?profile=${id}&saved=1`);
  await expect(page.locator("#tracks")).toContainText("Saved songs couldn’t load");
  await expect(page.locator("#listening-total")).toHaveText("—");
  await page.locator(".profile-details > summary").click();
  await page.locator("#saved-only").click();
  await expect(page.locator("#listening-total")).toHaveText("7,503");
});
