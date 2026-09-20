import { test, expect } from '@playwright/test';

const password = 'browser-test-paid-music';
const key = 'yehry3:paid-music-password';

async function fixture(context) {
  const state = { prompts: new Map(), confirmations: [], failure: null };
  await context.route('**/yehry3/**', async route => {
    const request = route.request(), method = request.method();
    const path = new URL(request.url()).pathname.replace('/yehry3', '');
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    let json = {};
    if (path === '/session') json = { token: 'fixture-submitter-token' };
    else if (path === '/voice-models') json = { models: [{ id: 'v8', label: 'Tony V8', experimental: true }] };
    else if (path === '/generation') json = { version: 1, enabled: true };
    else if (path === '/request-materials') json = { version: 1 };
    else if (path === '/music-backends') json = { enabled: true, remainingCents: 19100, ...(state.provider ? { provider: state.provider } : {}) };
    else if (path === '/capacity') json = { limit: 10, active: 0, available: 10, full: false };
    else if (path === '/queue') json = { inStudio: [], needsAttention: [], queued: [], recent: [] };
    else if (path === '/prompts' && method === 'POST') {
      const body = request.postDataJSON();
      const prompt = { id: 'fixture-' + (state.prompts.size + 1), prompt: body.prompt, status: 'draft', version: 1, details: { voiceModel: 'v8', basisSongIds: [] } };
      state.prompts.set(prompt.id, prompt);
      json = { prompt };
    } else if (path.startsWith('/prompts/')) {
      const prompt = state.prompts.get(path.split('/')[2]);
      if (path.endsWith('/confirm')) {
        const body = request.postDataJSON();
        state.confirmations.push(body);
        if (state.failure) return route.fulfill({ status: state.failure, json: { error: 'Temporary confirmation failure.' } });
        if (body.paidPassword !== password) return route.fulfill({ status: 403, json: { error: 'That paid confirmation password did not work. Try again.' } });
        Object.assign(prompt, { status: 'queued', confirmedAt: new Date().toISOString(), version: prompt.version + 1 });
      } else if (method === 'PATCH') {
        const body = request.postDataJSON();
        Object.assign(prompt, { details: body, status: 'review', version: prompt.version + 1 });
      }
      json = { prompt };
    }
    return route.fulfill({ json });
  });
  return state;
}

async function review(page, { login = false, controls = true, initialBackend = 'local' } = {}) {
  await page.goto('/distonyc/');
  if (login) {
    await page.locator('#password').fill('wishbone');
    await page.locator('#login-form button').click();
  }
  await expect(page.locator('#idea, #another')).toBeVisible();
  if (await page.locator('#another').count()) await page.locator('#another').click();
  await page.locator('#idea').fill('A soul song about the last bus home.');
  await page.locator('#idea-form button').click();
  await expect(page.locator('#music-backend option[value="eleven_music"]')).toBeEnabled();
  await expect(page.locator('#music-backend')).toHaveValue(initialBackend);
  if (initialBackend !== 'eleven_music') await page.locator('#music-backend').selectOption('eleven_music');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Timing & key', { exact: true }).click();
  await page.locator('#gen-duration').fill('250');
  await page.locator('#details-form > .actions .primary').click();
  if (controls) await expect(page.locator('#paid-password')).toBeVisible();
}

test('successful paid authorization hides repeat agreement and password controls across requests, reloads and reopening', async ({ page, context, browser, baseURL }) => {
  const state = await fixture(context);
  await review(page, { login: true });
  await page.locator('#paid-password').fill(password);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.locator('#confirm-paid').check();
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#another')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(password);
  await review(page, { controls: false, initialBackend: 'eleven_music' });
  await expect(page.locator('#paid-password')).toHaveCount(0);
  await expect(page.locator('#confirm-paid')).toHaveCount(0);
  await expect(page.locator('.paid-authorization-saved')).toBeVisible();
  await page.reload();
  await expect(page.locator('#paid-password')).toHaveCount(0);
  await expect(page.locator('#confirm-paid')).toHaveCount(0);
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#another')).toBeVisible();
  expect(state.confirmations).toHaveLength(2);
  expect(state.confirmations[1].paidPassword).toBe(password);
  const reopened = await browser.newContext({ baseURL, storageState: await context.storageState() });
  try {
    await fixture(reopened);
    const next = await reopened.newPage();
    await review(next, { controls: false, initialBackend: 'eleven_music' });
    await expect(next.locator('#paid-password')).toHaveCount(0);
    await expect(next.locator('#confirm-paid')).toHaveCount(0);
    expect(await next.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain(password);
    await next.getByRole('button', { name: 'Sign out' }).click();
    expect(await next.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    await next.reload();
    await expect(next.locator('#login-form')).toBeVisible();
  } finally { await reopened.close(); }
});

test('a rejected saved password is cleared and its replacement is remembered', async ({ page, context }) => {
  await fixture(context);
  await review(page, { login: true });
  await page.evaluate(key => localStorage.setItem(key, 'outdated-password'), key);
  await page.reload();
  await expect(page.locator('#paid-password')).toHaveCount(0);
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#confirm-form .field-error')).toContainText('password did not work');
  await expect(page.locator('#paid-password')).toHaveValue('');
  await expect(page.locator('#confirm-paid')).not.toBeChecked();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.locator('#paid-password').fill(password);
  await page.locator('#confirm-paid').check();
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#another')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(password);
});

test('temporary confirmation failure preserves a saved password', async ({ page, context }) => {
  const state = await fixture(context);
  await review(page, { login: true });
  await page.evaluate(({ key, password }) => localStorage.setItem(key, password), { key, password });
  await page.reload();
  state.failure = 503;
  await expect(page.locator('#confirm-paid')).toHaveCount(0);
  await expect(page.locator('#paid-password')).toHaveCount(0);
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#confirm-form .field-error')).toContainText('Temporary confirmation failure');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(password);
  await page.reload();
  await expect(page.locator('#paid-password')).toHaveCount(0);
  state.failure = null;
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#another')).toBeVisible();
});

test('blocked localStorage still permits paid confirmation and sign-out', async ({ page, context }) => {
  await fixture(context);
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await review(page, { login: true });
  await page.locator('#paid-password').fill(password);
  await page.locator('#confirm-paid').check();
  await page.locator('#confirm-form .primary').click();
  await expect(page.locator('#another')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#login-form')).toBeVisible();
  expect(errors).toEqual([]);
});

test('duration estimates render compactly on desktop and mobile', async ({ page, context }) => {
  await fixture(context);
  await review(page, { login: true });
  await expect(page.locator('.paid-music-confirmation > p').first()).toHaveText('Eleven Music · paid$0.63 estimated generation cost for 4.17 minutes. This request reserves $4.17 from the shared $200 total cap.');
  await page.screenshot({ path: 'artifacts/paid-password/desktop-confirmation.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/paid-password/mobile-confirmation.png', fullPage: true });
  await page.locator('#edit').click();
  await expect(page.locator('#paid-music-cost')).toContainText('Estimated $0.63 for 4.17 minutes; reserves $4.17');
});

async function costNote(page, context, provider) {
  const state = await fixture(context);
  state.provider = provider;
  await review(page, { login: true });
  await page.locator('#edit').click();
  return page.locator('#paid-music-cost');
}

test('the plan balance is shown beside the cap', async ({ page, context }) => {
  const note = await costNote(page, context, { fresh: true, creditsRemaining: 199198, availableCents: 3621, resetAt: '2026-10-17T18:00:00.000Z' });
  await expect(note).toContainText('$191.00 is available to reserve. The ElevenLabs plan has about $36.21 of generation credits left, renewing Oct 17.');
  await expect(note).not.toContainText('not enough');
});

test('a length the plan credits cannot cover is called out', async ({ page, context }) => {
  const note = await costNote(page, context, { fresh: true, creditsRemaining: 1100, availableCents: 20, resetAt: '2026-10-17T18:00:00.000Z' });
  await expect(note).toContainText('The ElevenLabs plan has about $0.20 of generation credits left');
  await expect(note).toContainText('not enough for this length');
});

test('a stale plan balance is not shown', async ({ page, context }) => {
  const note = await costNote(page, context, { fresh: false, availableCents: null });
  await expect(note).toContainText('$191.00 is available to reserve.');
  await expect(note).not.toContainText('ElevenLabs plan');
});
