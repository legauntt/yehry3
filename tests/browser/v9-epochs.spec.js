import { test, expect } from '@playwright/test';

test('V9 epoch is defaulted, retained, scoped to V9 and confirmed publicly', async ({ page }) => {
  if (process.env.API_PORT) await page.route('**/assets/config.js', route => route.fulfill({
    contentType: 'text/javascript', body: `export const API_BASE = 'http://127.0.0.1:${Number(process.env.API_PORT)}/yehry3';`,
  }));
  await page.goto('/distonyc/');
  await page.getByLabel('Password', { exact: true }).fill('wishbone');
  await page.getByRole('button', { name: 'Let’s make something' }).click();
  await page.getByLabel('Your prompt').fill('A warm railway song about a lantern in the window');
  await page.getByRole('button', { name: 'Find the direction' }).click();
  const voice = page.getByLabel('Tony voice model', { exact: true });
  await voice.selectOption('v9');
  const epoch = page.getByLabel('V9 training epoch');
  await expect(epoch).toHaveValue('300');
  await expect(epoch.locator('option')).toHaveCount(30);
  await epoch.selectOption('100');
  await page.reload();
  await expect(voice).toHaveValue('v9');
  await expect(epoch).toHaveValue('100');
  await voice.selectOption('v7');
  await expect(epoch).toBeHidden();
  await expect(epoch).toBeDisabled();
  await voice.selectOption('v9');
  await expect(epoch).toHaveValue('100');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(epoch).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Review the request' }).click();
  await expect(page.locator('main')).toContainText('epoch 100');
  await page.reload();
  await expect(page.locator('main')).toContainText('epoch 100');
  await page.getByRole('button', { name: 'Fine-tune it' }).click();
  await expect(epoch).toHaveValue('100');
  await page.getByRole('button', { name: 'Review the request' }).click();
  await page.getByRole('button', { name: 'Send to the queue' }).click();
  await expect(page.getByText('Your idea is on the list.')).toBeVisible();
  await page.goto('/queue/');
  await expect(page.locator('main')).toContainText('epoch 100');
});
