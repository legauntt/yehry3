import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  let draft, created = 0;
  await page.route('**/yehry3/**', route => {
    const request = route.request(), method = request.method();
    const path = new URL(request.url()).pathname.replace('/yehry3', '');
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    let json = {};
    if (path === '/session') json = { token: 'fixture-submitter-token' };
    else if (path === '/voice-models') json = { models: [{ id: 'v6', label: 'Tony V6' }] };
    else if (path === '/generation') json = { version: 1, enabled: false };
    else if (path === '/request-materials') json = { version: 1 };
    else if (path === '/music-backends') json = { enabled: false };
    else if (path === '/prompts' && method === 'POST') {
      const body = request.postDataJSON();
      draft = { id: 'steps-' + ++created, prompt: body.prompt, authoredBy: body.authoredBy, status: 'draft', version: 1, details: {} };
      json = { prompt: draft };
    } else if (path.startsWith('/prompts/')) {
      if (method === 'PATCH') {
        const { version, ...details } = request.postDataJSON();
        draft = { ...draft, details, status: 'review', version: version + 1 };
      }
      json = { prompt: draft };
    }
    return route.fulfill({ json });
  });
  await page.goto('/distonyc/');
  await page.getByLabel('Password', { exact: true }).fill('wishbone');
  await page.getByRole('button', { name: 'Let’s make something' }).click();
});

const step = (page, stage) => page.locator(`[data-request-stage="${stage}"]`);

for (const width of [1440, 390]) test(`top steps save refinements and allow backward and direct review navigation at ${width}px`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 844 });
  await expect(step(page, 'review')).toBeDisabled();
  await page.getByLabel('Your prompt').fill('A warm railway song about the last train home.');
  await step(page, 'details').click();
  await page.getByLabel('What matters most?').fill('Keep the big chorus');
  await step(page, 'idea').click();
  await expect(page.getByLabel('Your prompt')).toHaveValue('A warm railway song about the last train home.');
  await step(page, 'details').click();
  await expect(page.getByLabel('What matters most?')).toHaveValue('Keep the big chorus');
  await step(page, 'idea').click();
  await step(page, 'review').click();
  await expect(page.getByRole('heading', { name: 'Does this sound right?' })).toBeVisible();
  await expect(page.locator('.request-form')).toContainText('Keep the big chorus');
  await step(page, 'details').click();
  await page.getByLabel('What matters most?').fill('An even bigger chorus');
  await step(page, 'review').click();
  await expect(page.locator('.request-form')).toContainText('An even bigger chorus');
  await step(page, 'idea').click();
  await step(page, 'review').click();
  await expect(page.locator('.request-form')).toContainText('An even bigger chorus');
  await step(page, 'idea').click();
  await page.getByLabel('Your prompt').fill('A new railway song with a lantern in the window.');
  await step(page, 'review').click();
  await expect(page.locator('.request-form')).toContainText('A new railway song with a lantern in the window.');
  await expect(page.locator('.request-form')).toContainText('An even bigger chorus');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/request-steps-${width}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('a ready new idea can go straight to review without confirming a request', async ({ page }) => {
  const confirmations = []; page.on('request', request => { if (request.url().endsWith('/confirm')) confirmations.push(request.url()); });
  await page.getByLabel('Your prompt').fill('A song about taking the midnight train.');
  await step(page, 'review').click();
  await expect(page.getByRole('button', { name: 'Send to the queue' })).toBeVisible();
  expect(confirmations).toEqual([]);
});
