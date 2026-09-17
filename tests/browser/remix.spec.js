import { test, expect } from "@playwright/test";
const song = { id: "remix-source", title: "Source song", url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", duration: 180,
  remixAvailability: { status: 'ready', expiresAt: '2099-01-01T00:00:00Z' },
  lyrics: { text: "The moon is over the station\nThe train is taking me home", kind: "written" },
  originalPrompt: { idea: "A train song at midnight", direction: "Slow rock", keep: "Warmth", basisSongs: [], voiceModel: "v6" } };
const source = { version: 1, songId: song.id, title: song.title, url: 'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/source.mp3', sha256: 'a'.repeat(64), bytes: 1234, duration: 180 };
async function setup(page, existing, unavailable = false) {
  let draft = existing, writes = [], confirmations = 0;
  await page.addInitScript(() => localStorage.setItem("yehry3:auth:submitter", JSON.stringify({ token: "browser-fixture-session" })));
  if (existing) await page.addInitScript(id => sessionStorage.setItem("yehry3:draft", id), existing.id);
  await page.route("**/basis-songs.json", route => route.fulfill({ json: { songs: [{ id: "basis-source", title: song.title, duration: 180 }] } }));
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: song }));
  await page.route("**/yehry3/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/yehry3", "");
    const method = route.request().method();
    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    let json = {};
    if (path === `/songs/${song.id}`) json = { song };
    else if (path === `/remix-sources/${song.id}`) {
      if (unavailable) return route.fulfill({ status: 409, json: { error: 'This recording is not ready for remixing.' } });
      json = { source };
    }
    else if (path === "/voice-models") json = { models: [{ id: "v6", label: "Tony V6", note: "Established" }, { id: "v7", label: "Tony V7", note: "Experimental", experimental: true }] };
    else if (path === "/request-materials") json = { version: 1 };
    else if (path === "/generation") json = { version: 1, enabled: true };
    else if (path === "/music-backends") json = { enabled: true, supportsRemix: true, remainingCents: 19000 };
    else if (path === "/prompts" && method === "POST") {
      writes.push(route.request().postDataJSON());
      draft = { id: "remix-draft", prompt: writes.at(-1).prompt, status: "draft", version: 1, details: { voiceModel: "v7", basisSongIds: [], ...(writes.at(-1).remixSongId ? { remixSource: source } : {}) } }; json = { prompt: draft };
    } else if (path.endsWith("/confirm")) {
      confirmations++; draft = { ...draft, status: "queued", confirmedAt: new Date().toISOString() }; json = { prompt: draft };
    } else if (path.startsWith("/prompts/")) {
      if (method === "PATCH") { const body = route.request().postDataJSON(); writes.push(body); if (body.musicBackend === "eleven_music" && body.generation?.duration === undefined) body.generation = { ...body.generation, duration: 225 }; draft = { ...draft, status: "review", version: draft.version + 1, details: { ...body, ...(body.remixSongId ? { remixSource: source, basisSongTitles: [source.title] } : {}) } }; }
      json = { prompt: draft };
    }
    await route.fulfill({ json });
  });
  return { writes, confirmations: () => confirmations };
}
test("remix carries source context through editable review without auto-confirming", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/lyrics/?song=${song.id}`);
  await page.getByRole("link", { name: "Remix Source song", exact: true }).click();
  await expect(page.locator("#idea")).toHaveValue(/Original idea: A train song at midnight/);
  expect(state.writes).toHaveLength(0);
  await page.locator("#idea").fill("Remix Source song as a huge opera with a train chorus.");
  await page.getByRole("button", { name: "Find the direction" }).click();
  await expect(page.locator("#voice-model")).toHaveValue("v6");
  await expect(page.locator("#keep")).toHaveValue(/Source song/);
  await expect(page.getByLabel('What should change?')).toBeVisible();
  await expect(page.getByLabel('May the lyrics change?')).toBeVisible();
  await expect(page.locator("#lyric-mode")).toHaveValue("adapt");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.locator("#lyric-sheet")).toHaveValue(song.lyrics.text);
  await expect(page.locator("#lyric-mode")).toHaveValue("adapt");
  await expect(page.locator('#basis-root [data-remix-source]')).toContainText('Recording attached: Source song');
  await expect(page.locator('.basis-picker')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await page.locator("#direction").fill("Opera with a slow, enormous chorus");
  await page.getByRole("button", { name: "Review the request" }).click();
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeVisible();
  expect(state.confirmations()).toBe(0);
  expect(state.writes[0].remixSongId).toBe(song.id);
  expect(state.writes.at(-1)).toMatchObject({ voiceModel: "v6", remixSongId: song.id, basisSongIds: [], lyricSheet: { mode: "adapt", text: song.lyrics.text } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Send to the queue" })).toBeVisible();
  await page.getByRole("button", { name: "Fine-tune it" }).click();
  await expect(page.locator("#direction")).toHaveValue("Opera with a slow, enormous chorus");
  await expect(page.locator('#essentials-panel [data-remix-source]')).toContainText(source.title);
});
test("opening Remix preserves an existing draft until the listener chooses the new idea", async ({ page }) => {
  const state = await setup(page, { id: "saved-draft", prompt: "My existing acoustic request", version: 1, status: "draft", details: {} });
  await page.goto(`/distonyc/?remix=${song.id}`);
  await expect(page.locator("blockquote")).toHaveText("My existing acoustic request");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.locator("#lyric-sheet")).toHaveValue("");
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Start this remix as a new request" }).click();
  await expect(page.locator("#idea")).toHaveValue(/Remix “Source song”/);
});
test("an unsent idea is not silently paired with remix lyrics", async ({ page }) => {
  const state = await setup(page);
  await page.addInitScript(() => sessionStorage.setItem("yehry3:idea-text", "My original unrelated idea"));
  await page.goto(`/distonyc/?remix=${song.id}`);
  await expect(page.locator("#idea")).toHaveValue("My original unrelated idea");
  await expect(page.getByRole("button", { name: "Use the remix idea instead" })).toBeVisible();
  await page.getByRole("button", { name: "Find the direction" }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.locator("#lyric-sheet")).toHaveValue("");
  expect(state.confirmations()).toBe(0);
});
test('unavailable recordings never auto-seed a source-less remix, including a retained failed idea', async ({ page }) => {
  const state = await setup(page, undefined, true);
  await page.addInitScript(id => {
    sessionStorage.setItem('yehry3:idea-text', 'Remix Source song from my saved idea');
    sessionStorage.setItem('yehry3:remix-idea', id);
  }, song.id);
  await page.goto(`/distonyc/?remix=${song.id}`);
  await expect(page.getByRole('alert').first()).toContainText('not ready for remixing');
  await page.getByRole('button', { name: 'Find the direction' }).click();
  expect(state.writes).toHaveLength(0);
  expect(state.confirmations()).toBe(0);
});
test('the attached recording survives losing the remix URL and mobile layout', async ({ page }) => {
  const state = await setup(page, { id: 'saved-remix', prompt: 'A saved new arrangement', status: 'review', version: 2,
    details: { remixSource: source, basisSongIds: [], basisSongTitles: [source.title], direction: 'Slow roots rock', keep: 'The hook', voiceModel: 'v7' } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/distonyc/');
  await page.getByRole('button', { name: 'Fine-tune it' }).click();
  await expect(page.locator('#essentials-panel [data-remix-source]')).toContainText(source.title);
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect(state.writes.at(-1).remixSongId).toBe(song.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('changing a saved remix idea keeps its recording on the replacement draft', async ({ page }) => {
  const state = await setup(page, { id: 'saved-remix', prompt: 'A saved new arrangement', status: 'draft', version: 1,
    details: { remixSource: source, basisSongIds: [], voiceModel: 'v7' } });
  await page.goto('/distonyc/');
  await page.getByRole('button', { name: 'Change the idea' }).click();
  await page.locator('#idea').fill('Give this source a bass-heavy new arrangement');
  await page.getByRole('button', { name: 'Find the direction' }).click();
  expect(state.writes[0].remixSongId).toBe(song.id);
  await expect(page.locator('#essentials-panel [data-remix-source]')).toContainText(source.title);
});

test('lyric permission is visible, persists through review, and does not promise the original melody', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/distonyc/?remix=${song.id}`);
  await expect(page.locator('.remix-note')).toContainText('Melody and timing may change');
  await page.getByRole('button', { name: 'Find the direction' }).click();
  await page.getByLabel('May the lyrics change?').selectOption('preserve');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const words = 'The moon is over the station and the train is taking me home\nWe carry every memory together down the road';
  await page.locator('#lyric-sheet').fill(words);
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect(state.writes.at(-1).lyricSheet).toEqual({ mode: 'preserve', text: words });
  await page.reload();
  await page.getByRole('button', { name: 'Fine-tune it' }).click();
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await expect(page.getByLabel('May the lyrics change?')).toHaveValue('preserve');
});

test('original comparison switches real playback and preserves each position on mobile', async ({ page }) => {
  await setup(page);
  const remix = { ...song, remixOf: { songId: 'original-recording', title: 'The original recording', url: song.url } };
  await page.route(`**/songs/${song.id}.json`, route => route.fulfill({ json: remix }));
  await page.route(`**/yehry3/songs/${song.id}`, route => route.fulfill({ json: { song: remix } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/lyrics/?song=${song.id}#compare-original`);
  await expect(page.getByRole('link', { name: 'The original recording', exact: true })).toHaveAttribute('href', '/lyrics/?song=original-recording');
  const original = page.locator('#compare-original audio'), current = page.locator('.shared-song-player audio');
  await page.getByRole('button', { name: 'Play remix', exact: true }).click();
  await expect.poll(() => current.evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  await current.evaluate(audio => { audio.currentTime = 20; });
  await page.getByRole('button', { name: 'Play original', exact: true }).click();
  await expect.poll(() => original.evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  expect(await current.evaluate(audio => audio.paused)).toBe(true);
  await original.evaluate(audio => { audio.currentTime = 9; });
  await page.getByRole('button', { name: 'Play remix', exact: true }).click();
  await expect.poll(() => current.evaluate(audio => audio.currentTime)).toBeGreaterThan(20);
  expect(await original.evaluate(audio => audio.paused)).toBe(true);
  expect(await original.evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cards distinguish ready, unavailable, expired and unknown sources before opening the form', async ({ page }) => {
  const songs = [song, { ...song, id: 'not-ready', title: 'Not ready', remixAvailability: { status: 'unavailable' } },
    { ...song, id: 'expired', title: 'Expired source', remixAvailability: { status: 'ready', expiresAt: '2000-01-01T00:00:00Z' } },
    { ...song, id: 'unknown', title: 'Unknown source', remixAvailability: undefined }];
  await page.route('**/yehry3/**', route => route.fulfill({ json: { songs, nextVoteAt: null, inStudio: [], queued: [], recent: [], needsAttention: [], profiles: [] } }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Remix Source song', exact: true })).toBeVisible();
  await expect(page.locator('#tracks [data-id="not-ready"] [data-remix]')).toHaveText('Remix unavailable');
  await expect(page.locator('#tracks [data-id="expired"] [data-remix]')).toHaveText('Remix unavailable');
  await expect(page.getByRole('link', { name: 'Check remix availability for Unknown source' })).toBeVisible();
});


test('Eleven Remix retains its source while Auto stays blank through switching, preferences, and reload', async ({ page }) => {
  const state = await setup(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/distonyc/?remix=${song.id}`);
  await page.getByRole('button', { name: 'Find the direction' }).click();
  await expect(page.locator('#music-backend option[value="eleven_music"]')).toBeEnabled();
  await page.locator('#music-backend').selectOption('eleven_music');
  await expect(page.locator('#essentials-panel [data-remix-source]')).toContainText(source.title);
  await expect(page.locator('#essentials-panel [data-remix-guidance]')).toContainText('lyrics and musical brief');
  await expect(page.locator('#gen-duration')).toHaveValue('');
  await page.locator('#music-backend').selectOption('local');
  await expect(page.locator('#gen-duration')).toHaveValue('');
  await expect(page.locator('#essentials-panel [data-remix-guidance]')).toContainText('Its vocals guide');
  await page.locator('#music-backend').selectOption('eleven_music');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Timing & key', { exact: true }).click();
  await page.locator('#gen-duration').fill('300');
  await page.locator('#gen-duration').fill('');
  await page.locator('#generation-remember').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('yehry3:generation-preferences-v1')))).not.toHaveProperty('duration');
  await page.reload();
  await expect(page.locator('#music-backend')).toHaveValue('eleven_music');
  await expect(page.locator('#gen-duration')).toHaveValue('');
  await page.getByText('Timing & key', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/remix-auto-mobile.png', fullPage: true });
  const patch = page.waitForRequest(request => request.method() === 'PATCH' && request.url().includes('/prompts/'));
  await page.getByRole('button', { name: 'Review the request' }).click();
  const sent = (await patch).postDataJSON();
  expect(sent.generation).not.toHaveProperty('duration');
  expect(sent.remixSongId).toBe(song.id);
  expect(sent.musicBackend).toBe('eleven_music');
  await expect(page.locator('.paid-music-confirmation')).toContainText('$0.56');
  await expect(page.locator('.paid-music-confirmation')).toContainText('$3.75');
  expect(state.confirmations()).toBe(0);
  await page.reload();
  await expect(page.locator('.paid-music-confirmation')).toContainText('$3.75');
  await page.getByRole('button', { name: 'Fine-tune it' }).click();
  await expect(page.locator('#gen-duration')).toHaveValue('225');
  await expect(page.locator('#essentials-panel [data-remix-source]')).toContainText(source.title);
  await page.getByRole('tab', { name: 'Essentials', exact: true }).click();
  await page.locator('#music-backend').selectOption('local');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await page.getByText('Timing & key', { exact: true }).click();
  await page.locator('#gen-duration').fill('');
  const localPatch = page.waitForRequest(request => request.method() === 'PATCH' && request.url().includes('/prompts/'));
  await page.getByRole('button', { name: 'Review the request' }).click();
  expect((await localPatch).postDataJSON().generation).not.toHaveProperty('duration');
  expect(errors).toEqual([]);
});
