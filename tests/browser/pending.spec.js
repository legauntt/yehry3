import { test, expect } from "@playwright/test";

const publicId = (number) => `distonyc-${number.toString(16).padStart(24, "0")}`;
async function fixture(page, view = "grid") {
  await page.addInitScript(view => localStorage.setItem("yehry3:catalog-view", view), view);
  await page.clock.install();
  const wav = Buffer.alloc(44 + 8000 * 2 * 60);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const songs = Array.from({ length: 20 }, (_, i) => ({
    id: `catalog-${i}`, title: `Catalog song ${String(i).padStart(2, "0")}`,
    duration: 60, url: "/pending-fixture.wav", collection: "distonyc", votes: i,
    qualityIssues: [{ code: "vocal_dropout", seconds: 1.2 }],
  }));
  const upcoming = (number, status) => ({
    id: publicId(number), title: number === 1 ? "Next from the studio" : null,
    idea: number === 2 ? '<img src=x onerror=alert(1)> becomes a song' : `Future song ${number}`,
    status, updatedAt: new Date().toISOString(),
    originalPrompt: { idea: `Future song ${number}`, direction: "Lo-fi folk", keep: "Tony vocals", basisSongs: [], voiceModel: "v6" },
    progress: status === "processing" ? { stage: "Generating Tony vocals", percent: 55 } : null,
  });
  const state = {
    songs,
    queue: { inStudio: [upcoming(1, "processing"), upcoming(2, "completed")], queued: [upcoming(3, "queued"), upcoming(4, "queued")], recent: [], queuedTotal: 2, inStudioTotal: 2, page: 0, pageSize: 50 },
    queueOffline: false,
  };
  await page.route("**/pending-fixture.wav", route => route.fulfill({ body: wav, contentType: "audio/wav" }));
  await page.route("**/yehry3/songs/summary", route => route.fulfill({ json: { songs: state.songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => state.queueOffline ? route.abort() : route.fulfill({ json: state.queue }));
  await page.route("**/yehry3/queue/distonyc-*", route => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const item = [...state.queue.inStudio, ...(state.queue.needsAttention || []), ...state.queue.queued, ...state.queue.recent].find(song => song.id === id);
    return item ? route.fulfill({ json: item }) : route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  await page.route("**/yehry3/songs/distonyc-*", route => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const item = [...state.queue.inStudio, ...(state.queue.needsAttention || []), ...state.queue.queued, ...state.queue.recent].find(song => song.id === id);
    return item ? route.fulfill({ json: { song: item } }) : route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  await page.goto("/");
  await expect(page.locator(".pending-track")).toHaveCount(4);
  await expect(page.locator(".track")).toHaveCount(20);
  return state;
}

test("all collapsed upcoming rows refresh and publish without losing disclosure, playback, or reading position", async ({ page }) => {
  const state = await fixture(page, "list");
  const pending = page.locator(`.pending-track[data-id="${publicId(1)}"]`);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.every(row => !row.open))).toBe(true);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual([publicId(1), publicId(2), publicId(3), publicId(4)]);
  await expect(pending.locator("summary")).toContainText("Next from the studio");
  await expect(pending.locator("summary")).toContainText("55%");
  await expect(page.locator("#pending-tracks .track-art")).toHaveCount(4);
  await expect(page.locator("#pending-tracks img:not(.track-art)")).toHaveCount(0);
  expect(await page.locator("#pending-tracks").evaluate(node => node.compareDocumentPosition(document.querySelector("#tracks")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await pending.locator("summary").click();
  const song = page.locator('.track[data-id="catalog-4"]');
  await song.locator(".quality-notice summary").click();
  await song.getByRole("button", { name: "Play Catalog song 04", exact: true }).click();
  await expect.poll(() => page.locator("#audio").evaluate(audio => audio.paused)).toBe(false);
  await page.evaluate((id) => {
    window.savedPending = document.querySelector(`.pending-track[data-id="${id}"]`);
    window.savedSong = document.querySelector('.track[data-id="catalog-4"]');
    window.savedAudio = document.querySelector("#audio");
    window.scrollTo(0, document.querySelector('.track[data-id="catalog-8"]').getBoundingClientRect().top + scrollY - 80);
  }, publicId(1));
  const anchorTop = await page.locator('.track[data-id="catalog-8"]').evaluate(row => row.getBoundingClientRect().top);
  state.queue.inStudio[0].progress = { stage: "Mastering the saved vocals", percent: 72 };
  state.songs = state.songs.map(song => ({ ...song, votes: song.votes + 1 }));
  await page.clock.fastForward(30000);
  await expect(pending.locator("progress")).toHaveAttribute("value", "72");
  await expect(pending).toHaveAttribute("open", "");
  await expect(song.locator(".quality-notice")).toHaveAttribute("open", "");
  expect(await page.evaluate(() => window.savedPending.isConnected && window.savedSong.isConnected && window.savedAudio === document.querySelector("#audio") && !window.savedAudio.paused)).toBe(true);
  expect(Math.abs(await page.locator('.track[data-id="catalog-8"]').evaluate(row => row.getBoundingClientRect().top) - anchorTop)).toBeLessThan(2);
  state.songs = [{ ...state.songs[0], id: publicId(1), title: "Newly published song", publishedAt: new Date().toISOString() }, ...state.songs];
  state.queueOffline = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".track")).toHaveCount(21);
  await expect(pending).toHaveCount(0);
  await expect(page.locator(".pending-track")).toHaveCount(3);
  await expect(page.locator(".track").first()).toContainText("Newly published song");
  await expect(song.locator(".quality-notice")).toHaveAttribute("open", "");
  expect(Math.abs(await page.locator('.track[data-id="catalog-8"]').evaluate(row => row.getBoundingClientRect().top) - anchorTop)).toBeLessThan(2);
  expect(await page.evaluate(() => window.savedAudio === document.querySelector("#audio") && !window.savedAudio.paused)).toBe(true);
  await page.locator(".catalog-filters > summary").click();
  await page.getByLabel("Sort songs").selectOption("title");
  await expect(page.locator(".track").first()).toContainText("Catalog song 00");
});

test("pending rows remain compact on mobile and link to the matching request details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, "list");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height < 190 && !row.open))).toBe(true);
  await page.locator("#pending-tracks").screenshot({ path: "artifacts/pending-mobile.png" });
  const pending = page.locator(`.pending-track[data-id="${publicId(1)}"]`);
  await pending.locator("summary").click();
  await pending.getByRole("link", { name: "View original prompt" }).click();
  await expect(page).toHaveURL(new RegExp(`/original-prompt/\\?song=${publicId(1)}$`));
  await expect(page.locator(".original-prompt")).toContainText("Lo-fi folk");
  await page.goto("/");
  await pending.locator("summary").click();
  await pending.getByRole("link", { name: "View request details" }).click();
  await expect(page).toHaveURL(new RegExp(`/queue/details/\\?request=${publicId(1)}$`));
  await expect(page.locator(".queue-detail")).toContainText("Next from the studio");
  await expect(page.locator(".queue-detail")).toContainText("Generating Tony vocals · 55%");
});


test("pending cards share grid rows with released songs and preserve details when changing views", async ({ page }) => {
  const state = await fixture(page);
  // Use the preview server's real range-enabled MP3 when verifying seeking.
  state.songs = state.songs.map(song => ({ ...song, url: "/fearhunger/audio/fear-and-hunger-dungeon-rock.mp3" }));
  const pending = page.locator('.pending-track').first();
  const released = page.locator(".track").first();
  for (const count of [1, 2]) {
    state.queue.inStudio = state.queue.inStudio.slice(0, 1);
    state.queue.queued = count === 2 ? [{
      id: publicId(8), idea: "A moon eating a sandwich", authoredBy: "Pancakeo",
      status: "queued", voiceModel: "v8", progress: null,
    }] : [];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".pending-track")).toHaveCount(count);
    const pendingBox = await pending.boundingBox(), releasedBox = await released.boundingBox();
    expect(Math.abs(pendingBox.width - releasedBox.width)).toBeLessThan(1);
    expect(Math.abs(pendingBox.y - releasedBox.y)).toBeLessThan(1);
    expect(releasedBox.x).toBeGreaterThan(pendingBox.x);
  }
  await expect(page.locator(".pending-track [data-play], .pending-track [data-vote], .pending-track [data-save]")).toHaveCount(0);
  await expect(page.locator(".pending-track").last()).toContainText("Authored by Pancakeo");
  await pending.locator("summary").press("Enter");
  await expect(pending).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(pending).toHaveAttribute("open", "");
  const alignment = async (selector) => {
    const a = await pending.locator(selector).boundingBox();
    const b = await released.locator(selector === ".pending-title" ? ".track-info" : selector).boundingBox();
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  };
  await alignment(".track-art");
  await alignment(".pending-title");
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(pending).toHaveAttribute("open", "");
  await pending.locator("summary").press("Enter");
  await page.locator(".catalog-view-bar").evaluate(bar => bar.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "artifacts/pending-grid-desktop.png", animations: "disabled" });
  await page.locator("[data-play]").first().click();
  await expect.poll(() => page.locator("#audio").evaluate(audio => audio.paused)).toBe(false);
  await expect.poll(() => page.locator("#audio").evaluate(audio => audio.readyState)).toBeGreaterThan(0);
  await page.locator("#audio").evaluate(audio => { window.pendingAudio = audio; audio.currentTime = 12; });
  await expect.poll(() => page.locator("#audio").evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(12);
  state.songs = [{ ...state.songs[0], id: publicId(1), title: "The completed moon song", publishedAt: new Date().toISOString() }, ...state.songs];
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('.pending-track[data-id="' + publicId(1) + '"]')).toHaveCount(0);
  await expect(page.locator('.track[data-id="' + publicId(1) + '"] .track-art')).toBeVisible();
  const playback = await page.locator("#audio").evaluate(audio => ({ same: audio === window.pendingAudio, paused: audio.paused, time: audio.currentTime, seeking: audio.seeking }));
  expect(playback).toMatchObject({ same: true, paused: false });
  expect(playback.time).toBeGreaterThanOrEqual(12);
});

test("pending entries fit both mobile views and disappear from saved-song filters", async ({ page }) => {
  const state = await fixture(page);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ["Grid", "List"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(page.locator("#catalog-items")).toHaveAttribute("data-view", view.toLowerCase());
      const pending = page.locator(".pending-track").first();
      await pending.locator("summary").click();
      await expect(pending.locator(".pending-body")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await pending.locator("summary").click();
      if (width === 390) {
        await page.locator(".catalog-view-bar").evaluate(bar => bar.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: "artifacts/pending-" + view.toLowerCase() + "-mobile.png", animations: "disabled" });
      }
    }
  }
  await page.locator(".profile-details > summary").click();
  await page.locator("#saved-only").click();
  await expect(page.locator("#pending-tracks")).toBeHidden();
  await expect(page.locator(".pending-track:visible")).toHaveCount(0);
  await page.locator("#saved-only").click();
  await expect(page.locator(".pending-track:visible")).toHaveCount(4);
  state.queue = { ...state.queue, inStudio: [], queued: [] };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".pending-track")).toHaveCount(0);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.locator(".track")).toHaveCount(20);
});
