import { test, expect } from "@playwright/test";
const song = { id: "remix-source", title: "Source song", url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3", duration: 180,
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
    else if (path === "/prompts" && method === "POST") {
      writes.push(route.request().postDataJSON());
      draft = { id: "remix-draft", prompt: writes.at(-1).prompt, status: "draft", version: 1, details: { voiceModel: "v7", basisSongIds: [], ...(writes.at(-1).remixSongId ? { remixSource: source } : {}) } }; json = { prompt: draft };
    } else if (path.endsWith("/confirm")) {
      confirmations++; draft = { ...draft, status: "queued", confirmedAt: new Date().toISOString() }; json = { prompt: draft };
    } else if (path.startsWith("/prompts/")) {
      if (method === "PATCH") { const body = route.request().postDataJSON(); writes.push(body); draft = { ...draft, status: "review", version: draft.version + 1, details: { ...body, ...(body.remixSongId ? { remixSource: source, basisSongTitles: [source.title] } : {}) } }; }
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
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.locator("#lyric-sheet")).toHaveValue(song.lyrics.text);
  await expect(page.locator("#lyric-mode")).toHaveValue("adapt");
  await expect(page.locator('#basis-root [data-remix-source]')).toContainText('Recording attached: Source song');
  await expect(page.locator('.basis-picker')).toHaveCount(0);
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
