import { test, expect } from '@playwright/test';

const prompts = Array.from({ length: 32 }, (_, i) => i === 0
  ? 'Start with a train ride.\nKeep <the conductor> in the chorus.'
  : `Revision ${i}: keep the story moving.`);
const song = {
  id: 'prompt-history-fixture', title: 'The Last Train',
  originalPrompt: {
    idea: 'A late train home', voiceModel: 'v6', references: [],
    lyricSheet: { text: '[Verse]\nThe last train takes me home.', mode: 'keep',
      promptHistory: { prompts } },
  },
};

test('original prompt shows every retained workshop prompt in order, including after an offline reload', async ({ page }) => {
  let offline = false;
  await page.route('**/songs/prompt-history-fixture.json', route => route.fulfill({ status: 404 }));
  await page.route('**/yehry3/**', route => offline ? route.abort() : route.fulfill({ json: { song } }));
  await page.goto('/original-prompt/?song=prompt-history-fixture');
  await expect(page.getByRole('heading', { name: song.title, exact: true })).toBeVisible();
  const history = page.locator('.lyric-prompt-history');
  await history.locator('summary').click();
  await expect(history.locator('li')).toHaveCount(32);
  expect(await history.locator('li pre').allTextContents()).toEqual(prompts);
  await expect(history.locator('the, conductor')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await history.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/original-prompt-history-mobile.png' });
  offline = true;
  await page.reload();
  await history.locator('summary').click();
  expect(await history.locator('li pre').allTextContents()).toEqual(prompts);
});

test('older incomplete histories disclose missing prompts', async ({ page }) => {
  const older = structuredClone(song);
  older.originalPrompt.lyricSheet.promptHistory = { prompts: ['Make the chorus warmer.'], incomplete: true };
  await page.route('**/songs/prompt-history-fixture.json', route => route.fulfill({ status: 404 }));
  await page.route('**/yehry3/**', route => route.fulfill({ json: { song: older } }));
  await page.goto('/original-prompt/?song=prompt-history-fixture');
  const history = page.locator('.lyric-prompt-history');
  await history.locator('summary').click();
  await expect(history).toContainText('Some earlier prompts were not retained.');
  await expect(history.locator('li')).toHaveText(['Make the chorus warmer.']);
});
