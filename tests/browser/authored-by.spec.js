import { test, expect } from "@playwright/test";

// These browser fixtures exercise the UI without consuming shared login limits
// or changing the preview queue. Mongo-backed API tests cover saved metadata.
test.beforeEach(async ({ page }) => {
  let draft;
  await page.route("**/yehry3/session", route => route.fulfill({ json: { token: "author-browser-test" } }));
  await page.route(/\/yehry3\/prompts(?:\/[^/?]+)?$/, route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.continue();
    const body = request.postDataJSON();
    if (request.method() === "POST") draft = {
      id: "author-browser-request", prompt: body.prompt, authoredBy: body.authoredBy || "",
      version: 1, status: "draft", priority: 0,
    };
    if (request.method() === "PATCH") draft = {
      ...draft, authoredBy: body.authoredBy, version: draft.version + 1, status: "review",
      details: { direction: body.direction, keep: body.keep, basisSongIds: [], basisSongTitles: [] },
    };
    return route.fulfill({ json: { prompt: draft } });
  });
});

async function openRequests(page) {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await expect(page.getByLabel("Authored by")).toBeVisible();
}

test("author persists across browser sessions, edits, and submission into both queues", async ({ page, context, browser, baseURL }) => {
  const author = 'Jesse & <img src=x onerror="alert(1)">';
  const idea = "An authored song about taking the last train home.";
  await openRequests(page);
  await page.getByLabel("Authored by").fill("First name");
  await page.reload();
  await expect(page.getByLabel("Authored by")).toHaveValue("First name");
  await page.getByLabel("Your prompt").fill(idea);
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.getByLabel("Authored by")).toHaveValue("First name");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await page.getByLabel("What does it sound like?").fill("Warm acoustic guitar and close harmonies.");
  await page.getByRole("tab", { name: "Essentials", exact: true }).click();
  await page.getByLabel("What matters most?").fill("Tony's voice and the train hook.");
  await page.getByRole("button", { name: "Review the request" }).click();
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByLabel("Authored by").fill(author);
  const reviewed = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/yehry3/prompts/"));
  await page.getByRole("button", { name: "Review the request" }).click();
  const review = (await (await reviewed).json()).prompt;
  await page.reload();
  await expect(page.locator(".brief")).toContainText(author);
  await expect(page.locator(".brief img")).toHaveCount(0);
  // API tests cover real confirmation/publication. Keep this shared preview's
  // queue empty for other browser tests by simulating the confirmed response.
  const doc = { ...review, status: "queued", confirmedAt: new Date().toISOString(), version: review.version + 1 };
  await page.route("**/yehry3/prompts/*/confirm", route => route.request().method() === "OPTIONS"
    ? route.continue()
    : route.fulfill({ headers: { "access-control-allow-origin": baseURL }, json: { prompt: doc } }));
  await page.getByRole("button", { name: "Send to the queue" }).click();
  expect(doc.authoredBy).toBe(author);
  await expect(page.getByText("Request received", { exact: true })).toBeVisible();
  await expect(page.locator(".brief")).toContainText(author);
  const sessionActions = page.locator(".request-session-actions");
  await expect(sessionActions.getByRole("button")).toHaveText(["New request ↗", "Sign out ↗"]);
  await sessionActions.getByRole("button", { name: "New request" }).click();
  await expect(page.getByLabel("Authored by")).toHaveValue(author);

  const reopened = await browser.newContext({ baseURL, storageState: await context.storageState() });
  try {
    const next = await reopened.newPage();
    await next.goto("/distonyc/");
    await expect(next.getByLabel("Authored by")).toHaveValue(author);
    await next.getByLabel("Authored by").fill("");
    await next.reload();
    await expect(next.getByLabel("Authored by")).toHaveValue("");
  } finally {
    await reopened.close();
  }

  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [], recent: [], queued: [{ id: "distonyc-000000000000000000000001", idea: doc.prompt, authoredBy: doc.authoredBy, status: doc.status }],
    queuedTotal: 1, inStudioTotal: 0, page: 0, pageSize: 50,
  } }));
  await page.route("**/yehry3/admin/prompts?*", route => route.fulfill({ json: {
    prompts: [doc], counts: { queued: 1 }, total: 1, workers: [], transitions: {},
  } }));
  await page.goto("/");
  await expect(page.locator(".pending-track").filter({ hasText: idea }).locator("summary .authored-by")).toHaveText(`Authored by ${author}`);
  await page.goto("/queue/");
  await expect(page.locator("#waiting-queue .queue-card").filter({ hasText: idea }).locator(".authored-by")).toHaveText(`Authored by ${author}`);
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  const card = page.locator(`[data-prompt="${doc.id}"]`);
  await expect(card.locator(".queue-heading .authored-by")).toHaveText(`Authored by ${author}`);
  await expect(card.locator("img")).toHaveCount(0);
});

test("authorship appears in published lists, every public queue section, and song detail pages", async ({ page }) => {
  const author = 'A & <img src=x onerror="alert(1)">' + "X".repeat(60);
  const song = {
    id: "authored-song", title: "The Authored Song", authoredBy: author,
    duration: 200, collection: "distonyc", collections: ["distonyc", "fearhunger"],
    url: "https://example.com/song.mp3", lyrics: { text: "The train is coming home", kind: "written" },
    originalPrompt: { idea: "A train song", direction: "Acoustic", keep: "Tony", basisSongs: [] },
  };
  const blank = { ...song, id: "anonymous-song", title: "Anonymous song", authoredBy: undefined };
  const now = new Date().toISOString();
  const item = { ...song, idea: "A train song", updatedAt: now, publishedAt: now };
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: [song, blank] } }));
  await page.route("**/yehry3/songs/authored-song", route => route.fulfill({ json: { song } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: {
    inStudio: [{ ...item, id: "studio-song", status: "processing" }],
    queued: [{ ...item, id: "waiting-song", status: "queued" }],
    recent: [{ ...item, status: "published" }], queuedTotal: 1, inStudioTotal: 1, page: 0, pageSize: 50,
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [url, selector, count] of [
    ["/", '#tracks [data-id="authored-song"] .authored-by', 1],
    ["/queue/", ".public-queue-card .authored-by", 3],
    ["/lyrics/?song=authored-song", ".lyrics-sheet .authored-by", 1],
    ["/original-prompt/?song=authored-song", ".brief dd", 6],
    ["/fearhunger/", '[data-song-id="authored-song"] .authored-by', 1],
  ]) {
    await page.goto(url);
    const lines = page.locator(selector);
    await expect(lines).toHaveCount(count);
    await expect(lines.first()).toContainText(author);
    await expect(page.locator(".authored-by img, .brief img")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (url === "/") {
      await expect(page.locator('[data-id="anonymous-song"] .authored-by')).toHaveCount(0);
      await page.screenshot({ path: "artifacts/authored-by-list-mobile.png", fullPage: true });
    }
    if (url === "/queue/") await page.screenshot({ path: "artifacts/authored-by-queue-mobile.png", fullPage: true });
  }
  await page.route("**/yehry3/songs/summary", route => route.abort());
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [song] } }));
  await page.goto("/");
  await expect(page.locator("#tracks .authored-by")).toHaveText(`Authored by ${author}`);
});

test("unavailable local storage does not prevent author entry or requests", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } }));
  await openRequests(page);
  await page.getByLabel("Authored by").fill("Storage blocked author");
  await page.getByLabel("Your prompt").fill("A song that still works with storage blocked.");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.getByLabel("Authored by")).toHaveValue("Storage blocked author");
  await page.getByRole("button", { name: "Change the idea" }).click();
  await expect(page.getByLabel("Authored by")).toHaveValue("Storage blocked author");
});
