import { test, expect } from "@playwright/test";

const id = "distonyc-" + "a".repeat(24);
const progress = { stage: "Waiting for the GPU", percent: 0 };
const base = { version: 1, confirmedAt: new Date().toISOString(), priority: 0, details: { voiceModel: "v8", basisSongTitles: [] }, history: [] };
let busy;
test.beforeEach(async ({ page }) => {
  busy = { ...base, id: "busy", status: "processing", prompt: "GPU waiting fixture", workerProgress: { ...progress } };
  await page.addInitScript(() => {
    sessionStorage.setItem("yehry3:admin", "isolated-test-token");
    sessionStorage.setItem("yehry3:submitter", "isolated-test-token");
    sessionStorage.setItem("yehry3:draft", "busy");
  });
  await page.route("**/yehry3/**", async route => {
    const path = new URL(route.request().url()).pathname.split("/yehry3")[1];
    const song = { id, status: busy.status, voiceModel: "v8", idea: busy.prompt, progress: busy.workerProgress, submittedAt: base.confirmedAt, updatedAt: base.confirmedAt };
    let data = {};
    if (path === "/admin/prompts") data = { prompts: [busy, { ...base, id: "denied", status: "failed", prompt: "Actual access error", workerProgress: progress, workerError: "Permission denied: retained diagnostic" }], total: 2, page: 0, counts: { processing: 1, failed: 1, attention: 1 }, transitions: { failed: ["queued", "canceled"] }, workers: [] };
    else if (path === "/queue") data = { inStudio: [song], needsAttention: [], queued: [], recent: [], inStudioTotal: 1, queuedTotal: 0, page: 0, pageSize: 50 };
    else if (path === `/queue/${id}`) data = song;
    else if (path === "/prompts/busy") data = { prompt: busy };
    else if (path === "/songs") data = { songs: [] };
    else if (path === "/capacity") data = { limit: 10, active: 1, available: 9, full: false };
    await route.fulfill({ json: data });
  });
});

test("GPU wait is visible in Backstage without opening controls; true errors remain", async ({ page }) => {
  await page.goto("/admin/?status=all");
  const active = page.locator('[data-prompt="busy"]');
  await expect(active.locator(".gpu-wait-notice")).toBeVisible();
  await expect(active.locator(".admin-brief")).not.toHaveAttribute("open");
  await expect(page.locator('[data-prompt="denied"] .field-error')).toContainText("Permission denied: retained diagnostic");
  await expect(page.locator('[data-prompt="denied"] .gpu-wait-notice')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("public queue and details explain the wait and clear it when rendering resumes", async ({ page }) => {
  await page.goto("/queue/");
  await expect(page.locator(".gpu-wait-notice")).toContainText("continue automatically");
  await page.goto(`/queue/details/?request=${id}`);
  await expect(page.locator(".gpu-wait-notice")).toBeVisible();
  busy.workerProgress = { stage: "Generating the arrangement", percent: 12 };
  await page.reload();
  await expect(page.locator(".gpu-wait-notice")).toHaveCount(0);
  await expect(page.locator(".queue-detail")).toContainText("Generating the arrangement");
});

test("request status and collapsed catalog row surface the GPU wait", async ({ page }) => {
  await page.goto("/distonyc/");
  await expect(page.locator(".gpu-wait-notice")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".pending-track summary")).toContainText("Waiting for the GPU");
});
