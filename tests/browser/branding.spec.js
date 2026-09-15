import { test, expect } from "@playwright/test";
import { brandLines } from "../../assets/brand-lines.js";

test("headlines vary per visit, stay stable through filtering, and carry through the footer", async ({ page }) => {
  await page.goto("/");
  const headline = page.locator("[data-brand-headline]");
  const text = await headline.innerText();
  expect(brandLines).toContain(text);
  await expect(page.locator("[data-brand-footer]")).toHaveText(`YEHRY3 · ${text.replace("\n", " ")}`);
  await page.locator("#search").fill("a");
  await expect(headline).toHaveText(text.replace("\n", ""));
  await page.reload();
  expect(await headline.innerText()).not.toBe(text);
  for (const route of ["/queue/", "/mixtapes/", "/admin/", "/distonyc/"]) {
    await page.goto(route);
    const footer = await page.locator("[data-brand-footer]").innerText();
    expect(brandLines.map(line => `YEHRY3 · ${line.replace("\n", " ")}`)).toContain(footer);
  }
});

test("branding works without storage and long lines fit a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Unavailable"); } });
    Math.random = () => .99999;
  });
  await page.goto("/");
  await expect(page.locator("[data-brand-headline]")).toHaveText(brandLines.at(-1).replace("\n", ""));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/branding-mobile.png", fullPage: true });
});
