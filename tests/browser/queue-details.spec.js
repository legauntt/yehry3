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
