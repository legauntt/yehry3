import { test, expect } from "@playwright/test";

const id = "clippy-test-request";
const base = { id, status: "failed", priority: 0, version: 3, prompt: "Saved song",
  details: {}, confirmedAt: "2026-10-03T16:45:00Z", history: [],
  workerError: "Eleven Music 400 bad_composition_plan" };

async function open(page, doc = base, supportStatus = 200) {
  const writes = [];
  await page.addInitScript(() => sessionStorage.setItem("yehry3:admin", "test-session"));
  await page.route("**/yehry3/**", route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET" && !pathname.endsWith("/listeners")) writes.push(request.url());
    if (pathname.endsWith(`/admin/prompts/${id}`)) return route.fulfill({json: {
      prompt: doc, transitions: {failed: ["queued", "canceled"]}, workers: [] }});
    if (pathname.endsWith("/support")) return route.fulfill({status: supportStatus, json:
      supportStatus === 200 ? {text: "Saved diagnostic report <private example>"} : {error: "Diagnostics unavailable"}});
    if (pathname.endsWith("/logs")) return route.fulfill({json: {entries: []}});
    return route.fulfill({json: {songs: [], voiceModels: [], collections: []}});
  });
  await page.goto(`/admin/${id}`);
  await expect(page.getByRole("heading", {name: "Clippy", exact: true})).toBeVisible();
  return writes;
}

test("Clippy prepares a specific repair request without retrying or generating", async ({page}) => {
  const writes = await open(page);
  const clippy = page.getByRole("region", {name: "Clippy remediation suggestions"});
  await expect(clippy.locator("li")).toHaveCount(3);
  await expect(clippy.getByRole("heading", {name: "Try the same lyrics with Local ACE"})).toBeVisible();
  await clippy.getByRole("button", {name: "Prepare this fix"}).first().click();
  await expect(page.getByLabel("Diagnostic report")).toHaveValue(/Clippy: Try the same lyrics with Local ACE[\s\S]*NEW Local ACE[\s\S]*Saved diagnostic report <private example>/);
  await expect(page.locator(".support-report script")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Contact Support"})).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-clippy="archive"]').click();
  await expect(page.getByLabel("Diagnostic report")).toHaveValue(/Clippy: Archive and you try again[\s\S]*Then you try again/);
  expect(writes).toEqual([]);
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: "artifacts/clippy-mobile.png", fullPage: true});
});

test("failed support fetch shows an actionable error; a second attempt works", async ({page}) => {
  await open(page, base, 503);
  await page.locator('[data-clippy="paid-plan"]').click();
  await expect(page.locator(".support-report")).toContainText("Diagnostics unavailable");
  await page.route("**/yehry3/admin/prompts/*/support", route => route.fulfill({json: {text: "Recovered diagnostics"}}));
  await page.locator('[data-clippy="inspect"]').click();
  await expect(page.getByLabel("Diagnostic report")).toHaveValue(/Recovered diagnostics/);
});

test("flagged published songs get honest vocal and ending advice plus replacement guidance", async ({page}) => {
  await open(page, {...base, status: "published", workerError: null, reviewState: "needs_review",
    result: {validationFailures: ["vocal_dropout", "unfinished_ending"]}});
  await expect(page.locator(".clippy li")).toHaveCount(4);
  await expect(page.locator(".clippy")).toContainText("remained unfinished");
  await expect(page.locator(".clippy")).toContainText("Use Regenerate above");
  await expect(page.getByRole("button", {name: "Regenerate", exact: true})).toBeVisible();
  await page.screenshot({path: "artifacts/clippy-desktop.png", fullPage: true});
});
