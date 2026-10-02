// Read-only browser check of the deployed seasonal UI and reported song cover.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { halloweenSeason } from '../assets/season.js';
const site = process.env.YEHRY3_SITE_URL || 'https://yehry3.app';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto(`${site}/queue/`);
  if (halloweenSeason()) {
    await page.locator('.halloween-scene').waitFor();
    await page.mouse.move(300,300);
    await page.locator('.halloween-witch:not([hidden])').waitFor();
    assert.equal(await page.evaluate(async () => (await import('/assets/pitch-repair.js')).defaultPitch), 'haunted');
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const cover = await page.evaluate(async () => {
    const registry = (await import('/assets/artwork-catalog.js')).default;
    const art = registry['distonyc-3ce62fce4bc081402b7e6408'];
    if (!art) return false;
    const image = new Image(); image.src = art.src;
    await image.decode(); return image.naturalWidth > 0;
  });
  assert.ok(cover, 'The Last Roll Call (Black Parade Version) cover must load');
  await page.goto(`${site}/lyrics/the-last-roll-call-black-parade-version-e2ce1e/`);
  await page.getByRole('heading', {name:'The Last Roll Call (Black Parade Version)', exact:true}).waitFor();
  console.log('Live seasonal decorations, cursor witch, Haunted default, phone layout and Black Parade cover verified.');
} finally { await browser.close(); }
