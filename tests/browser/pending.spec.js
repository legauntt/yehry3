import { test, expect } from "@playwright/test";

const publicId = (number) => `distonyc-${number.toString(16).padStart(24, "0")}`;
async function fixture(page) {
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
    progress: status === "processing" ? { stage: "Generating Tony vocals", percent: 55 } : null,
  });
  const state = {
    songs,
    queue: { inStudio: [upcoming(1, "processing"), upcoming(2, "completed")], queued: [upcoming(3, "queued"), upcoming(4, "queued")], recent: [], queuedTotal: 2, inStudioTotal: 2, page: 0, pageSize: 50 },
    queueOffline: false,
  };
  await page.route("**/pending-fixture.wav", route => route.fulfill({ body: wav, contentType: "audio/wav" }));
  await page.route("**/yehry3/songs", route => route.fulfill({ json: { songs: state.songs, nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", route => state.queueOffline ? route.abort() : route.fulfill({ json: state.queue }));
  await page.goto("/");
  await expect(page.locator(".pending-track")).toHaveCount(3);
  await expect(page.locator(".track")).toHaveCount(20);
  return state;
}

test("three collapsed upcoming rows refresh and publish without losing disclosure, playback, or reading position", async ({ page }) => {
  const state = await fixture(page);
  const pending = page.locator(`.pending-track[data-id="${publicId(1)}"]`);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.every(row => !row.open))).toBe(true);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual([publicId(1), publicId(2), publicId(3)]);
  await expect(pending.locator("summary")).toContainText("Next from the studio");
  await expect(pending.locator("summary")).toContainText("55%");
  await expect(page.locator("#pending-tracks img")).toHaveCount(0);
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
  state.songs = [{ ...state.songs[0], id: publicId(1), title: "Newly published song" }, ...state.songs];
  state.queueOffline = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".track")).toHaveCount(21);
  await expect(pending).toHaveCount(0);
  await expect(page.locator(".pending-track")).toHaveCount(3);
  await expect(page.locator(".track").first()).toContainText("Newly published song");
  await expect(song.locator(".quality-notice")).toHaveAttribute("open", "");
  expect(Math.abs(await page.locator('.track[data-id="catalog-8"]').evaluate(row => row.getBoundingClientRect().top) - anchorTop)).toBeLessThan(2);
  expect(await page.evaluate(() => window.savedAudio === document.querySelector("#audio") && !window.savedAudio.paused)).toBe(true);
  await page.getByLabel("Sort songs").selectOption("title");
  await expect(page.locator(".track").first()).toContainText("Catalog song 00");
});

test("pending rows remain compact on mobile and their full-queue links open the matching request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".pending-track").evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height < 90 && !row.open))).toBe(true);
  await page.locator("#pending-tracks").screenshot({ path: "artifacts/pending-mobile.png" });
  const pending = page.locator(`.pending-track[data-id="${publicId(1)}"]`);
  await pending.locator("summary").click();
  await pending.getByRole("link", { name: "Follow in the queue" }).click();
  await expect(page).toHaveURL(new RegExp(`/queue/#${publicId(1)}$`));
  const target = page.locator(`[id="${publicId(1)}"]`);
  await expect(target).toBeVisible();
  await expect.poll(() => target.evaluate(row => row.getBoundingClientRect().top)).toBeLessThan(100);
});
