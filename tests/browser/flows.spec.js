import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { lyricsHref } from "../../assets/song-links.js";
const songCount = JSON.parse(
  await readFile(new URL("../../catalog.json", import.meta.url), "utf8"),
).songs.length;
test("catalog, search, player, and anonymous vote cooldown", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(songCount);
  await expect(page.locator("[data-vote]").first()).toBeEnabled();
  await page.getByLabel("Search songs").fill("Fear and Hunger");
  await expect(page.locator(".track")).toHaveCount(3);
  await page.locator("[data-play]").first().click();
  await expect(page.locator(".player")).toBeVisible();
  await expect(page.locator("#now-title")).toContainText("Fear and Hunger");
  await expect
    .poll(() => page.locator("#audio").evaluate((audio) => audio.readyState))
    .toBeGreaterThan(0);
  await page.locator("[data-vote]").first().click();
  await expect(page.locator("#message")).toContainText("Vote counted");
  await expect(page.locator("[data-vote]").first()).toHaveClass(/has-votes/);
  await expect(page.locator("[data-vote] span").first()).toHaveText("♥");
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await page.reload();
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await expect(page.locator("#vote-note")).toContainText("next vote");
  await expect(page.locator("#vote-note")).toContainText(
    "One anonymous vote per hour across the collection",
  );
  await expect(page.locator("#vote-note")).toContainText(
    "Shared networks share the limit",
  );
  await page.locator(".vote-hint").first().hover();
  await expect(page.getByRole("tooltip").first()).toBeVisible();
  await expect(page.getByRole("tooltip").first()).toContainText("next vote");
  await mkdir("artifacts", { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/collection-desktop.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
test("shareable collection, search and sort survive reload and browser history", async ({
  page,
  context,
}) => {
  await page.route("**/yehry3/songs", (route) => route.abort());
  await page.goto("/?ref=friend#collection-title");
  await expect(page.locator(".track")).toHaveCount(songCount);
  await page.getByLabel("Collection", { exact: true }).selectOption("shiablo");
  await expect(page.locator(".track")).toHaveCount(3);
  await expect(page.locator(".track a[href^='/lyrics/']")).toHaveCount(3);
  expect(new URL(page.url()).searchParams.get("collection")).toBe("shiablo");
  await page.getByLabel("Sort songs").selectOption("title");
  await expect(page.locator(".track h3").first()).toContainText("Khalim");
  const sortedUrl = page.url();
  await page.getByLabel("Search songs").pressSequentially("Khalim");
  await expect(page.locator(".track")).toHaveCount(1);
  const sharedUrl = page.url();
  const params = new URL(sharedUrl).searchParams;
  expect(params.get("q")).toBe("Khalim");
  expect(params.get("sort")).toBe("title");
  expect(params.get("ref")).toBe("friend");
  expect(new URL(sharedUrl).hash).toBe("#collection-title");
  await page.goBack();
  await expect(page).toHaveURL(sortedUrl);
  await expect(page.getByLabel("Search songs")).toHaveValue("");
  await expect(page.locator(".track")).toHaveCount(3);
  await page.goBack();
  await expect(page.getByLabel("Sort songs")).toHaveValue("hybrid");
  await page.goForward();
  await expect(page.getByLabel("Sort songs")).toHaveValue("title");
  await page.goForward();
  await expect(page.getByLabel("Search songs")).toHaveValue("Khalim");
  await page.reload();
  await expect(page.getByLabel("Collection", { exact: true })).toHaveValue(
    "shiablo",
  );
  await expect(page.getByLabel("Sort songs")).toHaveValue("title");
  await expect(page.getByLabel("Search songs")).toHaveValue("Khalim");
  await expect(page.locator(".track")).toHaveCount(1);
  const recipient = await context.newPage();
  await recipient.route("**/yehry3/songs", (route) => route.abort());
  await recipient.goto(sharedUrl);
  await expect(recipient.locator(".track h3")).toContainText(
    "Khalim Still Has a Heart",
  );
  await expect(recipient.getByLabel("Sort songs")).toHaveValue("title");
  await recipient.close();
  await page.getByLabel("Search songs").fill("Fear & Hunger / Tony's + hook");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("Fear & Hunger / Tony's + hook");
  await page.reload();
  await expect(page.getByLabel("Search songs")).toHaveValue(
    "Fear & Hunger / Tony's + hook",
  );
  await page.getByLabel("Search songs").fill("");
  await page.getByLabel("Collection", { exact: true }).selectOption("all");
  await page.getByLabel("Sort songs").selectOption("hybrid");
  await expect(page).toHaveURL(/\/\?ref=friend#collection-title$/);
  await expect(page.locator(".track")).toHaveCount(songCount);
  await page.goto("/?collection=unknown&sort=unknown");
  await expect(page.getByLabel("Collection", { exact: true })).toHaveValue(
    "all",
  );
  await expect(page.getByLabel("Sort songs")).toHaveValue("hybrid");
  await expect(page.locator(".track")).toHaveCount(songCount);
  await expect
    .poll(() =>
      page.locator(".band-cutout").evaluate((img) => img.naturalWidth),
    )
    .toBe(1000);
  await page.screenshot({ path: "artifacts/band-hero-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/band-hero-mobile.png",
    fullPage: false,
  });
});

test("password, two turns, queue submission, admin priority, cancel and retry", async ({
  page,
}) => {
  await page.goto("/distonyc/");
  await expect(
    page.getByText("Never share your password with anyone"),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await expect(page.locator("#form-error")).toContainText("did not work");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page
    .getByLabel("Your prompt")
    .fill("Rendition of Medusa as a barbershop quartet");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.getByText("Here’s what I’m hearing.")).toBeVisible();
  await expect(page.getByLabel("Tony voice model")).toHaveValue("v7");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await page.locator(".basis-picker summary").click();
  await page.getByRole("checkbox", { name: /^Medusa \(/ }).check();
  await page
    .getByLabel("What does it sound like?")
    .fill("A playful four-part barbershop quartet with no instruments.");
  await page.getByRole("tab", { name: "Essentials", exact: true }).click();
  await page
    .getByLabel("What matters most?")
    .fill("Preserve the original melody, lyrics and slurred main hook.");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByText("Does this sound right?")).toBeVisible();
  await page.screenshot({ path: "artifacts/request-review-desktop.png" });
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await page.locator(".basis-picker summary").click();
  await expect(
    page.getByRole("checkbox", { name: /^Medusa \(/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByLabel("Yes, this is the song I want to request.")).toHaveCount(0);
  await page.getByRole("button", { name: "Send to the queue" }).click();
  await expect(
    page.getByText("Request received", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".brief")).toContainText("Tony V7 · experimental");
  await page.reload();
  await expect(
    page.getByText("Request received", { exact: true }),
  ).toBeVisible();
  await page.route("**/yehry3/prompts/*", (route) => route.abort());
  await page.reload();
  await expect(page.getByText("Your request is still saved.")).toBeVisible();
  await page.unroute("**/yehry3/prompts/*");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("Request received", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator("#form-error")).toContainText("did not work");
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await page.getByLabel("Priority", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.locator(".queue-card")).toContainText("Priority 10");
  await page.getByText("Open brief & controls").click();
  await page
    .getByLabel("Private admin note")
    .fill("Start with the Medusa source recording.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByLabel("Private admin note")).toBeHidden();
  await page.getByText("Open brief & controls").click();
  await page.getByLabel("Move request to").selectOption("canceled");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("queued");
  await expect(page.locator(".queue-card")).toHaveCount(0);
  await page.getByRole("link", { name: "All requests" }).click();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("all");
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await page.getByLabel("Show", { exact: true }).selectOption("canceled");
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await page.getByText("Open brief & controls").click();
  await expect(page.getByLabel("Private admin note")).toHaveValue(
    "Start with the Medusa source recording.",
  );
  await page.getByLabel("Move request to").selectOption("queued");
  await page.getByRole("button", { name: "Update status" }).click();
  await page.getByLabel("Show", { exact: true }).selectOption("queued");
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await expect(page.locator(".queue-card .badge")).toHaveText("In the queue");
  await page.getByText("Open brief & controls").click();
  await page.getByLabel("Move request to").selectOption("processing");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("queued");
  await expect(page.locator(".queue-card")).toHaveCount(0);
  await page.getByLabel("Show", { exact: true }).selectOption("processing");
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue(
    "processing",
  );
  await expect(page.locator(".queue-card .badge")).toHaveText("In the studio");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/admin-desktop.png" });
});

test("public queue, browser alert opt-in, completion deduplication and mobile layout", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"], {
    origin: "http://127.0.0.1:8080",
  });
  await page.addInitScript(() => {
    window.testNotifications = [];
    // Chromium's headless shell reports permission=denied even after a grant.
    // Stub only the OS permission/display boundary; use a real service worker.
    // https://github.com/microsoft/playwright/issues/23954
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => "granted",
    });
    ServiceWorkerRegistration.prototype.showNotification = async function (
      title,
      options,
    ) {
      window.testNotifications.push({ title, options });
    };
  });
  const active = {
    id: "distonyc-" + "a".repeat(24),
    idea: "<img src=x onerror=alert(1)> as a new Tony song",
    title: null,
    status: "processing",
    updatedAt: new Date().toISOString(),
    progress: { stage: "Generating Tony vocals", percent: 55 },
  };
  const past = {
    ...active,
    id: "distonyc-" + "b".repeat(24),
    idea: "Earlier original",
    title: "Earlier song",
    status: "published",
    progress: null,
    publishedAt: new Date().toISOString(),
    url: "https://example.com/earlier.mp3",
  };
  let data = {
    inStudio: [active],
    queued: [],
    recent: [past],
    queuedTotal: 0,
    inStudioTotal: 1,
    page: 0,
    pageSize: 50,
  };
  await page.route("**/yehry3/queue?*", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/queue/");
  await expect(page.locator("#in-studio")).toContainText(active.idea);
  await expect(page.locator("#in-studio img")).toHaveCount(0);
  await expect(page.locator("#in-studio progress")).toHaveAttribute(
    "value",
    "55",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.testNotifications.length))
    .toBe(0);
  await expect(page.getByRole("button", { name: "Turn off browser alerts" })).toBeEnabled();
  await expect(page.locator("#alert-status")).toContainText("Alerts are on");
  expect(await page.evaluate(() => Notification.permission)).toBe("granted");
  expect(await page.evaluate(() => window.testNotifications.length)).toBe(0);
  data = {
    ...data,
    inStudio: [],
    inStudioTotal: 0,
    recent: [
      {
        ...active,
        title: "Brand new song",
        status: "published",
        publishedAt: new Date().toISOString(),
        url: "https://example.com/new.mp3",
      },
      past,
    ],
  };
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("#release-announcement")).toContainText(
    "Brand new song",
  );
  await expect
    .poll(() => page.evaluate(() => window.testNotifications.length))
    .toBe(1);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("#refresh-queue")).toBeEnabled();
  expect(await page.evaluate(() => window.testNotifications.length)).toBe(1);
  await page.getByRole("button", { name: "Turn off browser alerts" }).click();
  await expect(page.locator("#alert-status")).toContainText("Alerts are off");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/public-queue-mobile.png",
    fullPage: true,
  });
});
test("mobile layout, API outage, and escaped prompt content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/yehry3/songs", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(songCount);
  await expect(page.locator("#vote-note")).toContainText("offline");
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await expect(page.locator("#vote-note")).toContainText(
    "One anonymous vote per hour",
  );
  await page.locator(".vote-hint").first().focus();
  await expect(page.getByRole("tooltip").first()).toContainText(
    "temporarily offline",
  );
  await expect(page.getByRole("tooltip").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/collection-mobile.png",
    fullPage: false,
  });
  await page.goto("/longtimecomin");
  await expect(page).toHaveURL(/\/distonyc\/$/);
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page
    .getByLabel("Your prompt")
    .fill("<img src=x onerror=alert(1)> as a barbershop quartet");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.locator("blockquote")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("blockquote img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/request-mobile.png",
    fullPage: true,
  });
});

test("optional basis songs, A-Z list, five-song cap, and saved review", async ({
  page,
}) => {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page
    .getByLabel("Your prompt")
    .fill("An original Tony song about a late train home.");
  await page.getByRole("button", { name: "Find the direction" }).click();
  expect(await page.locator("#direction").getAttribute("required")).toBeNull();
  expect(await page.locator("#keep").getAttribute("required")).toBeNull();
  await expect(page.getByLabel("Tony voice model")).toHaveValue("v7");
  await expect(page.getByRole("tabpanel", { name: "Advanced", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.locator(".brief")).toContainText("Tony V7 · experimental");
  await expect(page.locator(".brief")).toContainText("No basis song");
  await expect(page.locator(".brief")).toContainText("Use the prompt as written.");
  await expect(page.locator(".brief")).toContainText("Surprise me.");
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByLabel("Tony voice model").selectOption("v6");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.getByText("Your chosen Tony voice is always included.")).toBeVisible();
  await page.locator(".basis-picker summary").click();
  const boxes = page.locator(".basis-option input");
  const titles = await page.locator(".basis-option span").allTextContents();
  expect(titles.length).toBeGreaterThanOrEqual(61);
  expect(titles).toEqual(
    [...titles].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  );
  for (let i = 0; i < 5; i++) await boxes.nth(i).check();
  await expect(boxes.nth(5)).toBeDisabled();
  await boxes.nth(0).uncheck();
  await expect(boxes.nth(5)).toBeEnabled();
  await boxes.nth(5).check();
  await page.getByRole("button", { name: "Review the request" }).click();
  await page.reload();
  await expect(page.getByText("Does this sound right?")).toBeVisible();
  await expect(page.locator(".brief")).toContainText("Tony V6 · established");
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByRole("tab", { name: "Essentials", exact: true }).click();
  await expect(page.getByLabel("Tony voice model")).toHaveValue("v6");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await page.locator(".basis-picker summary").click();
  await expect(page.locator(".basis-option input:checked")).toHaveCount(5);
  await expect(page.locator("#basis-count")).toHaveText("5 of 5 selected");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/basis-picker-mobile.png",
    fullPage: true,
  });
});

test("generated song lyrics, dual collection filtering, and API outage fallback", async ({
  page,
}) => {
  await page.route("**/yehry3/songs", (route) => route.abort());
  await page.goto("/?collection=fearhunger");
  const song = page.locator(
    '.track[data-id="distonyc-1d7840d9c9addba07ccabdb2"]',
  );
  await expect(song).toContainText("Blood on My Shoes at Daybreak");
  await expect(song).toContainText("Fear & Hunger");
  await page.getByLabel("Collection", { exact: true }).selectOption("distonyc");
  await expect(song).toBeVisible();
  await song
    .getByRole("link", { name: "Lyrics for Blood on My Shoes at Daybreak" })
    .click();
  await expect(page).toHaveURL(/\/lyrics\/blood-on-my-shoes-at-daybreak-[0-9a-f]{6}\/$/);
  await expect(page.locator("h1")).toHaveText("Blood on My Shoes at Daybreak");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Blood on My Shoes at Daybreak · Lyrics · yehry3",
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    /Which shoe's mine\? Both\? That's unfortunate\./,
  );
  await expect(page.locator(".lyrics-text")).toContainText(
    "Blood on my shoes, dawn in my eyes",
  );
  await expect(page.locator("button.lyric-line")).toHaveCount(65);
  await expect(page.locator("button.lyric-line").first()).toHaveAttribute(
    "data-start",
    /^\d/,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download lyrics" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "Blood on My Shoes at Daybreak-lyrics.txt",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/lyrics-mobile.png",
    fullPage: true,
  });
});

test("published original prompts show confirmed settings, work offline, and escape user text", async ({
  page,
}) => {
  const catalog = JSON.parse(
    await readFile(new URL("../../catalog.json", import.meta.url), "utf8"),
  );
  const song = catalog.songs.find(
    (song) => song.id === "distonyc-1d7840d9c9addba07ccabdb2",
  );
  await page.route("**/yehry3/songs", (route) => route.abort());
  await page.goto("/?collection=distonyc");
  await page
    .getByRole("link", {
      name: "Original prompt for Blood on My Shoes at Daybreak",
    })
    .click();
  await expect(page).toHaveURL(/\/original-prompt\/\?song=distonyc-/);
  await expect(page.locator(".original-prompt h1")).toHaveText(song.title);
  await expect(page.locator(".brief dd").nth(0)).toHaveText(
    song.originalPrompt.idea,
  );
  await expect(page.locator(".brief dd").nth(1)).toHaveText(
    "Tony V6 · established",
  );
  await expect(page.locator(".brief dd").nth(2)).toHaveText(
    song.originalPrompt.direction,
  );
  await expect(page.locator(".brief dd").nth(3)).toHaveText(
    song.originalPrompt.keep,
  );
  await expect(page.locator(".brief dd").nth(4)).toHaveText(
    "No basis songs selected.",
  );
  await page.reload();
  await expect(page.locator(".original-prompt h1")).toHaveText(song.title);
  await page.unroute("**/yehry3/songs");
  const fixture = {
    ...song,
    originalPrompt: {
      ...song.originalPrompt,
      idea: '<img src=x onerror="alert(1)"> as a duet',
      basisSongs: ["A & B", "Two", "Three", "Four", "Five"],
    },
  };
  await page.route("**/yehry3/songs", (route) =>
    route.fulfill({ json: { songs: [fixture] } }),
  );
  await page.reload();
  await expect(page.locator(".brief dd").nth(0)).toHaveText(
    fixture.originalPrompt.idea,
  );
  await expect(page.locator(".brief img")).toHaveCount(0);
  await expect(page.locator(".brief dd").nth(4)).toHaveText(
    fixture.originalPrompt.basisSongs.join("\n"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/original-prompt-mobile.png",
    fullPage: true,
  });
  await page.goto("/original-prompt/?song=missing-song");
  await expect(page.locator("h1")).toHaveText(
    "This brief is not available yet.",
  );
});

test("Fear and Hunger includes tagged requests, refreshes without duplicates, and keeps playback working", async ({
  page,
}) => {
  const catalog = JSON.parse(
    await readFile(new URL("../../catalog.json", import.meta.url), "utf8"),
  );
  const blood = catalog.songs.find(
    (song) => song.id === "distonyc-1d7840d9c9addba07ccabdb2",
  );
  const matching = catalog.songs.filter(
    (song) =>
      song.collection === "fearhunger" ||
      song.collections?.includes("fearhunger"),
  );
  let data = { songs: catalog.songs };
  await page.route("**/yehry3/songs", (route) => route.fulfill({ json: data }));
  const audioFixture = new URL(
    catalog.songs.find((song) => song.collection === "fearhunger").url,
    "http://127.0.0.1:8080",
  ).href;
  // Azure can serve this directory without a redirect or trailing slash.
  await page.route("**/fearhunger", async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: await readFile(
        new URL("../../fearhunger/index.html", import.meta.url),
        "utf8",
      ),
    }),
  );
  await page.goto("/fearhunger");
  await expect(page).toHaveURL(/\/fearhunger$/);
  await expect(page.locator("#collection-note")).toContainText(
    `${matching.length} songs`,
  );
  const current = page.locator(`[data-song-id="${blood.id}"]`);
  await expect(current).toContainText(blood.title);
  await expect(
    page.getByText("Two Names in One Pair of Shoes", { exact: true }),
  ).toBeVisible();
  await expect(current.locator(".lyrics-link")).toHaveAttribute(
    "href",
    lyricsHref(blood),
  );
  await expect(current.locator(".original-prompt-link")).toHaveAttribute(
    "href",
    `/original-prompt/?song=${blood.id}`,
  );
  // Exercise the player's events with a local real MP3, avoiding a large remote download.
  await current.locator("audio").evaluate((audio, src) => {
    audio.src = src;
  }, audioFixture);
  await page.getByRole("button", { name: "Play all", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((audio) => audio.paused),
    )
    .toBe(false);
  // Wait for the first native play event to reach the UI before switching tracks.
  await expect(page.locator(".track").first()).toHaveClass(/is-playing/);
  await current.locator("audio").evaluate((audio) => audio.play());
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((audio) => audio.paused),
    )
    .toBe(true);
  await expect(current).toHaveClass(/is-playing/);
  await expect(page.locator("#status")).toHaveText(`Playing ${blood.title}.`);
  const future = {
    ...blood,
    id: "future-funger-song",
    title: "A future dungeon song",
    url: audioFixture,
  };
  const unrelated = {
    ...blood,
    id: "unrelated-song",
    title: "An unrelated song",
    collections: ["distonyc"],
  };
  data = { songs: [...catalog.songs, future, unrelated] };
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".track:visible")).toHaveCount(matching.length + 1);
  await expect(page.getByText(unrelated.title, { exact: true })).toHaveCount(0);
  await expect
    .poll(() => current.locator("audio").evaluate((audio) => audio.paused))
    .toBe(false);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".track:visible")).toHaveCount(matching.length + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/fearhunger-mobile.png",
    fullPage: true,
  });
  await page.unroute("**/yehry3/songs");
  await page.route("**/yehry3/songs", (route) => route.abort());
  await page.reload();
  await expect(page.locator("#collection-note")).toContainText(
    "temporarily offline",
  );
  await expect(page.locator(".track:visible")).toHaveCount(matching.length);
});
