// Read-only UI verification for supplied saved covers, on desktop and phone.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import artwork from "../assets/artwork-catalog.js";
const ids = process.argv.slice(2);
assert.ok(ids.length && ids.every(id => artwork[id]), "Supply saved artwork song IDs");
const output = path.resolve(process.env.ARTWORK_QA_DIR || "artifacts/song-cover-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/yehry3/listens", route => route.fulfill({ json: {} }));
    await page.goto(process.env.YEHRY3_SITE_URL || "https://yehry3.app", { waitUntil: "domcontentloaded" });
    for (const id of ids) {
      const row = page.locator(`[data-id="${id}"]`);
      await row.waitFor({ timeout: 45000 });
      await row.scrollIntoViewIfNeeded();
      await page.waitForFunction(id => {
        const image = document.querySelector(`[data-id="${id}"] img.track-art`);
        return image?.complete && image.naturalWidth > 0;
      }, id, { timeout: 30000 });
      assert.equal(await row.locator("img.track-art").getAttribute("src"), artwork[id].src);
      assert.equal(await row.locator(".track-art-pending").count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `${id}-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Verified ${ids.length} saved covers on desktop and phone: ${output}`);
} finally { await browser.close(); }
