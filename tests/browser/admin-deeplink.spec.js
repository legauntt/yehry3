import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const id = "0f8b4c1e-6a52-4d7e-9c3a-1b2d3e4f5a6b";
const failed = {
  id,
  status: "failed",
  priority: 0,
  version: 3,
  prompt: "Remix “Blue Screen America”.",
  details: {},
  confirmedAt: "2026-09-20T16:45:00Z",
  workerError: "The render stopped.",
  history: [{ at: "2026-09-20T17:00:00Z", actor: "worker", action: "fail", status: "failed" }],
};
const transitions = { failed: ["queued"], queued: ["canceled"] };

async function login(page, path) {
  await page.goto(path);
  await page.getByLabel("Password", { exact: true }).fill("browser-test-admin");
  await page.getByRole("button", { name: "Open the queue" }).click();
}

test("/admin/<requestId> opens that one request, with its Dehaka thread and working controls", async ({ page }) => {
  const patches = [];
  await page.route(`**/yehry3/admin/prompts/${id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON());
      return route.fulfill({ json: { prompt: { ...failed, adminNote: "kept", version: 4 } } });
    }
    await route.fulfill({ json: { prompt: failed, transitions, workers: [] } });
  });
  await page.route(`**/yehry3/admin/prompts/${id}/dehaka`, (route) => route.fulfill({ json: { entries: [] } }));
  await page.route("**/yehry3/admin/prompts?**", (route) => route.fulfill({ json: { prompts: [failed], total: 1, page: 0, sort: "newest", counts: { failed: 1 }, transitions, workers: [] } }));

  await login(page, `/admin/${id}`);
  await expect(page).toHaveURL(new RegExp(`/admin/${id}$`));
  await expect(page.locator(".queue-card")).toHaveCount(1);
  await expect(page.locator(".queue-card h2")).toHaveText("Remix “Blue Screen America”.");
  await expect(page.locator("[data-dehaka-thread]")).toBeVisible();
  await expect(page.locator(".stats")).toHaveCount(0);
  await expect(page.locator(".queue-card").getByRole("link", { name: "Permalink" })).toHaveCount(0);
  await expect(page).toHaveTitle(/Remix “Blue Screen America”\./);

  // Controls on the deep-linked card go through the same PATCH the list uses.
  await page.locator(".admin-brief summary").click();
  await page.getByLabel("Private admin note").fill("kept");
  await page.locator('form[data-action="note"] button').click();
  await expect(page.locator("#message")).toContainText("Queue updated.");
  expect(patches).toEqual([{ action: "note", version: 3, note: "kept" }]);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/admin-deeplink-mobile.png", fullPage: true });

  // The trailing-slash form and a reload land on the same request.
  await page.goto(`/admin/${id}/`);
  await expect(page.locator(".queue-card h2")).toHaveText("Remix “Blue Screen America”.");
  await page.getByRole("link", { name: "← All requests" }).click();
  await expect(page).toHaveURL(/\/admin\/\?status=all$/);
  await expect(page.locator(".stats")).toBeVisible();
});

test("list cards link to their own /admin/<id> and an unknown id says so", async ({ page }) => {
  await page.route("**/yehry3/admin/prompts?**", (route) => route.fulfill({ json: { prompts: [failed], total: 1, page: 0, sort: "newest", counts: { failed: 1 }, transitions, workers: [] } }));
  await page.route(`**/yehry3/admin/prompts/missing`, (route) => route.fulfill({ status: 404, json: { error: "Request not found." } }));
  await login(page, "/admin/?status=all");
  await expect(page.locator(".queue-card").getByRole("link", { name: "Permalink" })).toHaveAttribute("href", `/admin/${id}`);

  await page.goto("/admin/missing");
  await expect(page.getByRole("heading", { name: "That request isn’t here." })).toBeVisible();
  await expect(page.getByRole("link", { name: "All requests →" })).toHaveAttribute("href", "/admin/?status=all");
});
