import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("repaired Backstage cards show the completed repair time and remove stale review actions", async ({ page }) => {
  const repairedAt = "2026-09-25T19:42:00.000Z";
  const base = { status: "published", version: 7, priority: 0, details: {}, history: [],
    confirmedAt: repairedAt, publishedAt: repairedAt, publishedUrl: "https://example.com/song.mp3",
    reviewState: "needs_review", result: { validationFailures: ["voice_validation"] } };
  const docs = [
    { ...base, id: "repaired", prompt: "The repaired performance", repairedAt,
      result: { ...base.result, qualityIssues: [{ code: "long_instrumental_break", seconds: 12 }] } },
    { ...base, id: "unresolved", prompt: "A recording still needing review" },
    { ...base, id: "older", prompt: "An earlier successful recovery", result: {}, history: [{ status: "failed" }, { status: "published" }] },
  ];
  await page.route("**/yehry3/session", route => route.fulfill({ json: { token: "test-session" } }));
  await page.route("**/yehry3/admin/prompts?*", route => route.fulfill({ json: {
    prompts: docs, total: docs.length, page: 0, counts: { published: 3, needs_review: 1 }, transitions: {}, workers: [],
  } }));
  await page.route("**/yehry3/admin/prompts/*/logs", route => route.fulfill({ json: { entries: [] } }));
  await page.goto("/admin/?status=all");
  await page.getByLabel("Password", { exact: true }).fill("test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
  const repaired = page.locator('[data-prompt="repaired"]');
  await expect(repaired.locator(".badge.needs_review")).toHaveCount(0);
  await expect(repaired.getByRole("button", { name: "Keep this version" })).toHaveCount(0);
  await expect(repaired.getByRole("button", { name: "Regenerate", exact: true })).toHaveCount(0);
  await expect(repaired.locator(".quality-notice summary")).toHaveText("Has issues");
  await expect(page.locator('[data-prompt="unresolved"] .badge.needs_review')).toBeVisible();
  await expect(page.locator('[data-prompt="unresolved"] .repair-badge')).toHaveCount(0);
  await expect(page.locator('[data-prompt="older"] .repair-badge')).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await repaired.evaluate(element => element.scrollIntoView({ block: "start" }));
    await repaired.getByRole("button", { name: /Repaired Sep 25, 2026/ }).click();
    const time = repaired.locator(".repair-time");
    await expect(time).toBeVisible();
    await expect(time).toBeInViewport();
    await expect(time).toContainText("12:42:00 PM PDT");
    const box = await time.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await mkdir("artifacts", { recursive: true });
    await page.screenshot({ path: `artifacts/repair-${width}.png` });
    await page.getByRole("heading", { name: "The repaired performance" }).click();
    await expect(time).toBeHidden();
  }
});
