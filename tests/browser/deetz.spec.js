import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../../staticwebapp.config.json', import.meta.url), 'utf8'));
const apiBase = process.env.DEETZ_TEST_API_BASE || 'http://127.0.0.1:3000/yehry3';
test.beforeEach(async ({ page, context, baseURL }) => {
  await context.grantPermissions(['local-network-access'], {origin:baseURL});
  if (process.env.DEETZ_TEST_API_BASE) await page.route(`${baseURL}/assets/config.js`, route => route.fulfill({contentType:'application/javascript',body:`export const API_BASE = ${JSON.stringify(apiBase)};`}));
  // Keep production script/style policy; permit only the disposable local API in connect-src.
  await page.route(`${baseURL}/deetz/**`, async route => {
    const response = await route.fetch();
    await route.fulfill({response,headers:{...response.headers(),
      'content-security-policy':config.globalHeaders['Content-Security-Policy'].replace('connect-src \'self\' https://chairlift.fly.dev', `connect-src 'self' https://chairlift.fly.dev ${new URL(apiBase).origin}`)
    }});
  });
});

test('deetz is protected by the server and opens the complete guide after login', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const denied = await request.get(`${apiBase}/deetz`, { headers:{'X-Visitor-ID':crypto.randomUUID()} });
  expect(denied.status()).toBe(401);
  expect((await denied.json()).body).toBeUndefined();
  const response = await page.goto('/deetz');
  await expect(page).toHaveURL(/\/deetz\/$/);
  expect(await response.text()).not.toContain('id="stage-detail"');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#guide-root')).toBeEmpty();
  await page.getByLabel('Password', {exact:true}).fill('wrong-password');
  await page.getByRole('button', {name:'Open the guide'}).click();
  await expect(page.locator('#access-error')).toContainText('password did not work');
  await expect(page.locator('#guide-root')).toBeEmpty();
  await page.getByLabel('Password', {exact:true}).fill('wishbone');
  await page.getByRole('button', {name:'Open the guide'}).click();
  await expect(page.locator('#guide-root')).toBeVisible();
  await expect(page.locator('#access')).toBeHidden();
  await expect(page.locator('#guide-root h1')).toBeVisible();
  for (let index=0; index<6; index++) {
    await page.locator(`[data-step="${index}"]`).click();
    await expect(page.locator('#panel-count')).toHaveText(`STAGE 0${index+1} / 06`);
  }
  await page.locator('#next-stage').click();
  await expect(page.locator('#panel-count')).toHaveText('STAGE 01 / 06');
  const downloaded = page.waitForEvent('download');
  await page.locator('#download-plan').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('tony-c-example-plan.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).plan.recipe).toBeDefined();
  await page.reload();
  await expect(page.locator('#guide-root')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#lock-guide').click();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#guide-root')).toBeEmpty();
  await page.reload();
  await expect(page.locator('#login-form')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('yehry3:submitter'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('yehry3:auth:submitter'))).toBeNull();
  expect(errors).toEqual([]);
});

test('deetz renews an expired session and offers retry during API outages', async ({ page, baseURL }) => {
  let mode = 'outage';
  let renewed = false;
  await page.route('**/yehry3/deetz', async route => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    if (mode === 'outage') return route.fulfill({status:503,headers:{'access-control-allow-origin':new URL(baseURL).origin},json:{error:'The guide is temporarily unavailable.'}});
    if (mode === 'expired') {
      mode = 'renewed';
      return route.fulfill({status:401,headers:{'access-control-allow-origin':new URL(baseURL).origin},json:{error:'Please sign in again.'}});
    }
    const response = await route.fetch();
    const content = await response.json();
    if (mode === 'renewed') {
      renewed = true;
      return route.fulfill({response});
    }
    mode = 'expired';
    await route.fulfill({response,json:{...content,sessionExpiresAt:Date.now()+1800}});
  });
  await page.goto('/deetz/');
  await page.getByLabel('Password', {exact:true}).fill('wishbone');
  await page.getByRole('button', {name:'Open the guide'}).click();
  await expect(page.locator('#access-error')).toContainText('temporarily unavailable');
  await expect(page.locator('#guide-root')).toBeEmpty();
  mode = 'expiring';
  await page.locator('#retry-guide').click();
  await expect(page.locator('#guide-root')).toBeVisible();
  await expect.poll(() => renewed).toBe(true);
  await expect(page.locator('#guide-root')).toBeVisible();
  await expect(page.locator('#access')).toBeHidden();
  expect(await page.evaluate(() => Boolean(localStorage.getItem('yehry3:auth:submitter')))).toBe(true);
});
