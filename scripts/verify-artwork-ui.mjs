// Read-only browser verification; no votes, pins, listens or generation calls.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import artwork from "../assets/artwork-catalog.js";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const output = path.resolve(process.env.ARTWORK_QA_DIR || "artifacts/artwork-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(site, { waitUntil: "domcontentloaded" });
  const cover = page.locator('[data-id="distonyc-06d2b8c3c8dffed19df347bb"]');
  await cover.waitFor({ timeout: 45000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-id="distonyc-06d2b8c3c8dffed19df347bb"] img.track-art');
    return img?.complete && img.naturalWidth > 0;
  });
  assert.equal(await cover.locator("img.track-art").getAttribute("src"), artwork["distonyc-06d2b8c3c8dffed19df347bb"].src);
  assert.equal(await page.locator('[data-art], #tracks img[src^="data:image/svg"]').count(), 0);
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#search").fill("It Was Simple, Not Easy");
  await cover.locator(".song-more").click();
  await cover.locator("[data-pin]").waitFor({ state: "visible" });
  assert.equal(await page.getByRole("button", { name: /redraw/i }).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: false });
  assert.deepEqual(errors, []);
  console.log(`Verified live saved cover, no Dashboard clip art/Redraw, pin menu, and phone layout. Screenshots: ${output}`);
} finally { await browser.close(); }
