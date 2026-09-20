import { test, expect } from "@playwright/test";

const show = (page, text, error = false) =>
  page.evaluate(([t, e]) => import("/assets/message.js").then((m) => m.showMessage(t, e)), [text, error]);

test("status banner can be dismissed with the ×", async ({ page }) => {
  await page.goto("/");
  await show(page, "Clip art redrawn for everyone.");
  const banner = page.locator("#message");
  await expect(banner).toHaveText("Clip art redrawn for everyone.");
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(banner).toBeHidden();
  await expect(banner).toBeEmpty();
});

test("status banner clears itself, later and for errors, and waits while hovered", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const banner = page.locator("#message");
  await show(page, "Clip art redrawn for everyone.");
  await page.clock.runFor(5000);
  await expect(banner).toBeVisible();
  await page.clock.runFor(1500);
  await expect(banner).toBeHidden();

  await show(page, "Something went sideways.", true);
  await expect(banner).toHaveClass(/error/);
  await page.clock.runFor(8000);
  await expect(banner).toBeVisible();
  await page.clock.runFor(5000);
  await expect(banner).toBeHidden();
  await expect(banner).not.toHaveClass(/error/);

  await show(page, "Hold this one.");
  await banner.hover();
  await page.clock.runFor(30000);
  await expect(banner).toBeVisible();
  await page.mouse.move(0, 500);
  await page.clock.runFor(6500);
  await expect(banner).toBeHidden();
});

test("a newer message replaces the older one and restarts the clock", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const banner = page.locator("#message");
  await show(page, "First.");
  await page.clock.runFor(4000);
  await show(page, "Second.");
  await page.clock.runFor(4000);
  await expect(banner).toHaveText("Second.");
  await page.clock.runFor(2500);
  await expect(banner).toBeHidden();
});
