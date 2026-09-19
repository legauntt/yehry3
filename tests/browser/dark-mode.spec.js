import { test, expect } from "@playwright/test";

test("Dark Mode persists, syncs tabs, and keeps settings usable on mobile", async ({ page, context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Open display settings" }).click();
  const toggle = page.getByRole("checkbox", { name: "Dark Mode" });
  await toggle.check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 30, 26)");
  await page.getByRole("button", { name: "Close display settings" }).click();
  await page.screenshot({ path: "artifacts/dark-mode-desktop.png", fullPage: false });
  const second = await context.newPage();
  await second.goto("/queue/");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await page.getByRole("button", { name: "Open display settings" }).click();
  await expect(toggle).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole("dialog", { name: "Display settings" });
  await dialog.screenshot({ path: "artifacts/dark-mode-settings-mobile.png" });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await toggle.uncheck();
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  await toggle.check();
  await page.evaluate(() => localStorage.removeItem("yehry3:dark-mode"));
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Dark Mode works when storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open display settings" }).click();
  await page.getByRole("checkbox", { name: "Dark Mode" }).check();
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("checkbox", { name: "Dark Mode" })).toBeChecked();
});
