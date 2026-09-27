import { test, expect } from '@playwright/test';
import path from 'node:path';

test.beforeEach(async ({ page }) => {
  if (process.env.EP_REAL_MEDIA !== '1') {
    // Install before navigation so native metadata requests also use the retained fixture.
    await page.route('https://github.com/**', route => route.fulfill({ contentType: 'audio/mpeg', path: path.resolve('sausage/audio/ace-final.mp3') }));
  }
});

test('EP plays complete recordings and keeps a single audio source active', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/saxophone/');
  await expect(page.locator('.record')).toHaveCount(3);
  await page.getByRole('button', { name: 'Play the EP' }).click();
  await expect.poll(() => page.locator('audio').nth(0).evaluate(a => a.currentTime)).toBeGreaterThan(0);
  await page.locator('audio').nth(1).evaluate(a => a.play());
  await expect.poll(() => page.locator('audio').evaluateAll(as => as.filter(a => !a.paused).length)).toBe(1);
  await expect(page.locator('.record.playing h2')).toHaveText('Sideways Staircase');
  await page.locator('audio').nth(1).evaluate(a => { a.currentTime = a.duration - .1; });
  await expect.poll(() => page.locator('audio').nth(2).evaluate(a => a.currentTime)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('reduced motion keeps artwork still until explicitly animated, including mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  let videosRequested = 0;
  page.on('request', request => { if (request.url().endsWith('.mp4')) videosRequested++; });
  await page.goto('/saxophone/');
  await expect(page.locator('.record')).toHaveCount(3);
  await page.locator('video').first().scrollIntoViewIfNeeded();
  expect(await page.locator('video').evaluateAll(vs => vs.every(v => v.paused && !v.getAttribute('src')))).toBe(true);
  expect(videosRequested).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Animate artwork' }).click();
  await page.locator('video').first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('video').first().evaluate(v => v.currentTime)).toBeGreaterThan(0);
  await page.locator('video').first().evaluate(v => { v.currentTime = v.duration - .1; });
  await expect.poll(() => page.locator('video').first().evaluate(v => v.currentTime)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Pause artwork' }).click();
  expect(await page.locator('video').evaluateAll(vs => vs.every(v => v.paused))).toBe(true);
});

test('existing review-note visibility preference carries across tabs', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/saxophone/');
  await expect(page.locator('.quality-notice').first()).toBeVisible();
  const second = await context.newPage();
  await second.goto('/saxophone/');
  await second.evaluate(() => localStorage.setItem('yehry3:show-quality-issues', 'false'));
  await expect(page.locator('.quality-notice').first()).toBeHidden();
  await page.reload();
  await expect(page.locator('.quality-notice').first()).toBeHidden();
  await second.close();
});

test('all real recordings, posters and artwork decode and seek', async ({ page }, testInfo) => {
  test.skip(process.env.EP_REAL_MEDIA !== '1', 'Explicit real media verification');
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.site-footer').getByRole('link', { name: 'Tony C is a saxophone' }).click();
  await expect(page).toHaveURL(/\/saxophone\/$/);
  await expect(page.locator('.record')).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    expect(await page.locator('video').nth(index).evaluate(async video => {
      const poster = new Image(); poster.src = video.poster; await poster.decode();
      return poster.naturalWidth;
    })).toBe(832);
  }
  for (let index = 0; index < 3; index++) {
    const player = page.locator('audio').nth(index);
    await player.evaluate(a => a.play());
    await expect.poll(() => player.evaluate(a => a.currentTime), { timeout: 30000 }).toBeGreaterThan(.1);
    expect(await player.evaluate(a => a.duration)).toBeGreaterThanOrEqual(180);
    await player.evaluate(a => { a.currentTime = 100; });
    await expect.poll(() => player.evaluate(a => a.currentTime)).toBeGreaterThan(100);
    await player.evaluate(a => a.pause());
  }
  await page.getByRole('button', { name: 'Animate artwork' }).click();
  for (let index = 0; index < 3; index++) {
    const video = page.locator('video').nth(index);
    await video.scrollIntoViewIfNeeded();
    await expect.poll(() => video.evaluate(v => v.currentTime), { timeout: 30000 }).toBeGreaterThan(.1);
    expect(await video.evaluate(v => v.videoWidth)).toBe(832);
    await video.evaluate(v => { v.currentTime = v.duration - .1; });
    await expect.poll(() => video.evaluate(v => v.currentTime)).toBeLessThan(1);
  }
  await page.getByRole('button', { name: 'Pause artwork' }).click();
  await page.screenshot({ path: testInfo.outputPath('ep-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ep-mobile.png'), fullPage: true });
});
