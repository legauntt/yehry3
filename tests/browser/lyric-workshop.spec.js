import { test, expect } from '@playwright/test';
const first = '[Verse]\nThe last bus left my circuits cold\nI held a ticket made of tin\nThe rain kept tapping on my head\nAnd all my lights were dim again\n[Chorus]\nTake me home on the midnight line\nOne more stop and I will shine';
const second = first.replace('circuits cold', 'toaster cold').replace('midnight line', 'disco line');
async function setup(page, options = {}) {
  let draft = { id: 'workshop-song', version: 1, status: 'draft', prompt: options.prompt || 'A funny disco song about a lonely robot waiting for the last bus', details: { voiceModel: 'v6', ...(options.lyrics ? { lyricSheet: { text: options.lyrics, mode: 'adapt' } } : {}) } };
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
  await expect(page.locator('#workshop-version-prompt')).toHaveText('Make the robot boastful, then reveal he drives the bus.');
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

test('a first draft needs no extra prompt and includes current unsaved song choices', async ({ page }) => {
  const state = await setup(page);
  await page.keyboard.press('Escape');
  await page.locator('#keep').fill('Keep biological mandate in the hook');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.locator('#direction').fill('A silly disco villain with a tender final verse');
  await page.locator('#generation-enabled').check();
  for (const group of await page.locator('.generation-group').all()) {
    if (await group.getAttribute('open') === null) await group.locator('summary').click();
  }
  await page.locator('#gen-genre').selectOption('Disco');
  await page.locator('#gen-duration').fill('180');
  await page.locator('#gen-requiredPhrases').fill('biological mandate');
  await page.locator('#gen-avoidPhrases').fill('neon dreams');
  await page.locator('#gen-lockedLines').fill('The last bus is mine');
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.locator('#workshop-direction')).toHaveValue('');
  await expect(page.locator('#workshop-guidance-help')).toContainText('Leave this blank');
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  expect(state.writes[0]).toMatchObject({
    draftId: 'workshop-song', instruction: 'Write a first lyric draft from my song idea and all supplied song preferences.',
    direction: 'A silly disco villain with a tender final verse', keep: 'Keep biological mandate in the hook', duration: 180,
    generation: { genre: 'Disco', requiredPhrases: ['biological mandate'], avoidPhrases: ['neon dreams'], lockedLines: ['The last bus is mine'] },
  });
});

for (const theme of ['light', 'dark']) test(`workshop card and editor remain readable in ${theme} mode on desktop and mobile`, async ({ page }) => {
  await setup(page, { lyrics: first });
  await page.evaluate(dark => window.yehry3Theme.setDark(dark), theme === 'dark');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(async () => {
      const contrast = await page.locator('.lyric-workshop-entry h3, .lyric-workshop-entry p, .lyric-workshop-entry button, .lyric-workshop h2, .lyric-workshop .small, .lyric-workshop textarea, .lyric-workshop .primary, .lyric-workshop .quiet').evaluateAll(elements => {
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      return elements.filter(el => el.textContent.trim() || el.value).map(el => {
        let background = el;
        while (background.parentElement && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
        const values = [luminance(getComputedStyle(el).color), luminance(getComputedStyle(background).backgroundColor)].sort((a, b) => b - a);
        return { text: el.textContent.trim().slice(0, 45) || el.id, ratio: (values[0] + .05) / (values[1] + .05) };
      });
    });
      for (const item of contrast) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);
    }).toPass({ timeout: 3000 });
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/lyric-workshop-${theme}-${width}.png` });
  }
  await page.keyboard.press('Escape');
  await page.locator('.lyric-workshop-entry').screenshot({ path: `artifacts/lyric-entry-${theme}.png` });
});

test('quick revision uses current edits, saves earlier versions and survives reload', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  const edited = first.replace('circuits', 'sandwiches');
  await page.locator('#workshop-lyrics').fill(edited);
  await page.locator('#workshop-direction').fill('Give the robot a ridiculous parking fine.');
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(second);
  expect(state.writes.at(-1)).toMatchObject({ action: 'funnier', instruction: 'Give the robot a ridiculous parking fine.', lyrics: edited });
  await expect(page.locator('#workshop-version-prompt')).toHaveText('Funnier.\n\nGive the robot a ridiculous parking fine.');
  await page.reload();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(second);
  await expect(page.locator('#workshop-version-prompt')).toContainText('ridiculous parking fine');
  await page.locator('#workshop-version').selectOption({ index: 2 });
  await expect(page.locator('#workshop-lyrics')).toHaveValue(edited);
  await expect(page.locator('#workshop-version-prompt')).toContainText('Edited by you');
  await page.locator('#workshop-version').selectOption({ index: 1 });
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  await expect(page.locator('#workshop-version-prompt')).toContainText('Write a first lyric draft');
  expect(state.count()).toBe(2);
});

test('song idea is visible immediately and only long ideas need show more', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#workshop-idea-text')).toBeVisible();
  await expect(page.locator('#workshop-idea-text')).toContainText('lonely robot');
  await expect(page.getByRole('button', { name: 'Show more', exact: true })).toBeHidden();
});

test('long song idea has a readable preview with keyboard show more and less', async ({ page }) => {
  const prompt = 'A robot misses the last bus and argues with a parking meter. '.repeat(12) + 'The final secret is a pineapple.';
  await setup(page, { prompt });
  await expect(page.locator('#workshop-idea-text')).toBeVisible();
  await expect(page.locator('#workshop-idea-text')).not.toContainText('pineapple');
  const more = page.getByRole('button', { name: 'Show more', exact: true });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#workshop-idea-text')).toHaveText(prompt);
  await expect(page.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#workshop-idea-text')).not.toContainText('pineapple');
});

test('identical lyric responses retain distinct prompts and bounded history survives restoring oldest', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Generate lyrics', exact: true }).click();
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  for (let i = 0; i < 8; i++) {
    await page.locator('#workshop-direction').fill('Make the lyric robot tell joke number ' + i);
    await page.getByRole('button', { name: 'Funnier', exact: true }).click();
    await expect(page.locator('#workshop-version-prompt')).toContainText('joke number ' + i);
  }
  await expect(page.locator('#workshop-version option')).toHaveCount(9);
  await page.locator('#workshop-lyrics').fill(first + '\nI wrote this extra line myself.');
  await page.locator('#workshop-version').selectOption({ index: 1 });
  await expect(page.locator('#workshop-version-prompt')).toContainText('joke number 0');
  await page.locator('#workshop-version').selectOption({ index: 8 });
  await expect(page.locator('#workshop-lyrics')).toHaveValue(/extra line myself/);
  expect(state.count()).toBe(9);
});

test('versions saved before prompt history remain readable and can be revised', async ({ page }) => {
  await page.addInitScript(({ lyrics }) => sessionStorage.setItem('yehry3:lyric-workshop:workshop-song', JSON.stringify({
    v: 1, lyrics, base: lyrics, instruction: '', pending: null, versions: [{ lyrics, label: 'Generated draft' }],
  })), { lyrics: first });
  await setup(page, { lyrics: first });
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  await expect(page.locator('#workshop-version-prompt')).toContainText('not saved for this older version');
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  await expect(page.locator('#workshop-version-prompt')).toHaveText('Funnier.');
  await page.locator('#workshop-version').selectOption({ index: 1 });
  await expect(page.locator('#workshop-version-prompt')).toContainText('not saved for this older version');
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
  await expect(page.locator('[data-workshop-progress]')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.getByRole('button', { name: 'Use these lyrics', exact: true })).toBeDisabled();
  state.jobs.values().next().value.state = 'ready';
  await expect(page.locator('[data-workshop-status]')).toContainText('Draft ready');
  await expect(page.locator('[data-workshop-progress]')).toBeHidden();
  await expect(page.locator('#workshop-version-prompt')).toContainText('Polish these lyrics');
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
  await expect(page.locator('[data-workshop-progress]')).toBeHidden();
  expect(state.cancellations()).toBe(1);
});

test('rolling hat is prominent during writing on mobile and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, { pending: true, lyrics: first });
  await page.evaluate(() => window.yehry3Theme.setDark(true));
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  const progress = page.locator('[data-workshop-progress]');
  await expect(progress).toBeInViewport();
  await expect(page.locator('.workshop-hat')).toHaveCSS('animation-name', 'workshop-tumble');
  await expect(page.locator('.workshop-hat-travel')).toHaveCSS('animation-name', 'workshop-travel');
  const transform = await page.locator('.workshop-hat-travel').evaluate(el => getComputedStyle(el).transform);
  await expect(page.locator('.workshop-hat-travel')).not.toHaveCSS('transform', transform);
  await expect(page.locator('.workshop-hat-track')).toHaveCSS('border-bottom-width', '0px');
  await expect(progress).not.toContainText('Tony’s hat is chasing');
  Object.assign(state.jobs.values().next().value, { state: 'working', phase: 'writing' });
  await expect(page.locator('[data-workshop-status]')).toContainText('Writing your lyrics');
  await page.screenshot({ path: 'artifacts/lyric-workshop-rolling-hat-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(progress).toBeVisible();
  await expect(page.locator('.workshop-hat')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.workshop-hat-travel')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.workshop-hat-track')).toBeHidden();
  await expect(page.locator('.workshop-loader')).toBeVisible();
  await expect(page.locator('.workshop-spinner')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: 'artifacts/lyric-workshop-reduced-loader-mobile.png' });
  await page.getByRole('button', { name: 'Stop writing', exact: true }).click();
  await expect(progress).toBeHidden();
});

for (const profile of ['slow frames', 'no frames', 'paused hat']) test(`a ${profile} browser falls back to a simple loader without losing the draft`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { pending: true, lyrics: first });
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  if (profile === 'paused hat') {
    await page.locator('.workshop-hat-travel').evaluate(el => el.getAnimations().forEach(animation => animation.pause()));
  } else {
    await page.evaluate(profile => {
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
      window.restoreFrames = () => { window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel; };
      window.requestAnimationFrame = profile === 'slow frames'
        ? callback => setTimeout(() => callback(performance.now()), 120)
        : () => 0;
      window.cancelAnimationFrame = id => clearTimeout(id);
    }, profile);
  }
  const progress = page.locator('[data-workshop-progress]');
  await expect(progress).toHaveAttribute('data-simple', 'true');
  await page.evaluate(() => window.restoreFrames?.());
  await expect(page.locator('.workshop-hat-track')).toBeHidden();
  await expect(page.locator('.workshop-loader')).toBeVisible();
  await expect(page.locator('.workshop-spinner')).toHaveCSS('animation-name', 'workshop-spin');
  await expect(page.locator('#workshop-lyrics')).toHaveValue(first);
  await page.screenshot({ path: `artifacts/lyric-workshop-${profile.replaceAll(' ', '-')}.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open lyric workshop' }).click();
  await expect(page.locator('.workshop-loader')).toBeVisible();
  await page.getByRole('button', { name: 'Stop writing', exact: true }).click();
  await expect(progress).toBeHidden();
  await expect(page.locator('#workshop-lyrics')).toBeEditable();
});

test('backgrounding the workshop pauses sampling without marking a healthy browser as slow', async ({ page }) => {
  await setup(page, { pending: true, lyrics: first });
  await page.getByRole('button', { name: 'Funnier', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const progress = page.locator('[data-workshop-progress]');
  await expect(progress).toHaveAttribute('data-paused', 'true');
  await page.waitForTimeout(2200);
  await expect(progress).toHaveAttribute('data-simple', 'false');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(progress).toHaveAttribute('data-paused', 'false');
  await page.waitForTimeout(2200);
  await expect(progress).toHaveAttribute('data-simple', 'false');
  await expect(page.locator('.workshop-hat-track')).toBeVisible();
  await page.getByRole('button', { name: 'Stop writing', exact: true }).click();
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
