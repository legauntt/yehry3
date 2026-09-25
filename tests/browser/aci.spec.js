import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const hosting = JSON.parse(await readFile(new URL('../../staticwebapp.config.json', import.meta.url), 'utf8'));
const storageKey = 'yehry3:aci-preview:v1';

test.beforeEach(async ({ page }) => {
  await page.route('**/aci/', async route => {
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': hosting.globalHeaders['Content-Security-Policy'] } });
  });
});

test('page, dialogs, filters, mobile and dark layouts work without production requests', async ({ page }) => {
  const errors = [], forbidden = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/chairlift|\/catalog|\/yehry3\/|\/assets\/(?:listeners|player|api|shell)\.js/.test(request.url()) || request.method() !== 'GET') forbidden.push(request.url());
  });
  await page.goto('/aci');
  await expect(page).toHaveURL(/\/aci\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The understudies');
  await expect(page.locator('.agent-card')).toHaveCount(2);
  await expect(page.locator('.record')).toHaveCount(3);
  await page.getByRole('button', { name: 'Inside the profile' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('not a trained model');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Inside the profile' }).first()).toBeFocused();
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('scythe');
  await expect(page.locator('.record')).toHaveCount(1);
  await page.getByRole('button', { name: 'Read the prompt' }).click();
  await expect(page.getByRole('dialog')).toContainText('No recording yet');
  await page.keyboard.press('Escape');
  await page.locator('#record-filter').selectOption('all');
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: 'artifacts/aci/desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Studio limits' }).click();
    const bounds = await page.locator('#limits-dialog').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    if (width === 390) await page.screenshot({ path: 'artifacts/aci/mobile.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'artifacts/aci/dark.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(forbidden).toEqual([]);
});

test('limits, schedule switches, reset, and zero budget stay local and survive reload', async ({ page }) => {
  await page.goto('/aci/');
  await page.evaluate(() => localStorage.setItem('yehry3:authored-by', 'Keep this name'));
  const schedule = page.getByRole('switch', { name: 'Automatic schedule for Pancakeo spoof' });
  await schedule.click();
  await expect(schedule).toHaveAttribute('aria-checked', 'false');
  await expect(schedule).toBeFocused();
  await page.getByRole('button', { name: 'Studio limits' }).click();
  await page.getByLabel('Songs per agent per day').fill('2');
  await page.getByLabel('Total daily spending ceiling').fill('0');
  await page.getByLabel('Preferred daily start').fill('17:30');
  await page.getByRole('button', { name: 'Save preview settings' }).click();
  await expect(page.getByRole('button', { name: 'Run demo for Pancakeo spoof' })).toBeDisabled();
  await page.reload();
  await expect(schedule).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#allowance')).toHaveText('0 / 4');
  await expect(page.locator('.agent-schedule').first()).toContainText('17:30 Pacific');
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click();
  await page.getByRole('button', { name: 'Reset preview data' }).click();
  await expect(schedule).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#allowance')).toHaveText('0 / 2');
  expect(await page.evaluate(() => localStorage.getItem('yehry3:authored-by'))).toBe('Keep this name');
});

test('full demo pauses, releases to the separate shelf, enforces allowance, and can be canceled', async ({ page }) => {
  await page.clock.install();
  await page.goto('/aci/');
  await page.getByRole('button', { name: 'Run demo for Pancakeo spoof' }).click();
  await page.getByRole('button', { name: 'Run demo for Scythe spoof' }).click();
  await expect(page.locator('.queue-job')).toHaveCount(2);
  await page.getByRole('button', { name: 'Pause studio' }).click();
  await page.clock.runFor(12000);
  await expect(page.locator('.queue-job')).toHaveCount(2);
  await expect(page.locator('.record')).toHaveCount(3);
  await page.getByRole('button', { name: 'Resume studio' }).click();
  await page.clock.runFor(9100);
  await expect(page.locator('.queue-job')).toHaveCount(1);
  await expect(page.locator('.record')).toHaveCount(4);
  await expect(page.locator('.record').first()).toContainText('SIMULATED RELEASE');
  await expect(page.locator('.record').first()).toContainText('Audio not generated');
  await expect(page.getByRole('button', { name: 'Run demo for Pancakeo spoof' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel demo for Scythe spoof' }).click();
  await expect(page.locator('.queue-job')).toHaveCount(0);
  await expect(page.locator('#allowance')).toHaveText('2 / 2');
  await page.reload();
  await expect(page.locator('.record')).toHaveCount(4);
  await expect(page.locator('.queue-job')).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records.length, storageKey)).toBe(1);
});

test('blocked or corrupt storage still permits a usable preview', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.goto('/aci/');
  await page.getByRole('switch', { name: 'Automatic schedule for Scythe spoof' }).click();
  await expect(page.getByRole('switch', { name: 'Automatic schedule for Scythe spoof' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#toast')).toContainText('storage is unavailable');
  await expect(page.locator('.record')).toHaveCount(3);
});
