import { test, expect } from "@playwright/test";

const issue = { code: "long_instrumental_outro", seconds: 22.86 };
for (const action of ["keep", "regenerate"]) test(`Backstage can ${action} a playable review${action === "keep" ? " without unpublishing it" : " and archives the original"}`, async ({ page }) => {
  let doc = { id: "published-review", prompt: "A retained performance", status: "published", version: 1,
    reviewState: "needs_review", validationFailures: ["voice_validation"],
    result: { validationFailures: ["voice_validation"] }, details: {}, history: [],
    publishedUrl: "https://example.com/retained.mp3", confirmedAt: new Date().toISOString() };
  await page.route("**/yehry3/session", route => route.fulfill({ json: { token: "test-session" } }));
  await page.route("**/yehry3/admin/prompts?*", route => route.fulfill({ json: {
    prompts: [doc], total: 1, page: 0, counts: { published: 1, needs_review: doc.reviewState ? 1 : 0 }, transitions: {}, workers: [],
  } }));
  await page.route("**/yehry3/admin/prompts/published-review", route => {
    if (action === "regenerate") {
      expect(route.request().postDataJSON()).toEqual({ action, version: 1, requestId: expect.any(String) });
      return route.fulfill({ json: { draftId: "new-review-draft" } });
    }
    expect(route.request().postDataJSON()).toEqual({ action: "keep", version: 1 });
    doc = { ...doc, version: 2, reviewState: undefined };
    return route.fulfill({ json: { prompt: doc } });
  });
  await page.goto("/admin/?status=needs_review");
  await page.getByLabel("Password", { exact: true }).fill("test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeVisible();
  if (action === "regenerate") {
    await expect(page.getByText("This recording stays up until you send the new request to the queue; then it is archived and leaves the site.")).toBeVisible();
    await page.getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(page).toHaveURL(/\/distonyc\/$/);
    expect(await page.evaluate(() => sessionStorage.getItem("yehry3:draft"))).toBe("new-review-draft");
    expect(doc.status).toBe("published");
    return;
  }
  await page.getByRole("button", { name: "Keep this version" }).click();
  await expect(page.locator(".badge.needs_review")).toHaveCount(0);
  await expect(page.locator(".queue-heading .badge").first()).toHaveText("Published");
  await page.getByText("Open brief & controls", { exact: false }).click();
  await expect(page.getByRole("link", { name: "Open published song" })).toHaveAttribute("href", doc.publishedUrl);
});
test("a song that just published shows its raw logs in Backstage until they expire", async ({ page }) => {
  const now = Date.now();
  const doc = (id, publishedAt, extra = {}) => ({ id, prompt: `Song ${id}`, status: "published", version: 1, details: {}, history: [],
    publishedUrl: "https://example.com/song.mp3", confirmedAt: new Date(now - 90 * 3600000).toISOString(), publishedAt: new Date(publishedAt).toISOString(), ...extra });
  const docs = [
    doc("fresh-review", now - 3600000, { reviewState: "needs_review", validationFailures: ["voice_validation"], result: { validationFailures: ["voice_validation"] } }),
    doc("old-review", now - 60 * 3600000, { reviewState: "needs_review", validationFailures: ["voice_validation"], result: { validationFailures: ["voice_validation"] } }),
    doc("old-plain", now - 60 * 3600000),
  ];
  await page.route("**/yehry3/session", route => route.fulfill({ json: { token: "test-session" } }));
  await page.route("**/yehry3/admin/prompts?*", route => route.fulfill({ json: {
    prompts: docs, total: 3, page: 0, counts: { published: 3, needs_review: 2 }, transitions: {}, workers: [],
  } }));
  await page.route("**/yehry3/admin/prompts/*/dehaka", route => route.fulfill({ json: { entries: [] } }));
  await page.route("**/yehry3/admin/prompts/fresh-review/dehaka", route => route.fulfill({ json: { entries: [{
    id: "log-1", author: "worker", kind: "log", action: "published", at: new Date(now - 3000000).toISOString(),
    expiresAt: new Date(now + 23 * 3600000).toISOString(), text: "Published, flagged Needs review (1 validation failure).",
    logs: [{ name: "renderer.log", text: "stage mix complete <done>" }] }] } }));
  await page.goto("/admin/?status=all");
  await page.getByLabel("Password", { exact: true }).fill("test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  const fresh = page.locator('[data-prompt="fresh-review"]');
  await expect(fresh.locator(".completion-logs h3")).toHaveText("Raw logs");
  await expect(fresh.locator(".completion-logs .dehaka-expiry")).toContainText("expires");
  await fresh.locator(".dehaka-log summary").click();
  await expect(fresh.locator(".dehaka-log pre")).toHaveText("stage mix complete <done>");
  await expect(fresh.locator(".dehaka-waiting")).toContainText("kept for 24 hours");
  await expect(fresh.locator(".dehaka-form")).toHaveCount(0);
  await page.setViewportSize({ width: 1400, height: 900 });
  const [logs, card] = await Promise.all([fresh.locator(".completion-logs").boundingBox(), fresh.boundingBox()]);
  expect(logs.width).toBeGreaterThan(850);
  expect(card.x + card.width - (logs.x + logs.width)).toBeLessThan(40);
  await expect(page.locator('[data-prompt="old-review"] .completion-logs .dehaka-empty')).toContainText("No raw logs are kept");
  await expect(page.locator('[data-prompt="old-plain"] .completion-logs')).toHaveCount(0);
});
const karaokeText = ["[Final]", "The final words.", ...Array.from({ length: 24 }, (_, index) => `An untimed lyric ${index + 1}.`), "Sing this last line."].join("\n");
const song = {
  id: "quality-song",
  title: "Samarie test recording",
  duration: 263.44,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  collection: "distonyc",
  collections: ["distonyc", "fearhunger"],
  reviewState: "needs_review", validationFailures: ["voice_validation"],
  qualityIssues: [issue, { code: "long_instrumental_break", seconds: 12.32 }, { code: "vocal_dropout", seconds: 1.2 }],
  lyrics: { text: karaokeText, kind: "written", cues: [{ line: 1, start: 2.5, end: 4.5 }, { line: 26, start: 8, end: 10 }] },
  originalPrompt: {
    idea: "An angry song about Samarie",
    direction: "Opera rock",
    keep: "Tony vocals",
    basisSongs: [],
  },
};

test("a song with issues remains playable and exposes its warning on every listening page", async ({
  page,
}) => {
  await page.route("**/yehry3/songs/quality-song", route => route.fulfill({ json: { song } }));
  await page.route("**/yehry3/songs/summary", (route) =>
    route.fulfill({ json: { songs: [song], nextVoteAt: null } }),
  );
  await page.route("**/yehry3/queue?*", (route) =>
    route.fulfill({
      json: {
        inStudio: [],
        queued: [],
        recent: [
          {
            ...song,
            status: "published",
            idea: "An angry song about Samarie",
            publishedAt: new Date().toISOString(),
          },
        ],
        queuedTotal: 0,
        inStudioTotal: 0,
        page: 0,
        pageSize: 50,
      },
    }),
  );
  for (const path of [
    "/",
    "/lyrics/?song=quality-song",
    "/queue/",
    "/fearhunger/",
  ]) {
    await page.goto(path);
    if (path.startsWith("/lyrics/")) {
      // The site's one player takes the song when a line is chosen with nothing else playing.
      const player = page.locator("#audio");
      await expect(page.getByRole("button", { name: "Play Samarie test recording" })).toBeVisible();
      const lyric = page.getByRole("button", { name: "The final words." });
      await expect(lyric).toBeVisible();
      await lyric.click();
      await expect(player).toHaveAttribute("src", /fear-and-hunger-dungeon-rock\.mp3$/);
      await expect
        .poll(() => player.evaluate((audio) => audio.readyState))
        .toBeGreaterThan(1);
      await expect(page).toHaveURL(/\/lyrics\/\?song=quality-song#lyric-line-2$/);
      await expect(lyric).toHaveClass(/is-linked/);
      await expect(lyric.getByText("Shared line")).toBeVisible();
      await expect.poll(() => player.evaluate((audio) => audio.currentTime)).toBeCloseTo(2.5, 1);
      await page.reload();
      const linkedLyric = page.getByRole("button", { name: /The final words/ });
      await expect(linkedLyric).toBeInViewport();
      await expect(linkedLyric).toHaveClass(/is-linked/);
      await expect(linkedLyric.getByText("Shared line")).toBeVisible();
      await expect
        .poll(() => page.locator("#audio").evaluate((audio) => audio.currentTime))
        .toBeCloseTo(2.5, 1);
      const laterLyric = page.getByRole("button", { name: "Sing this last line." });
      await player.evaluate((audio) => {
        audio.currentTime = 5.5;
      });
      await expect(linkedLyric).toHaveClass(/is-active/);
      await expect(laterLyric).not.toHaveClass(/is-active/);
      await page.evaluate(() => scrollTo(0, 0));
      await player.evaluate(async (audio) => {
        audio.currentTime = 8.5;
        await audio.play();
      });
      await expect(laterLyric).toHaveClass(/is-active/);
      await expect(laterLyric).not.toHaveClass(/is-linked/);
      await expect(linkedLyric).toHaveClass(/is-linked/);
      await expect.poll(() => laterLyric.evaluate((line) => {
        const box = line.getBoundingClientRect();
        return box.top > innerHeight * 0.2 && box.bottom < innerHeight * 0.8;
      })).toBe(true);
      await expect
        .poll(() => player.evaluate((audio) => audio.currentTime))
        .toBeGreaterThan(8.5);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await linkedLyric.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "artifacts/lyrics-shared-line-mobile.png" });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const notice = page.locator(".quality-notice:visible");
    await expect(notice).toHaveCount(1);
    await expect(page.locator(".badge.needs_review:visible")).toHaveText("Needs review");
    await expect(notice.locator("summary")).toHaveText("Review notes");
    await notice.locator("summary").click();
    await expect(notice).toContainText("23 seconds");
    await expect(notice).toContainText("12 seconds between detected vocals");
    await expect(notice).toContainText("A vocal passage could not be fully restored (1.2 seconds).");
    await expect(notice).toContainText("available to play");
    if (path === "/") {
      await page
        .locator(".collection")
        .screenshot({ path: "artifacts/quality-row-desktop.png" });
      await page
        .getByRole("button", {
          name: "Play Samarie test recording",
          exact: true,
        })
        .click();
      await expect(page.locator("#audio")).toHaveAttribute(
        "src",
        /fear-and-hunger-dungeon-rock/,
      );
      await expect
        .poll(() =>
          page.locator("#audio").evaluate((audio) => audio.currentTime),
        )
        .toBeGreaterThan(0.1);
      await expect(page.locator(".player")).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".track")).toHaveCount(1);
  await page.locator(".quality-notice summary").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".collection")
    .screenshot({ path: "artifacts/quality-row-mobile.png" });
});

test("a published queue detail stays playable while marked Needs review", async ({ page }) => {
  const id = `distonyc-${"a".repeat(24)}`;
  const item = {
    id,
    idea: "A finished song with review notes",
    title: "Playable review fixture",
    status: "published",
    reviewState: "needs_review", validationFailures: ["voice_validation"],
    voiceModel: "v8",
    submittedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    url: "https://example.com/review.mp3",
    qualityIssues: [{ code: "long_instrumental_break", seconds: 19.54 }],
  };
  await page.route(`**/yehry3/queue/${id}`, route => route.fulfill({ json: item }));
  await page.goto(`/queue/details/?request=${id}`);
  await expect(page.locator(".queue-detail-status .badge").first()).toHaveText("Published");
  await expect(page.locator(".badge.needs_review")).toHaveText("Needs review");
  await expect(page.locator(".quality-notice summary")).toHaveText("Review notes");
  await expect(page.getByRole("link", { name: /Hear the song/ })).toHaveAttribute("href", item.url);
});

test("a failed admin request shows the cause and can hand it to Dehaka without opening controls", async ({
  page,
}) => {
  let doc = {
    id: "failed-quality-test",
    prompt: "An angry song about Samarie",
    status: "failed",
    version: 4,
    priority: 0,
    confirmedAt: new Date().toISOString(),
    details: {},
    history: [],
    workerError:
      "Mastering failed: Missing vocal phrase. Saved work is retained.",
    workerProgress: { stage: "Mastering and exporting", percent: 86.7 },
  };
  await page.route("**/yehry3/session", (route) =>
    route.fulfill({ json: { token: "test-session" } }),
  );
  await page.route("**/yehry3/admin/prompts?*", (route) =>
    route.fulfill({
      json: {
        prompts: [doc],
        total: 1,
        page: 0,
        counts: { [doc.status]: 1 },
        transitions: { failed: ["queued", "canceled"], queued: ["canceled"] },
        workers: [],
      },
    }),
  );
  await page.route(
    "**/yehry3/admin/prompts/failed-quality-test",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        action: "shepherd",
        version: 4,
        guidance: "Whatever it takes to fix this.",
      });
      doc = {
        ...doc,
        status: "queued",
        version: 5,
        workerError: null,
        workerProgress: null,
      };
      await route.fulfill({ json: { prompt: doc } });
    },
  );
  await page.goto("/admin/");
  await page.getByLabel("Password", { exact: true }).fill("test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  const attention = page.locator('.stats a[href="/admin/?status=attention"]');
  await expect(attention.locator("strong")).toHaveText("1");
  await expect(attention).toContainText("9/11'd Again");
  await attention.click();
  await expect(page).toHaveURL(/\/admin\/\?status=attention$/);
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("attention");
  await expect(page.locator(".stats > *")).toHaveCount(7);
  await page.locator(".stats").screenshot({ path: "artifacts/admin-attention-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".stats").screenshot({ path: "artifacts/admin-attention-mobile.png" });
  await expect(
    page.getByText(/Mastering failed: Missing vocal phrase/),
  ).toBeVisible();
  await expect(page.locator(".queue-card > details")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.getByRole("button", { name: "Retry saved work" })).toHaveCount(0);
  await page.getByRole("button", { name: "Dehaka" }).click();
  await expect(page.locator(".queue-card .badge")).toHaveText("In the queue");
  await expect(attention.locator("strong")).toHaveText("0");
});
