import { test, expect } from "@playwright/test";
import { songSummary } from "../../assets/song-summary.js";

// The avatars bob gently; without motion a seat holds still to be clicked.
test.use({ reducedMotion: "reduce" });

const wav = () => {
  const buffer = Buffer.alloc(44 + 8000 * 2 * 4);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
};
const songs = [
  { id: "room-first", title: "First in the room", duration: 4, url: "/room-fixture.wav", collection: "tonyai", votes: 2, order: -2, voiceModel: "v7" },
  { id: "room-second", title: "Second <in> the room", duration: 4, url: "/room-fixture.wav", collection: "tonyai", votes: 1, order: -1, voiceModel: "v7" },
];
const queue = { inStudio: [], needsAttention: [], queued: [], recent: [], queuedTotal: 0, inStudioTotal: 0, page: 0, pageSize: 50 };
const you = { id: "aaaaaaaaaaaaaa00", name: "happy-rabbit", anonymous: true, emoji: "🐇", hue: 120 };
const jesse = { id: "bbbbbbbbbbbbbb01", name: "Jesse Gauntt", anonymous: false, emoji: "🦊", hue: 20, song: { id: "room-first", title: "First in the room" }, since: "2026-09-21T10:00:00.000Z" };
const fox = { id: "cccccccccccccc02", name: "sleepy-fox", anonymous: true, emoji: "🦊", hue: 250, song: null, since: null, idle: true };

// A stand-in studio: reports are recorded, and a poll is held until the test changes the room.
async function studio(page, { reject = () => false } = {}) {
  const state = { version: "1000000000000001", listeners: [{ ...you, song: null, since: null }, jesse, fox], reports: [], left: [], present: true };
  const body = () => ({ version: state.version, listeners: state.listeners.filter((listener) => state.present || listener.id !== you.id), total: state.listeners.length, beatMs: 25000 });
  await page.route("**/room-fixture.wav", (route) => route.fulfill({ body: wav(), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: queue }));
  await page.route("**/yehry3/listens", (route) => route.fulfill({ json: {} }));
  await page.route("**/yehry3/listeners**", async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      state.left.push(new URL(request.url()).pathname.split("/").pop());
      state.present = false;
      state.version = "1000000000000009";
      return route.fulfill({ json: { left: true } });
    }
    if (request.method() === "POST") {
      const report = { ...request.postDataJSON(), authorization: request.headers().authorization || null };
      state.reports.push(report);
      if (reject(report)) return route.fulfill({ status: 401, json: { error: "Please sign in again." } });
      state.present = true;
      return route.fulfill({ json: { you, ...body() } });
    }
    const since = new URL(request.url()).searchParams.get("since"), began = Date.now();
    while (since === state.version && Date.now() - began < 20000) await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({ json: body() }).catch(() => { /* The page closed while this poll was held. */ });
  });
  return state;
}

test("listeners sit at the edges, follow each other's songs, and can hide", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/?sort=catalog");
  const seats = page.locator(".room-seat");
  await expect(seats).toHaveCount(3);
  // You come first on the left, marked as you, under the animal the studio chose.
  const mine = page.locator(".room-left .room-seat").first();
  await expect(mine).toHaveClass(/is-you/);
  await expect(mine.locator(".room-face")).toHaveText("🐇");
  expect(state.reports[0].tab).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.reports[0]).toMatchObject({ songId: null, idle: false, authorization: null });
  await expect(mine.locator(".room-avatar")).toHaveAttribute("aria-label", "happy-rabbit (you): online");
  expect(state.reports[0].name).toBeUndefined();
  // A named listener shows initials and what they are playing; nothing covers the page until asked.
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  await expect(named.locator(".room-face")).toHaveText("JG");
  await expect(named).toHaveClass(/is-listening/);
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: listening to First in the room");
  await expect(named.locator(".room-card")).toBeHidden();
  await named.locator(".room-avatar").hover();
  await expect(named.locator(".room-card")).toBeVisible();
  await expect(named.locator(".room-card a")).toHaveAttribute("href", "/#room-first");
  const idle = page.locator('.room-seat[data-id="cccccccccccccc02"]');
  await expect(idle.locator(".room-avatar")).toHaveAttribute("aria-label", "sleepy-fox: idle");
  await expect(idle).toHaveClass(/is-idle/);
  await expect(named).not.toHaveClass(/is-idle/);
  const edges = await page.locator(".room-avatar").evaluateAll((avatars) => avatars.map((avatar) => avatar.getBoundingClientRect()).map((box) => Math.min(box.left, innerWidth - box.right)));
  expect(Math.max(...edges)).toBeLessThan(20);

  // Playing a song is reported once it settles.
  await page.locator('.track[data-id="room-second"] [data-play]').click();
  await expect.poll(() => state.reports.at(-1).songId, { timeout: 8000 }).toBe("room-second");

  // The held poll answers when someone changes song, and their card steps out by itself.
  state.listeners = [state.listeners[0], { ...jesse, song: { id: "room-second", title: "Second <in> the room" } }, fox];
  state.version = "1000000000000002";
  await page.mouse.move(700, 500);
  await expect(named).toHaveClass(/is-peeking/, { timeout: 8000 });
  await expect(named.locator(".room-card a")).toHaveText("Second <in> the room");
  await expect(named.locator(".room-card")).toBeVisible();

  // Hiding leaves the room at once and lasts across a reload; the ghost brings you back.
  const reports = state.reports.length;
  await mine.locator(".room-avatar").click();
  await expect(mine.locator(".room-note")).toContainText("Sign in on Make a request");
  await mine.getByRole("button", { name: "Hide me" }).click();
  await expect.poll(() => state.left.length).toBe(1);
  expect(state.left[0]).toBe(state.reports[0].tab);
  await expect(page.locator(".room-seat.is-you")).toHaveCount(0);
  await expect(page.locator(".room-ghost")).toBeVisible();
  await page.reload();
  await expect(page.locator(".room-seat")).toHaveCount(2);
  await expect(page.locator(".room-ghost")).toBeVisible();
  expect(state.reports.length).toBe(reports);
  await page.locator(".room-ghost").click();
  await expect(page.locator(".room-seat.is-you")).toHaveCount(1);
  expect(state.reports.length).toBe(reports + 1);
});

test("a signed-in browser sends its saved name, and a refused session still joins as an animal", async ({ page }) => {
  await page.addInitScript(() => {
    // Runs again on every reload, so it must not undo a session the test has since replaced.
    if (!localStorage.getItem("yehry3:authored-by")) localStorage.setItem("yehry3:auth:submitter", JSON.stringify({ token: "saved-session", password: null }));
    localStorage.setItem("yehry3:authored-by", "  Jesse Gauntt ");
  });
  const state = await studio(page, { reject: (report) => report.authorization === "Bearer expired-session" });
  await page.goto("/queue/");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports[0]).toMatchObject({ name: "Jesse Gauntt", authorization: "Bearer saved-session" });

  await page.evaluate(() => localStorage.setItem("yehry3:auth:submitter", JSON.stringify({ token: "expired-session", password: null })));
  state.reports.length = 0;
  await page.reload();
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports.map((report) => report.authorization)).toEqual(["Bearer expired-session", null]);
  expect(state.reports[1].name).toBeUndefined();
});

test("five quiet minutes read as idle, and the next touch of the mouse is online again", async ({ page }) => {
  await page.clock.install();
  const state = await studio(page);
  await page.goto("/queue/");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports.at(-1).idle).toBe(false);
  await page.clock.fastForward("05:30");
  await expect.poll(() => state.reports.at(-1).idle).toBe(true);
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await expect.poll(() => state.reports.at(-1).idle).toBe(false);
});

test("on a phone the seats tuck into the edge without widening the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await studio(page);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  const tucked = await named.locator(".room-avatar").boundingBox();
  expect(Math.min(tucked.x, 390 - (tucked.x + tucked.width))).toBeLessThan(0);
  await named.locator(".room-avatar").click();
  await expect(named.locator(".room-card")).toBeVisible();
  const card = await named.locator(".room-card").boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(named).not.toHaveClass(/is-open/);
});
