import { test, expect } from "@playwright/test";

const id = (letter) => `distonyc-${letter.repeat(24)}`;
const failed = {
  id: id("a"),
  idea: "Tony takes on the manosphere, highlighting just what it is men feel is lacking and the promises therein",
  authoredBy: "Pancakeo",
  status: "failed",
  submittedAt: "2026-09-13T17:57:00.000Z",
  updatedAt: "2026-09-13T18:21:00.000Z",
  voiceModel: "v6",
  originalPrompt: {
    idea: "Tony takes on the manosphere, highlighting just what it is men feel is lacking and the promises therein",
    direction: "Slow psychedelic rock",
    keep: "A searching Tony vocal",
    basisSongs: [],
    voiceModel: "v6",
  },
  progress: { stage: "Checking the ending", percent: 91 },
};
const queued = {
  id: id("b"), idea: "A second distinct request", status: "queued",
  submittedAt: "2026-09-13T18:00:00.000Z", updatedAt: "2026-09-13T18:00:00.000Z", voiceModel: "v6", progress: null,
  originalPrompt: { idea: "A second distinct request", direction: "Acoustic", keep: "Tony", basisSongs: [], voiceModel: "v6" },
};
const queue = {
  inStudio: [], needsAttention: [failed], queued: [queued], recent: [],
  inStudioTotal: 0, needsAttentionTotal: 1, queuedTotal: 1, page: 0, pageSize: 50,
};

async function mockQueue(page) {
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/yehry3/queue/distonyc-*", route => {
    const publicId = new URL(route.request().url()).pathname.split("/").pop();
    const item = [failed, queued].find(song => song.id === publicId);
    return item ? route.fulfill({ json: item }) : route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  await page.route("**/yehry3/songs/distonyc-*", route => {
    const publicId = new URL(route.request().url()).pathname.split("/").pop();
    const item = [failed, queued].find(song => song.id === publicId);
    return item ? route.fulfill({ json: { song: item } }) : route.fulfill({ status: 404, json: { error: "Not found" } });
  });
}

test("queue cards have distinct detail URLs and 9/11'd Again remains public", async ({ page }) => {
  await mockQueue(page);
  await page.goto("/queue/");
  await expect(page.locator("#attention-section")).toBeVisible();
  await expect(page.locator("#needs-attention")).toContainText("Pancakeo");
  await expect(page.locator("#needs-attention")).toContainText("Completed work is saved");
  const links = await page.locator(".public-queue-card h3 a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
  expect(new Set(links).size).toBe(2);
  expect(links).toContain(`/queue/details/?request=${failed.id}`);
  await expect(page.getByRole("link", { name: "View original prompt" })).toHaveCount(2);
  await page.locator(`#${failed.id} h3 a`).click();
  await expect(page).toHaveURL(new RegExp(`/queue/details/\\?request=${failed.id}$`));
  await expect(page.locator("h1")).toContainText("Tony takes on the manosphere");
  await expect(page.locator(".queue-detail")).toContainText("Authored by Pancakeo");
  await expect(page.locator(".attention-note")).toContainText("Production stopped during Checking the ending");
  await expect(page.locator(".attention-note")).not.toContainText("worker");
  await page.getByRole("link", { name: "View original prompt" }).click();
  await expect(page).toHaveURL(new RegExp(`/original-prompt/\\?song=${failed.id}$`));
  await expect(page.locator(".original-prompt")).toContainText("Slow psychedelic rock");
  await expect(page.locator(".original-prompt")).toContainText("A searching Tony vocal");
  await expect(page.getByRole("link", { name: "Hear the song" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".original-prompt").screenshot({ path: "artifacts/original-prompt-mobile.png" });
});

test("the homepage shows the full queue and emphasizes 9/11'd Again", async ({ page }) => {
  const active = ["c", "d", "e"].map((letter, index) => ({
    id: id(letter), idea: `Active request ${index + 1}`, status: "processing", voiceModel: "v6",
    submittedAt: "2026-09-13T18:00:00.000Z", updatedAt: "2026-09-13T18:00:00.000Z",
    progress: { stage: "Rendering", percent: 25 },
  }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: { ...queue, inStudio: active, inStudioTotal: 3 } }));
  await page.goto("/");
  await expect(page.locator(`.pending-track[data-id="${failed.id}"]`)).toBeVisible();
  await expect(page.locator(".pending-track")).toHaveCount(5);
  await expect(page.locator(".pending-track").first()).toContainText("9/11'd Again");
  await expect(page.locator(`.pending-track[data-id="${failed.id}"] .pending-warning-icon`)).toBeVisible();
});

test("9/11'd Again badges play a line without toggling the row", async ({ page }) => {
  await page.addInitScript(() => {
    window.__played = [];
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes("/assets/sounds/")) window.__played.push(new URL(this.src).pathname);
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
  });
  const soundRequests = [];
  page.on("request", request => { if (request.url().includes("/assets/sounds/")) soundRequests.push(request.url()); });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.goto("/");
  const row = page.locator(`.pending-track[data-id="${failed.id}"]`);
  // <summary> flattens its children in the accessibility tree, so find the row's badge by class.
  const badge = row.locator("button.badge-sound");
  await expect(badge.locator(".badge-sound-icon")).toBeVisible();
  expect(soundRequests).toEqual([]);
  await badge.click();
  await expect(badge).toHaveClass(/is-playing/);
  expect(await row.evaluate(node => node.open)).toBe(false);
  await badge.click();
  await expect(badge).not.toHaveClass(/is-playing/);
  await badge.click();
  expect(await page.evaluate(() => window.__played)).toEqual([
    "/assets/sounds/one-loud-crash.mp3",
    "/assets/sounds/nine-elevend-again.mp3",
  ]);
  await mockQueue(page);
  await page.goto("/queue/");
  await page.getByRole("button", { name: "9/11'd Again (play sound)" }).click();
  expect((await page.evaluate(() => window.__played)).at(-1)).toBe("/assets/sounds/one-loud-crash.mp3");
  for (const clip of ["one-loud-crash", "nine-elevend-again"]) {
    const response = await page.request.get(`/assets/sounds/${clip}.mp3`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("audio/mpeg");
  }
});

test("three quick clicks on cover art sing every clip in turn", async ({ page }) => {
  await page.addInitScript(() => {
    window.__played = [];
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes("/assets/sounds/")) window.__played.push(new URL(this.src).pathname);
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
  });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  // With no song moments to draw on, the egg sings the fixed clips.
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips: [] } }));
  await page.goto("/");
  const art = page.locator(`.pending-track[data-id="${failed.id}"] .track-art`);
  // Unhurried clicks are just clicks.
  await art.click();
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 2 });
  expect(await page.evaluate(() => window.__played)).toEqual([]);
  await page.waitForTimeout(1100);
  await expect(art).not.toHaveClass(/egg-shock/);
  const calm = await art.getAttribute("src");
  await art.click({ clickCount: 3 });
  expect(await page.evaluate(() => window.__played)).toEqual(["/assets/sounds/nine-elevend-again.mp3"]);
  // The picture shakes and gasps, then goes back to normal.
  await expect(art).toHaveClass(/egg-shock/);
  await expect.poll(() => art.getAttribute("src")).not.toBe(calm);
  await expect(art).not.toHaveClass(/egg-shock/, { timeout: 5000 });
  expect(await art.getAttribute("src")).toBe(calm);
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  expect((await page.evaluate(() => window.__played)).at(-1)).toBe("/assets/sounds/one-loud-crash.mp3");
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  expect((await page.evaluate(() => window.__played)).at(-1)).toBe("/assets/sounds/nine-elevend-again.mp3");
  // The egg leaves the badge's own rotation where it was.
  await page.locator(`.pending-track[data-id="${failed.id}"] button.badge-sound`).click();
  expect((await page.evaluate(() => window.__played)).at(-1)).toBe("/assets/sounds/one-loud-crash.mp3");
});

test("after the title line, hammered cover art sings moments from recordings", async ({ page }) => {
  await page.addInitScript(() => {
    window.__played = [];
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      const url = new URL(this.src);
      if (url.pathname.startsWith("/assets/sounds/")) window.__played.push(url.pathname);
      else window.__plays.push({ src: url.pathname, start: this.currentTime, gain: this.volume });
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
    // Never draw a fixed clip: the odds of one are one in five.
    Math.random = () => 0.9;
  });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  const requests = [];
  page.on("request", request => { if (request.url().includes("/egg-clips.json")) requests.push(request.url()); });
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips: [
    { id: "one", title: "One", url: "/one.mp3", moments: [[12.5, 15.5]] },
    { id: "two", title: "Two", url: "/two.mp3", moments: [[3, 6]] },
  ] } }));
  await page.route(/\/(one|two)\.mp3$/, route => route.fulfill({ status: 200, contentType: "audio/mpeg", body: "" }));
  await page.goto("/");
  const art = page.locator(`.pending-track[data-id="${failed.id}"] .track-art`);
  expect(requests).toEqual([]);
  await art.click({ clickCount: 3 });
  expect(requests).toHaveLength(1);
  // The first hammering is always the title line.
  expect(await page.evaluate(() => window.__played)).toEqual(["/assets/sounds/nine-elevend-again.mp3"]);
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  const plays = await page.evaluate(() => window.__plays);
  expect(plays).toHaveLength(2);
  // Each starts at its sung line, and the same song never sings twice in a row.
  expect(plays.map(play => play.start)).toEqual(expect.arrayContaining([12.5, 3]));
  expect(new Set(plays.map(play => play.src)).size).toBe(2);
  expect(requests).toHaveLength(1);
  // The picture keeps shaking for exactly the length of the moment (both are three seconds long).
  await expect(art).toHaveClass(/egg-shock/);
  expect(await art.evaluate(node => node.style.getPropertyValue("--egg-ms"))).toBe("3000ms");
});

test("the egg favors upvoted and recent songs over the rest of the catalog", async ({ page }) => {
  await page.addInitScript(() => {
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      const url = new URL(this.src);
      if (!url.pathname.startsWith("/assets/sounds/")) window.__plays.push(url.pathname);
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
    // A flat pick at 0.9 would land on the last clip; only the weights make it "loved", the first.
    Math.random = () => 0.9;
  });
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  const clip = (id, publishedAt) => ({ id, title: id, url: `/${id}.mp3`, publishedAt, moments: [[1, 4]] });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [{ id: "loved", title: "Loved", url: "/loved.mp3", votes: 8 }, { id: "quiet", title: "Quiet", url: "/quiet.mp3", votes: 0 }], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips: [clip("loved", old), clip("quiet", old)] } }));
  await page.route(/\/(loved|quiet)\.mp3$/, route => route.fulfill({ status: 200, contentType: "audio/mpeg", body: "" }));
  await page.goto("/");
  const art = page.locator(`.pending-track[data-id="${failed.id}"] .track-art`);
  // The first hammering is the title line; the second draws from the weighted pool.
  await art.click({ clickCount: 3 });
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => window.__plays)).toEqual(["/loved.mp3"]);
});

test("cover art holds still until its sound has loaded", async ({ page }) => {
  await page.addInitScript(() => {
    window.__release = [];
    HTMLMediaElement.prototype.play = function () {
      // A slow download: the sound only starts when the test says so.
      window.__release.push(() => this.dispatchEvent(new Event("playing")));
      return Promise.resolve();
    };
  });
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: queue }));
  await page.route("**/egg-clips.json", route => route.fulfill({ json: { clips: [] } }));
  await page.goto("/");
  const art = page.locator(`.pending-track[data-id="${failed.id}"] .track-art`);
  await art.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => window.__release.length)).toBe(1);
  await page.waitForTimeout(700);
  await expect(art).not.toHaveClass(/egg-shock/);
  // It pulses while it waits, and the pulse gives way to the shake.
  await expect(art).toHaveClass(/egg-loading/);
  expect(await art.evaluate(node => getComputedStyle(node).animationName)).toBe("egg-loading");
  await page.evaluate(() => window.__release[0]());
  await expect(art).toHaveClass(/egg-shock/);
  await expect(art).not.toHaveClass(/egg-loading/);
  // A sound that is replaced before it loads never gets its animation.
  await expect(art).not.toHaveClass(/egg-shock/, { timeout: 5000 });
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  await page.waitForTimeout(1100);
  await art.click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => window.__release.length)).toBe(3);
  await page.evaluate(() => { window.__release[1](); window.__release[2](); });
  await expect(art).toHaveClass(/egg-shock/);
  await expect(art).not.toHaveClass(/egg-loading/);
});

test("a request that goes 9/11'd announces itself once", async ({ page }) => {
  await page.addInitScript(() => {
    window.__played = [];
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes("/assets/sounds/")) window.__played.push(new URL(this.src).pathname);
      setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
      return Promise.resolve();
    };
  });
  let attention = [];
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [], nextVoteAt: null } }));
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [] } }));
  await page.route("**/yehry3/queue?*", route =>
    route.fulfill({ json: { ...queue, needsAttention: attention, needsAttentionTotal: attention.length } }));
  await page.goto("/queue/");
  await expect(page.locator("#waiting-queue")).toContainText("A second distinct request");
  // A queue that opens with no failures stays quiet.
  expect(await page.evaluate(() => window.__played)).toEqual([]);
  attention = [failed];
  await page.locator("#refresh-queue").click();
  await expect(page.locator("#needs-attention")).toContainText("Pancakeo");
  expect(await page.evaluate(() => window.__played)).toEqual(["/assets/sounds/one-loud-crash.mp3"]);
  // The same failure sitting in the list does not announce itself again.
  await page.locator("#refresh-queue").click();
  await expect(page.locator("#queue-updated")).toContainText("Updated");
  expect(await page.evaluate(() => window.__played)).toEqual(["/assets/sounds/one-loud-crash.mp3"]);
  // A page opened after the fact treats the standing failure as old news.
  await page.goto("/");
  await expect(page.locator(`.pending-track[data-id="${failed.id}"]`)).toBeVisible();
  expect(await page.evaluate(() => window.__played)).toEqual([]);
});
