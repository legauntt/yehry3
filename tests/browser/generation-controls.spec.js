import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('/distonyc/');
  await page.getByLabel('Password', { exact: true }).fill('wishbone');
  await page.getByRole('button', { name: 'Let’s make something' }).click();
  await page.getByLabel('Your prompt').fill('A warm song about catching the last train home.');
  await page.getByRole('button', { name: 'Find the direction' }).click();
}

test('V8 defaults, dropdown and custom choices, and edited sections survive review and reload', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await expect(page.locator('#voice-model')).toHaveValue('v8');
  await expect(page.locator('#voice-model option[value="v7"]')).toHaveText('Tony V7 · fresh catalog');
  await expect(page.locator('#voice-model option[value="v8"]')).toHaveText('Tony V8 · expanded recordings');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('.generation-group').filter({ hasText: 'Style & instruments' }).locator('summary').click();
  await page.getByLabel('Style or genre', { exact: true }).selectOption('Jazz');
  await page.getByLabel('Style or genre', { exact: true }).selectOption('custom');
  await page.getByLabel('Your style or genre', { exact: true }).fill('Smoky jazz waltz');
  await page.getByLabel('Featured instruments', { exact: true }).selectOption('Piano');
  await page.getByLabel('Featured instruments', { exact: true }).selectOption('Cello');
  await page.getByRole('button', { name: 'Remove Cello from featured instruments', exact: true }).click();
  await page.getByLabel('Featured instruments', { exact: true }).selectOption('custom');
  await page.getByLabel('Custom featured instrument', { exact: true }).fill('Glass harmonica');
  await page.getByLabel('Custom featured instrument', { exact: true }).press('Enter');
  await page.getByLabel('Leave out these instruments', { exact: true }).selectOption('Drum machine');
  await page.getByLabel('Section order', { exact: true }).selectOption('verse-chorus');
  await page.getByRole('button', { name: 'Move section 3 earlier', exact: true }).click();
  await expect(page.getByLabel('Section 2', { exact: true })).toHaveValue('Chorus');
  await page.getByRole('button', { name: 'Remove section 1', exact: true }).click();
  await page.getByLabel('Section 1', { exact: true }).fill('Opening chorus');
  await page.getByLabel('Add a section', { exact: true }).selectOption('custom');
  await page.getByLabel('Section 8', { exact: true }).fill('Quiet final refrain');
  const expectedOrder = 'Opening chorus, Verse, Verse, Chorus, Bridge, Final chorus, Outro, Quiet final refrain';
  await expect(page.locator('[data-generation="structure"]')).toHaveValue(expectedOrder);
  await page.locator('#generation-remember').click();
  await page.reload();
  await page.locator('.generation-group').filter({ hasText: 'Style & instruments' }).locator('summary').click();
  await expect(page.getByLabel('Your style or genre', { exact: true })).toHaveValue('Smoky jazz waltz');
  await expect(page.getByRole('list', { name: 'Featured instruments selected', exact: true })).toContainText('Glass harmonica');
  await expect(page.getByLabel('Section 8', { exact: true })).toHaveValue('Quiet final refrain');
  await expect(page.getByRole('button', { name: 'Move section 1 earlier', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'artifacts/generation-controls-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/generation-controls-mobile.png', fullPage: true });
  const patch = page.waitForRequest(request => request.method() === 'PATCH' && request.url().includes('/prompts/'));
  await page.getByRole('button', { name: 'Review the request' }).click();
  const saved = (await patch).postDataJSON();
  expect(saved.voiceModel).toBe('v8');
  expect(saved.generation).toMatchObject({ genre: 'Smoky jazz waltz', instruments: ['Piano', 'Glass harmonica'], avoidInstruments: ['Drum machine'], structure: expectedOrder });
  await expect(page.locator('.generation-brief')).toContainText(expectedOrder);
  await expect(page.locator('.generation-brief')).not.toContainText('Automatic');
  await expect(page.locator('.generation-brief dt')).toHaveText(['Style or genre', 'Featured instruments', 'Leave out these instruments', 'Section order', 'Tony’s pitch']);
  await page.getByRole('button', { name: 'Fine-tune it' }).click();
  await expect(page.locator('[data-generation="structure"]')).toHaveValue(expectedOrder);
  expect(errors).toEqual([]);
});

for (const unavailable of ['voice', 'generation']) test(`new requests fall back to V7 when V8 ${unavailable} is unavailable and preserve a saved V6 choice`, async ({ page }) => {
  if (unavailable === 'voice') await page.route('**/yehry3/voice-models', route => route.fulfill({ json: { models: [{ id: 'v6', label: 'Tony V6', note: 'Established' }, { id: 'v7', label: 'Tony V7', note: 'Fresh catalog', experimental: true }] } }));
  else await page.route('**/yehry3/generation', route => route.fulfill({ json: { version: 1, enabled: false } }));
  await start(page);
  await expect(page.locator('#voice-model')).toHaveValue('v7');
  await page.locator('#voice-model').selectOption('v6');
  await page.reload(); await expect(page.locator('#voice-model')).toHaveValue('v6');
});
