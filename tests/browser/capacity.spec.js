import { test, expect } from "@playwright/test";

test("a full request queue preserves the review and accepts the same request when a slot opens", async ({ page }) => {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page.getByLabel("Your prompt").fill("An original song about waiting for the last train.");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await page.getByLabel("What should it sound like?").fill("Warm acoustic guitar with a big singalong chorus.");
  await page.getByLabel("What matters most?").fill("Tony vocals and the last train hook.");
  const reviewResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().includes("/yehry3/prompts/"));
  await page.getByRole("button", { name: "Review the request" }).click();
  const reviewed = (await (await reviewResponse).json()).prompt;
  await expect(page.getByText("The queue holds up to 10 unfinished requests", { exact: false })).toBeVisible();
  const attempts = [];
  await page.route("**/yehry3/prompts/*/confirm", async route => {
    if (route.request().method() === "OPTIONS") return route.continue();
    attempts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    const origin = new URL(page.url()).origin;
    // The API's real admission/recovery is covered by its Mongo concurrency tests.
    // Simulate acceptance here so this browser fixture does not enqueue work for other tests.
    if (attempts.length > 1) return route.fulfill({
      headers: { "access-control-allow-origin": origin },
      json: { prompt: { ...reviewed, status: "queued", version: reviewed.version + 1, confirmedAt: new Date().toISOString() } },
    });
    return route.fulfill({
      status: 429,
      headers: { "access-control-allow-origin": origin },
      json: {
        error: "The studio has 10 unfinished requests. Your request is saved; try again when a song is published or a request leaves the queue.",
        code: "queue_full",
        capacity: { limit: 10, active: 10, available: 0, full: true },
      },
    });
  });
  await page.getByRole("button", { name: "Send to the queue" }).click();
  await expect(page.locator("#confirm-form .field-error")).toContainText("Your request is saved; try again");
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeEnabled();
  await page.reload();
  await expect(page.getByText("Does this sound right?")).toBeVisible();
  await expect(page.locator(".brief")).toContainText("last train");
  await page.getByRole("button", { name: "Send to the queue" }).click();
  await expect(page.getByText("Request received", { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].body.confirmed).toBe(true);
  expect(attempts[1]).toEqual(attempts[0]);
});
