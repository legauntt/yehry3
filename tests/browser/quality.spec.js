import { test, expect } from "@playwright/test";

const issue = { code: "long_instrumental_outro", seconds: 22.86 };
const song = {
  id: "quality-song",
  title: "Samarie test recording",
  duration: 263.44,
  url: "/quality-fixture.wav",
  collection: "distonyc",
  collections: ["distonyc", "fearhunger"],
  qualityIssues: [issue, { code: "long_instrumental_break", seconds: 12.32 }, { code: "vocal_dropout", seconds: 1.2 }],
  lyrics: { text: "The final words.", kind: "written" },
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
  const wav = Buffer.alloc(32044);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(32036, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page.route("**/quality-fixture.wav", (route) =>
    route.fulfill({ body: wav, contentType: "audio/wav" }),
  );
  await page.route("**/yehry3/songs", (route) =>
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
      await expect(player).toHaveAttribute("src", /\/quality-fixture\.wav$/);
      await expect
        .poll(() => player.evaluate((audio) => audio.readyState))
        .toBeGreaterThan(0);
      await player.evaluate(async (audio) => {
        audio.currentTime = 0.2;
        await audio.play();
      });
      await expect
        .poll(() => player.evaluate((audio) => audio.currentTime))
        .toBeGreaterThan(0.2);
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
        /quality-fixture/,
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
  const attention = page.locator('.stats a[href="/admin/?status=failed"]');
  await expect(attention.locator("strong")).toHaveText("1");
  await expect(attention).toContainText("Needs Attention");
  await attention.click();
  await expect(page).toHaveURL(/\/admin\/\?status=failed$/);
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("failed");
  await expect(page.locator(".stats > *")).toHaveCount(5);
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
