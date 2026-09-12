import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
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
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await page.reload();
  await expect(page.locator("[data-vote]").first()).toBeDisabled();
  await expect(page.locator("#vote-note")).toContainText("next vote");
  await mkdir("artifacts", { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/collection-desktop.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
test("password, two turns, queue submission, admin priority, cancel and retry", async ({
  page,
}) => {
  await page.goto("/longtimecomin/");
  await expect(page.getByText("Never tell anyone your password")).toBeVisible();
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
  await page.getByLabel("Which song are we starting with?").fill("Medusa");
  await page
    .getByLabel("What should the new version sound like?")
    .fill("A playful four-part barbershop quartet with no instruments.");
  await page
    .getByLabel("What should we keep?")
    .fill("Preserve the original melody, lyrics and slurred main hook.");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByText("Does this sound right?")).toBeVisible();
  await page.screenshot({ path: "artifacts/request-review-desktop.png" });
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await expect(page.getByLabel("Which song are we starting with?")).toHaveValue(
    "Medusa",
  );
  await page.getByRole("button", { name: "Review the request" }).click();
  await page.getByLabel("Yes, this is the song I want to request.").check();
  await page.getByRole("button", { name: "Send to the queue" }).click();
  await expect(
    page.getByText("Request received", { exact: true }),
  ).toBeVisible();
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
  await page.getByText("Open brief & controls").click();
  await page.getByLabel("Move request to").selectOption("canceled");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.locator(".queue-card")).toHaveCount(0);
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
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/admin-desktop.png" });
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
