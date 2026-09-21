import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('/distonyc/');
  await page.locator('#password').fill('wishbone');
  await page.locator('#login-form button').click();
  await page.locator('#idea').fill('A timing boundary song about the last train home.');
  await page.locator('#idea-form button').click();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Timing & key', { exact: true }).click();
}

for (const seconds of [69, 666]) test(`local ${seconds}-second request persists through review and confirmation`, async ({ page }) => {
  await start(page);
  const input = page.locator('#gen-duration');
  await expect(input).toHaveAttribute('min', '69');
  await expect(input).toHaveAttribute('max', '666');
  await expect(input).toHaveAttribute('step', '1');
  for (const invalid of ['68', '667', '69.5']) {
    await input.fill(invalid);
    expect(await input.evaluate(field => field.checkValidity())).toBe(false);
  }
  await input.fill(String(seconds));
  expect(await input.evaluate(field => field.checkValidity())).toBe(true);
  await page.reload();
  await expect(input).toHaveValue(String(seconds));
  await page.locator('#details-form > .actions .primary').click();
  await expect(page.locator('#confirm-form')).toBeVisible();
  await page.locator('#edit').click();
  await expect(input).toHaveValue(String(seconds));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Timing & key', { exact: true }).click();
  await expect(page.locator('#generation-duration-hint')).toContainText('69–666');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/song-timing/local-${seconds}-mobile.png`, fullPage: true });
  await page.locator('#details-form > .actions .primary').click();
  await page.locator('#confirm-form .primary').click();
  await expect(page.getByRole('heading', { name: 'Your idea is on the list.' })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const { api } = await import('/assets/api.js');
    return (await api('/prompts/' + sessionStorage.getItem('yehry3:draft'), { role: 'submitter' })).prompt;
  });
  expect(saved.details.generation.duration).toBe(seconds);
});

test('provider switching preserves length and paid 69 seconds uses the correct cost', async ({ page }) => {
  await start(page);
  await page.locator('#gen-duration').fill('666');
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await page.locator('#music-backend').selectOption('eleven_music');
  await expect(page.locator('#gen-duration')).toHaveAttribute('max', '600');
  await expect(page.locator('#gen-duration')).toHaveValue('666');
  expect(await page.locator('#gen-duration').evaluate(field => field.validity.rangeOverflow)).toBe(true);
  await page.locator('#music-backend').selectOption('local');
  await expect(page.locator('#gen-duration')).toHaveAttribute('max', '666');
  await expect(page.locator('#gen-duration')).toHaveValue('666');
  await page.locator('#music-backend').selectOption('eleven_music');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect(page.locator('#generation-duration-hint')).toContainText('600-second maximum');
  await page.locator('#gen-duration').fill('69');
  await page.locator('#details-form > .actions .primary').click();
  await expect(page.locator('.paid-music-confirmation')).toContainText('$0.17');
  await expect(page.locator('.paid-music-confirmation')).toContainText('$1.15');
  await page.locator('#confirm-paid').check();
  await page.locator('#confirm-form .primary').click();
  await expect(page.getByRole('heading', { name: 'Your idea is on the list.' })).toBeVisible();
});
