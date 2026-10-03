// Read-only browser check of a recovered cover at desktop and phone sizes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import artwork from '../assets/artwork-catalog.js';
const id = process.argv[2];
if (!id || !artwork[id]) throw new Error('Pass a song ID with a saved cover');
const output = path.resolve(process.env.ARTWORK_QA_DIR || 'artifacts/artwork-recovery');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${process.env.YEHRY3_SITE_URL || 'https://yehry3.app'}/#${id}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`[data-id="${id}"]`);
    await row.waitFor({ timeout: 45000 });
    await row.scrollIntoViewIfNeeded();
    await page.waitForFunction(id => {
      const img = document.querySelector(`[data-id="${id}"] img.track-art`);
      return img?.complete && img.naturalWidth > 0;
    }, id, { timeout: 30000 });
    assert.equal(await row.locator('img.track-art').getAttribute('src'), artwork[id].src);
    assert.equal(await row.locator('.track-art-pending').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, name + '.png') });
  }
  assert.deepEqual(errors, []);
  console.log(`Verified recovered cover ${id} on desktop and phone. Screenshots: ${output}`);
} finally { await browser.close(); }
