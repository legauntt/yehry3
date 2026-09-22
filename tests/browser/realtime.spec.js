import { test, expect } from "@playwright/test";

const room = { version: "0000000000000001", listeners: [], total: 0, beatMs: 25000 };
const packet = (version = "0000000000000001") => ({ version: room.version + version, topics: { listeners: room, catalog: { version } } });
const song = { id: "realtime-song", title: "Realtime song", collection: "tonyai", url: "/realtime.wav", duration: 240, votes: 0, order: 0, feedback: {} };
const emptyQueue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };
async function mocked(page) {
  const state = { song: structuredClone(song), reads: 0, lines: [], hold: null };
  await page.route("**/catalog-summary.json", route => route.fulfill({ json: { songs: [state.song] } }));
  await page.route("**/yehry3/queue?*", route => route.fulfill({ json: emptyQueue }));
  await page.route("**/yehry3/songs/summary", async route => {
    state.reads++;
    const snapshot = structuredClone(state.song), hold = state.hold;
    if (hold) { state.hold = null; await hold; }
    await route.fulfill({ json: { songs: [snapshot], nextVoteAt: null } }).catch(() => {});
  });
  await page.route("**/yehry3/listeners", route => route.fulfill({ json: room }));
  await page.routeWebSocket("**/yehry3/events/socket", line => { state.lines.push(line); line.send(JSON.stringify(packet())); });
  await page.goto("/");
  await expect(page.locator('[data-id="realtime-song"] .track-art')).toBeVisible();
  await expect.poll(() => state.lines.length).toBe(1);
  await page.waitForTimeout(500);
  return state;
}

test("another browser sees a saved redraw while its audio and filters stay in place", async ({ browser, request }) => {
  const response = await request.get("http://127.0.0.1:3000/yehry3/songs/summary", { headers: { "X-Visitor-ID": crypto.randomUUID() } });
  expect(response.ok()).toBe(true);
  const catalog = (await response.json()).songs;
  const selected = catalog.find(item => item.id === "medusa") || catalog[0];
  const recording = catalog.find(item => new URL(item.url).pathname.startsWith("/fearhunger/"));
  expect(recording).toBeTruthy();
  const contexts = [await browser.newContext(), await browser.newContext({ viewport: { width: 390, height: 844 } })];
  try {
    const pages = [];
    for (const context of contexts) {
      await context.route("**/yehry3/songs/summary", async route => {
        const response = await route.fetch(), data = await response.json();
        data.songs = data.songs.filter(item => item.id === selected.id).map(item => ({ ...item, url: recording.url, duration: recording.duration }));
        await route.fulfill({ json: data });
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__sockets = [];
        const Native = window.WebSocket;
        window.WebSocket = class extends Native { constructor(...args) { super(...args); window.__sockets.push(this); } };
      });
      await page.goto("/");
      await expect.poll(() => page.evaluate(() => window.__sockets.filter(s => s.readyState === 1).length)).toBe(1);
      pages.push(page);
    }
    const [author, observer] = pages;
    await observer.locator(".catalog-filters > summary").click();
    await observer.locator("#search").fill(selected.title);
    await observer.locator('[data-id="' + selected.id + '"] [data-play]').click();
    await expect.poll(() => observer.evaluate(() => window.yehry3Player.audio.currentTime)).toBeGreaterThan(0.2);
    await observer.evaluate(() => { window.__audio = window.yehry3Player.audio; window.__audio.currentTime = 20; });
    await expect.poll(() => observer.evaluate(() => window.__audio.currentTime)).toBeGreaterThanOrEqual(20);
    const art = observer.locator('[data-id="' + selected.id + '"] .track-art');
    const before = await art.getAttribute("src");
    await author.locator('[data-id="' + selected.id + '"] [data-art]').click();
    const dialog = author.locator("dialog.art-remix");
    await dialog.getByRole("button", { name: "Shuffle the rest" }).click();
    const preview = await dialog.locator("[data-art-next]").getAttribute("src");
    expect(preview).not.toBe(before);
    await dialog.getByRole("button", { name: "Use this redraw" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(art).toHaveAttribute("src", preview, { timeout: 6000 });
    await expect(observer.locator("#search")).toHaveValue(selected.title);
    const playback = await observer.evaluate(() => ({ same: window.__audio === window.yehry3Player.audio, paused: window.__audio.paused, time: window.__audio.currentTime }));
    expect(playback.same).toBe(true);
    expect(playback.paused).toBe(false);
    expect(playback.time).toBeGreaterThanOrEqual(20);
    expect(await observer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await observer.screenshot({ path: "artifacts/realtime-mobile.png", fullPage: true });
  } finally { await Promise.all(contexts.map(context => context.close().catch(() => {}))); }
});

test("a change during a fetch is fetched again, and bursts are coalesced", async ({ page }) => {
  const state = await mocked(page), art = page.locator('[data-id="realtime-song"] .track-art');
  const before = await art.getAttribute("src"), reads = state.reads;
  let release;
  state.hold = new Promise(resolve => { release = resolve; });
  state.lines[0].send(JSON.stringify(packet("0000000000000002")));
  await expect.poll(() => state.reads).toBe(reads + 1);
  state.song.artRemix = { seed: 9001, theme: "robot" };
  for (let i = 3; i < 12; i++) state.lines[0].send(JSON.stringify(packet(i.toString(16).padStart(16, "0"))));
  await page.waitForTimeout(300);
  release();
  await expect(art).not.toHaveAttribute("src", before);
  await expect.poll(() => state.reads).toBe(reads + 2);
  await page.waitForTimeout(300);
  expect(state.reads).toBe(reads + 2);
});

test("reconnecting resyncs even an unchanged revision, and a departed page unsubscribes", async ({ page }) => {
  const state = await mocked(page), art = page.locator('[data-id="realtime-song"] .track-art');
  const before = await art.getAttribute("src");
  state.song.artRemix = { seed: 701, theme: "robot" };
  await page.route("**/yehry3/events**", route => route.fulfill({ status: 503, json: { error: "restarting" } }));
  await state.lines[0].close({ code: 1012 });
  await expect.poll(() => state.lines.length, { timeout: 6000 }).toBe(2);
  await expect(art).not.toHaveAttribute("src", before);
  await page.evaluate(async () => { const { navigate } = await import("/assets/shell.js"); await navigate("/queue/"); });
  await expect(page.locator("#queue-updated")).toBeVisible();
  await page.waitForTimeout(300);
  const reads = state.reads;
  state.lines[1].send(JSON.stringify(packet("0000000000000020")));
  await page.waitForTimeout(500);
  expect(state.reads).toBe(reads);
  expect(state.lines.length).toBe(2);
});
