import { test, expect } from "@playwright/test";

const issue = { code: "long_instrumental_outro", seconds: 22.86 };
const karaokeText = ["[Final]", "The final words.", ...Array.from({ length: 24 }, (_, index) => `An untimed lyric ${index + 1}.`), "Sing this last line."].join("\n");
const song = {
  id: "quality-song",
  title: "Samarie test recording",
  duration: 263.44,
  url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3",
  collection: "distonyc",
  collections: ["distonyc", "fearhunger"],
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
      const player = page.getByLabel("Play Samarie test recording");
      await expect(player).toHaveAttribute("src", /fear-and-hunger-dungeon-rock\.mp3$/);
      await expect
        .poll(() => player.evaluate((audio) => audio.readyState))
        .toBeGreaterThan(1);
      const lyric = page.getByRole("button", { name: "The final words." });
      await expect(lyric).toBeVisible();
      await lyric.click();
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
        .poll(() => page.getByLabel("Play Samarie test recording").evaluate((audio) => audio.currentTime))
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

test("a failed admin request shows the cause and can retry without opening controls", async ({
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
        action: "status",
        version: 4,
        status: "queued",
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
  await expect(attention).toContainText("Needs Attention");
  await attention.click();
  await expect(page).toHaveURL(/\/admin\/\?status=attention$/);
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("attention");
  await expect(page.locator(".stats > *")).toHaveCount(6);
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
  await page.getByRole("button", { name: "Retry saved work" }).click();
  await expect(page.locator(".queue-card .badge")).toHaveText("In the queue");
  await expect(attention.locator("strong")).toHaveText("0");
});
