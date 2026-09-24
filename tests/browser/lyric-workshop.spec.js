import { test, expect } from '@playwright/test';
const first = '[Verse]\nThe last bus left my circuits cold\nI held a ticket made of tin\nThe rain kept tapping on my head\nAnd all my lights were dim again\n[Chorus]\nTake me home on the midnight line\nOne more stop and I will shine';
const second = first.replace('circuits cold', 'toaster cold').replace('midnight line', 'disco line');
async function setup(page, options = {}) {
  let draft = { id: 'workshop-song', version: 1, status: 'draft', prompt: 'A funny disco song about a lonely robot waiting for the last bus', details: { voiceModel: 'v6', ...(options.lyrics ? { lyricSheet: { text: options.lyrics, mode: 'adapt' } } : {}) } };
  const writes = [], jobs = new Map();
  let firstLost = Boolean(options.lost), getFailure = Boolean(options.getFailure), counter = 0, cancellations = 0;
  await page.addInitScript(() => {
    localStorage.setItem('yehry3:auth:submitter', JSON.stringify({ token: 'fixture' }));
    sessionStorage.setItem('yehry3:draft', 'workshop-song');
  });
  await page.route('**/yehry3/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/yehry3', ''), method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    let json = {};
    if (path === '/voice-models') json = { models: [{ id: 'v6', label: 'Tony V6', note: 'Established' }] };
    else if (path === '/request-materials') json = { version: 1 };
    else if (path === '/generation') json = { enabled: true, version: 1 };
    else if (path === '/music-backends') json = { enabled: false };
    else if (path === '/generation-reviews') json = { reviews: [] };
    else if (path === '/lyric-workshop') {
      if (method === 'GET') json = { version: 1, available: !options.offline, maxCharacters: 12000 };
      else {
        const body = route.request().postDataJSON(); writes.push(body);
        let job = jobs.get(body.requestId);
        if (!job) {
          counter++;
          const invalid = ['How are you?', "What's the weather?", "What's the square root", 'Write a python program'].includes(body.instruction);
          job = { id: body.requestId, state: invalid ? 'rejected' : options.pending ? 'queued' : 'ready', lyrics: counter > 1 ? second : first,
            message: invalid ? 'This workshop only writes and revises song lyrics. Describe a song or a change to its words.' : undefined };
          jobs.set(job.id, job);
        }
        if (firstLost) { firstLost = false; return route.abort('failed'); }
        json = { job };
      }
    } else if (path.startsWith('/lyric-workshop/')) {
      if (method === 'GET' && getFailure) { getFailure = false; return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }); }
      const job = jobs.get(path.split('/').at(-1));
      if (method === 'DELETE') { cancellations++; job.state = 'canceled'; job.message = 'Writing stopped. Your previous words are unchanged.'; delete job.lyrics; }
      json = { job };
    } else if (path.startsWith('/prompts/')) {
      if (method === 'PATCH') { const body = route.request().postDataJSON(); writes.push(body); draft = { ...draft, status: 'review', version: draft.version + 1, details: body }; }
      json = { prompt: draft };
    }
    await route.fulfill({ json });
  });
  await page.goto('/distonyc/');
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.getByRole('dialog', { name: 'Lyric workshop' })).toBeVisible();
  return { writes, jobs, count: () => counter, cancellations: () => cancellations };
}

test('generate, edit and choose exact lyrics before the normal request review', async ({ page }) => {
  const state = await setup(page);
  await page.locator('#workshop-direction').fill('Make the robot boastful, then reveal he drives the bus.');
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  await page.screenshot({ path: 'artifacts/lyric-workshop-desktop.png' });
  expect(state.writes[0]).toMatchObject({ draftId: 'workshop-song', instruction: 'Make the robot boastful, then reveal he drives the bus.', action: 'custom' });
  const edited = first.replace('paper', 'golden').replace('made of tin', 'made of cheese');
  await page.locator('#workshop-lyrics').fill(edited);
  await page.getByRole('button', { name: 'Use these lyrics', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect(state.writes.at(-1).lyricSheet).toEqual({ text: edited, mode: 'preserve' });
  await expect(page.getByRole('button', { name: 'Send to the queue' })).toBeVisible();
});

test('quick revision uses current edits, saves earlier versions and survives reload', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  const edited = first.replace('circuits', 'sandwiches');
  await page.locator('#workshop-lyrics').fill(edited);
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(second);
  expect(state.writes.at(-1)).toMatchObject({ action: 'funnier', instruction: '', lyrics: edited });
  await page.reload();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(second);
  await page.locator('#workshop-version').selectOption('1');
  await expect(page.locator('#workshop-lyrics')).toHaveValue(edited);
  expect(state.count()).toBe(2);
});

test('all four unrelated examples show the scope rejection and preserve existing lyrics', async ({ page }) => {
  await setup(page, { lyrics: first });
  for (const prompt of ['How are you?', "What's the weather?", "What's the square root", 'Write a python program']) {
    await page.locator('#workshop-direction').fill(prompt);
    await page.getByRole('button', { name: 'Revise lyrics', exact: true }).click();
    await expect(page.locator('[data-workshop-error]')).toContainText('only writes and revises song lyrics');
    await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  }
});

test('pending generation resumes after reload without creating another job', async ({ page }) => {
  const state = await setup(page, { pending: true, lyrics: first });
  await page.getByRole('button', { name: 'Revise lyrics', exact: true }).click();
  await expect(page.locator('[data-workshop-status]')).toContainText('Waiting');
  await page.reload();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.getByRole('button', { name: 'Use these lyrics', exact: true })).toBeDisabled();
  state.jobs.values().next().value.state = 'ready';
  await expect(page.locator('[data-workshop-status]')).toContainText('Draft ready');
  expect(state.count()).toBe(1); expect(state.writes).toHaveLength(1);
});

test('lost creation response retries the same request ID and retains the draft', async ({ page }) => {
  const state = await setup(page, { lost: true });
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  expect(state.count()).toBe(1); expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
});

test('stop preserves the previous draft and makes it editable again', async ({ page }) => {
  const state = await setup(page, { pending: true, lyrics: first });
  await page.getByRole('button', { name: 'Revise lyrics', exact: true }).click();
  await expect(page.locator('[data-workshop-status]')).toContainText('Waiting');
  await page.getByRole('button', { name: 'Stop writing', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toBeEditable();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  expect(state.cancellations()).toBe(1);
});

test('temporary polling failure keeps the job identity for a safe retry', async ({ page }) => {
  const state = await setup(page, { pending: true, getFailure: true });
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  state.jobs.values().next().value.state = 'ready';
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  expect(state.count()).toBe(1); expect(state.writes).toHaveLength(1);
});

test('offline editing, keyboard dismissal, focus return and mobile approval stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { offline: true, lyrics: first });
  await expect(page.locator('[data-workshop-availability]')).toContainText('offline');
  await expect(page.getByRole('button', { name: 'Revise lyrics', exact: true })).toBeDisabled();
  await page.locator('#workshop-lyrics').fill(second);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open lyric workshop' })).toBeFocused();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(second);
  expect(await page.getByRole('dialog', { name: 'Lyric workshop' }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/lyric-workshop-mobile.png' });
  await page.getByRole('button', { name: 'Use these lyrics', exact: true }).click();
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect(page.locator('#lyric-sheet')).toHaveValue(second);
  await expect(page.locator('#lyric-mode')).toHaveValue('preserve');
});

test('closing an unchosen workshop does not replace the submitted lyric sheet', async ({ page }) => {
  const state = await setup(page, { lyrics: first });
  await page.locator('#workshop-lyrics').fill(second);
  await page.getByRole('button', { name: 'Keep draft & close' }).click();
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect(state.writes.at(-1).lyricSheet).toEqual({ text: first, mode: 'adapt' });
});

test('blocked browser storage explains the limit while editing and approval still work', async ({ page }) => {
  const state = await setup(page, { lyrics: first });
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
  await page.locator('#workshop-lyrics').fill(second);
  await expect(page.locator('[data-workshop-storage]')).toContainText('could not save');
  await page.getByRole('button', { name: 'Use these lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect(state.writes.at(-1).lyricSheet).toEqual({ text: second, mode: 'preserve' });
});
