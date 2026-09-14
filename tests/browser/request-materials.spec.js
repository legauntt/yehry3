import { test, expect } from "@playwright/test";
const sheet = "[Verse 1]\nThe lantern catches all our names\nAnd brings the sleeping railway home\nWe keep the light until the morning comes";
async function start(page) {
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page.getByLabel("Your prompt").fill("A warm railway song with a lantern in the window");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await page.locator(".request-materials > summary").click();
}
test("an older API keeps ordinary requests usable without silently accepting attachments", async ({ page }) => {
  await page.route("**/yehry3/request-materials", route => route.fulfill({ status: 404, json: { error: "Endpoint not found." } }));
  await page.goto("/distonyc/");
  await page.getByLabel("Password", { exact: true }).fill("wishbone");
  await page.getByRole("button", { name: "Let’s make something" }).click();
  await page.getByLabel("Your prompt").fill("An ordinary song during the coordinated rollout");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.getByText("Lyrics and reference links are temporarily unavailable.")).toBeVisible();
  await expect(page.getByLabel("Lyric sheet", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeEnabled();
});
test("lyrics persist through reload, review and editing, with default preservation and public boundaries", async ({ page }) => {
  await start(page);
  await expect(page.getByLabel("How should we use these lyrics?")).toHaveValue("preserve");
  await page.getByLabel("Lyric sheet", { exact: true }).fill(sheet);
  await page.reload();
  await expect(page.getByLabel("Lyric sheet", { exact: true })).toHaveValue(sheet);
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.locator(".materials-review")).toContainText("Keep my wording");
  await page.getByText("Read the submitted lyric sheet").click();
  await expect(page.locator(".material-text")).toHaveText(sheet);
  await page.reload();
  await expect(page.locator(".materials-review")).toContainText("Keep my wording");
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByLabel("How should we use these lyrics?").selectOption("adapt");
  await page.reload();
  await expect(page.getByLabel("How should we use these lyrics?")).toHaveValue("adapt");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.locator(".materials-review")).toContainText("Adapt these lyrics");
  await expect(page.locator(".materials-review")).toContainText("attachments stay private");
});
test("oversized sheets remain intact and long preserve requests offer adaptation before queueing", async ({ page }) => {
  await start(page);
  const field = page.getByLabel("Lyric sheet", { exact: true });
  const oversized = "word ".repeat(3001);
  await field.fill(oversized);
  await expect(page.locator("#lyric-count")).toContainText("3,001 / 3,000");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(field).toHaveValue(oversized);
  await field.fill("word ".repeat(600));
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeDisabled();
  await expect(page.locator("#confirm-form .field-error")).toContainText("5-minute");
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await page.getByLabel("How should we use these lyrics?").selectOption("adapt");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeEnabled();
});
test("each link has its own purpose and imported lyrics require an explicit replacement", async ({ page }) => {
  await start(page);
  await page.getByLabel("Lyric sheet", { exact: true }).fill(sheet);
  await page.route("**/yehry3/references/resolve", async route => {
    if (route.request().method() === "OPTIONS") return route.continue();
    const { url, purpose } = route.request().postDataJSON();
    await route.fulfill({ json: { reference: { url, purpose, snapshotId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", snapshot: {
      title: "<img src=x onerror=alert(1)>", status: "ready", kind: "text", text: sheet + "\nA different final line", message: "Lyrics retrieved. Check before using.",
    } } } });
  });
  await page.getByRole("button", { name: "Add a reference link" }).click();
  await page.getByLabel("Reference URL 1", { exact: true }).fill("https://example.org/lyrics.txt");
  await page.getByLabel("Use link 1 for").selectOption("lyrics");
  await page.getByRole("button", { name: "Preview link" }).click();
  await expect(page.getByLabel("Review imported lyrics 1")).toHaveValue(sheet + "\nA different final line");
  await expect(page.getByLabel("Lyric sheet", { exact: true })).toHaveValue(sheet);
  await page.getByLabel("Review imported lyrics 1").fill(sheet + "\nMy edited final line");
  await page.getByRole("button", { name: "Use these lyrics" }).click();
  await expect(page.getByLabel("Lyric sheet", { exact: true })).toHaveValue(sheet + "\nMy edited final line");
  await expect(page.locator(".reference-preview img")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a reference link" }).click();
  await expect(page.getByLabel("Use link 2 for")).toHaveValue("creative");
  await page.getByRole("button", { name: "Add a reference link" }).click();
  await expect(page.getByRole("button", { name: "Add a reference link" })).toBeDisabled();
  await page.getByRole("button", { name: "Remove reference 3" }).click();
  await expect(page.getByRole("button", { name: "Add a reference link" })).toBeEnabled();
  await page.getByLabel("Reference URL 1", { exact: true }).fill("https://example.org/changed.txt");
  await expect(page.getByLabel("Review imported lyrics 1")).toHaveCount(0);
});
test("failed imports preserve pasted lyrics and the mobile form stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByLabel("Lyric sheet", { exact: true }).fill(sheet);
  await page.getByRole("button", { name: "Add a reference link" }).click();
  await page.getByLabel("Reference URL 1", { exact: true }).fill("https://youtu.be/abcdefghijk");
  await page.getByLabel("Use link 1 for").selectOption("lyrics");
  await page.getByRole("button", { name: "Preview link" }).click();
  await expect(page.locator(".reference-preview")).toContainText("Paste the lyric sheet");
  await expect(page.getByLabel("Lyric sheet", { exact: true })).toHaveValue(sheet);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/request-materials-mobile.png", fullPage: true });
});
