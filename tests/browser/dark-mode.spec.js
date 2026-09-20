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

test("Dark Mode keeps the vote count readable on liked songs", async ({ page, context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const ratio = await page.evaluate(() => {
    const button = document.createElement("button");
    button.className = "vote has-votes";
    button.innerHTML = '<span aria-hidden="true">♥</span> <span>2</span>';
    document.body.append(button);
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = rgb => {
      const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const style = getComputedStyle(button);
    const light = luminance(channels(style.color));
    const dark = luminance(channels(style.backgroundColor));
    button.remove();
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  });
  expect(ratio).toBeGreaterThan(4.5);
});

test("Dark Mode keeps a hovered list row dark and readable", async ({ page, context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => {
    const row = document.createElement("article");
    row.className = "track";
    row.id = "hover-probe";
    row.style.cssText = "position:fixed;top:0;left:0;z-index:9999;width:300px";
    row.textContent = "Hovered song";
    document.body.append(row);
  });
  await page.locator("#hover-probe").hover();
  const ratio = await page.locator("#hover-probe").evaluate(row => {
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = rgb => {
      const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const style = getComputedStyle(row);
    const light = luminance(channels(style.color));
    const dark = luminance(channels(style.backgroundColor));
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  });
  expect(ratio).toBeGreaterThan(4.5);
});

test("Dark Mode keeps the pinned label readable", async ({ page, context }) => {
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(() => localStorage.setItem("yehry3:dark-mode", "true"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const ratio = await page.evaluate(() => {
    const button = document.createElement("button");
    button.className = "song-action";
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Pinned · 2";
    document.body.append(button);
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = rgb => {
      const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const style = getComputedStyle(button);
    const light = luminance(channels(style.color));
    const dark = luminance(channels(style.backgroundColor));
    button.remove();
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  });
  expect(ratio).toBeGreaterThan(4.5);
});
