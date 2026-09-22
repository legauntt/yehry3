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
// As many avatars as the studio offers, so the chooser is measured at its real size.
const avatars = ["🐇", "🦊", "🎸", "🎹", ...Array.from({ length: 72 }, (_, index) => String.fromCodePoint(0x1f400 + index)).filter((emoji) => !["🐇", "🦊"].includes(emoji)).slice(0, 68)];
const fox = { id: "cccccccccccccc02", name: "sleepy-fox", anonymous: true, emoji: "🦊", hue: 250, song: null, since: null, idle: true };
// Odd like Jesse's, so this listener lands right beside them on the same side.
const mia = { id: `${"d".repeat(14)}03`, name: "Mia Chen", anonymous: false, emoji: "🐸", hue: 90, song: null, since: null };

// A stand-in studio: reports are recorded, and a poll is held until the test changes the room.
async function studio(page, { reject = () => false, socket = false } = {}) {
  const state = { version: "1000000000000001", you: { ...you, picked: false }, listeners: [{ ...you, song: null, since: null }, jesse, fox], reports: [], left: [], present: true, polls: 0, socket, lines: [] };
  const body = () => ({ version: state.version, listeners: state.listeners.filter((listener) => state.present || listener.id !== you.id), total: state.listeners.length, beatMs: 25000 });
  await page.route("**/room-fixture.wav", (route) => route.fulfill({ body: wav(), contentType: "audio/wav" }));
  await page.route("**/yehry3/profiles?*", (route) => route.fulfill({ json: { profiles: [], total: 0 } }));
  await page.route("**/catalog-summary.json", (route) => route.fulfill({ json: { songs: songs.map(songSummary) } }));
  await page.route("**/yehry3/songs/summary", (route) => route.fulfill({ json: { songs: songs.map(songSummary), nextVoteAt: null } }));
  await page.route("**/yehry3/queue?*", (route) => route.fulfill({ json: queue }));
  await page.route("**/yehry3/listens", (route) => route.fulfill({ json: {} }));
  // Without `socket` the studio turns sockets away, as an old network would, and the page long polls.
  state.push = () => { for (const line of state.lines) line.send(JSON.stringify(body())); };
  await page.routeWebSocket("**/yehry3/listeners/socket", (line) => {
    if (!state.socket) return line.close({ code: 1013 });
    state.lines.push(line);
    line.send(JSON.stringify(body()));
  });
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
      // Like the studio, anyone's name is shown, and a report with none is the animal again.
      if (report.name !== (state.you.anonymous ? undefined : state.you.name)) {
        Object.assign(state.you, report.name ? { name: report.name, anonymous: false } : { name: you.name, anonymous: true });
        state.listeners = [{ ...state.listeners[0], name: state.you.name, anonymous: state.you.anonymous }, ...state.listeners.slice(1)];
        state.version = `30000000000000${String(state.reports.length).padStart(2, "0")}`;
      }
      // Like the studio, only a signed-in report is offered avatars or may choose one.
      if (report.authorization && report.avatar !== undefined) {
        Object.assign(state.you, { emoji: report.avatar || you.emoji, picked: Boolean(report.avatar) });
        state.listeners = [{ ...state.listeners[0], emoji: state.you.emoji, picked: state.you.picked }, ...state.listeners.slice(1)];
        state.version = `20000000000000${String(state.reports.length).padStart(2, "0")}`;
      }
      return route.fulfill({ json: { you: state.you, ...(report.authorization ? { avatars } : {}), ...body() } });
    }
    state.polls++;
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
  await expect(mine.locator(".room-note")).toContainText("Give yourself a name");
  await expect(mine.getByRole("button", { name: "Set a name" })).toBeVisible();
  await expect(mine.getByRole("button", { name: "Change avatar" })).toHaveCount(0);
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

test("a signed-in browser sends its saved name, and a refused session still joins under it", async ({ page }) => {
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
  expect(state.reports[1].name).toBe("Jesse Gauntt");
});

test("a browser that is not signed in sends its saved name too", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yehry3:authored-by", "Just Visiting"));
  const state = await studio(page);
  await page.goto("/queue/");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports[0]).toMatchObject({ name: "Just Visiting", authorization: null });
});

test("your own card sets the name, which is the same name as Authored by", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/queue/");
  // Stand-in for the request form's field: it saves what is typed, as the form does.
  await page.evaluate(async () => {
    const { rememberAuthor, savedAuthor } = await import("/assets/authored-by.js");
    const field = document.createElement("input");
    field.id = "authored-by";
    field.value = savedAuthor();
    field.oninput = (event) => rememberAuthor(event.target.value);
    document.body.append(field);
  });
  const mine = page.locator(".room-seat.is-you");
  const field = page.locator("#authored-by");
  await mine.locator(".room-avatar").click();
  await mine.getByRole("button", { name: "Set a name" }).click();
  await expect(mine.locator(".room-name-input")).toBeFocused();
  // Nothing is sent, and nothing leaves the card, until it is saved; a heartbeat does not interrupt typing.
  await mine.locator(".room-name-input").fill("Jesse");
  state.version = "1000000000000042";
  await page.waitForTimeout(400);
  await expect(mine.locator(".room-name-input")).toHaveValue("Jesse");
  expect(state.reports.every((report) => report.name === undefined)).toBe(true);
  await mine.locator(".room-name-input").press("Enter");
  await expect.poll(() => state.reports.at(-1).name).toBe("Jesse");
  expect(state.reports.at(-1).authorization).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("yehry3:authored-by"))).toBe("Jesse");
  await expect(field).toHaveValue("Jesse");
  await expect(mine.locator("strong")).toHaveText("Jesse");
  await expect(mine.locator(".room-face")).toHaveText("JE");
  await expect(mine.locator(".room-note")).toContainText("This is how everyone sees you");

  // Typing in the form's field renames the card, once the typing has settled.
  await field.fill("Jesse G");
  await expect(mine.locator("strong")).toHaveText("Jesse G");
  await expect.poll(() => state.reports.at(-1).name).toBe("Jesse G");

  // Emptying it goes back to the animal; Escape and Cancel change nothing.
  await mine.locator(".room-avatar").click();
  await mine.getByRole("button", { name: "Change name" }).click();
  await expect(mine.locator(".room-name-input")).toHaveValue("Jesse G");
  await mine.locator(".room-name-input").fill("");
  await mine.getByRole("button", { name: "Cancel" }).click();
  await expect(mine.getByRole("button", { name: "Change name" })).toBeVisible();
  await expect(field).toHaveValue("Jesse G");
  await mine.getByRole("button", { name: "Change name" }).click();
  await mine.locator(".room-name-input").fill("");
  await mine.locator(".room-name-input").press("Enter");
  await expect(field).toHaveValue("");
  await expect(mine.locator("strong")).toHaveText("happy-rabbit");
  await expect(mine.getByRole("button", { name: "Set a name" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("yehry3:authored-by"))).toBeNull();
});

test("a name given in another tab reaches this card", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/queue/");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  // The storage event is what another tab's save looks like from here.
  await page.evaluate(() => {
    localStorage.setItem("yehry3:authored-by", "From Elsewhere");
    dispatchEvent(new StorageEvent("storage", { key: "yehry3:authored-by", newValue: "From Elsewhere" }));
  });
  await expect.poll(() => state.reports.at(-1).name, { timeout: 4000 }).toBe("From Elsewhere");
  await expect(page.locator(".room-seat.is-you strong")).toHaveText("From Elsewhere");
});

test("a signed-in listener chooses an avatar and can give it back", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yehry3:auth:submitter", JSON.stringify({ token: "saved-session", password: null })));
  const state = await studio(page);
  await page.goto("/queue/");
  const mine = page.locator(".room-seat.is-you");
  await mine.locator(".room-avatar").click();
  await mine.getByRole("button", { name: "Change avatar" }).click();
  await expect(mine.locator(".room-option")).toHaveCount(72);
  // A wide window shows every avatar at once: nothing to scroll, either way.
  const fits = () => mine.locator(".room-picker").evaluate((grid) => ({ across: grid.scrollWidth <= grid.clientWidth, down: grid.scrollHeight <= grid.clientHeight, columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length }));
  expect(await fits()).toEqual({ across: true, down: true, columns: 12 });
  // A phone scrolls down through them and never sideways, inside the screen.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(async () => (await fits()).columns).toBe(8);
  expect(await fits()).toMatchObject({ across: true, down: false });
  const chooser = await mine.locator(".room-card").boundingBox();
  expect(chooser.x).toBeGreaterThanOrEqual(0);
  expect(chooser.x + chooser.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mine.getByRole("button", { name: "🎸" }).click();
  await expect(mine.locator(".room-face")).toHaveText("🎸");
  await expect.poll(() => state.reports.at(-1).avatar).toBe("🎸");
  expect(state.reports.at(-1).authorization).toBe("Bearer saved-session");
  // The card stays open after a choice, and the choice is sent once rather than with every report.
  await mine.getByRole("button", { name: "Change avatar" }).click();
  await expect(mine.getByRole("button", { name: "🎸" })).toHaveAttribute("aria-pressed", "true");
  await mine.getByRole("button", { name: "Use my animal" }).click();
  await expect.poll(() => state.reports.at(-1).avatar).toBe(null);
  await expect(mine.locator(".room-face")).toHaveText("🐇");
  expect(state.reports.filter((report) => report.avatar !== undefined)).toHaveLength(2);

  // A named listener who chose an avatar wears it in place of their initials.
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  await expect(named).toHaveClass(/is-initials/);
  state.listeners = [state.listeners[0], { ...jesse, emoji: "🎹", picked: true }, fox];
  state.version = "1000000000000005";
  await expect(named.locator(".room-face")).toHaveText("🎹");
  await expect(named).not.toHaveClass(/is-initials/);
});

test("the room arrives over a socket, and the long poll takes over when the socket goes", async ({ page }) => {
  const state = await studio(page, { socket: true });
  await page.goto("/queue/");
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: listening to First in the room");
  await expect.poll(() => state.lines.length).toBe(1);
  // A pushed room is drawn at once, with no poll behind it.
  state.listeners = [state.listeners[0], { ...jesse, song: { id: "room-second", title: "Second in the room" } }, fox];
  state.version = "1000000000000002";
  state.push();
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: listening to Second in the room", { timeout: 2000 });
  await expect(named).toHaveClass(/is-peeking/);
  await page.waitForTimeout(3500);
  expect(state.polls).toBe(0);

  // The studio restarts and will not take sockets for now: the long poll carries the next change.
  state.socket = false;
  for (const line of state.lines.splice(0)) await line.close({ code: 1012 });
  await expect.poll(() => state.polls, { timeout: 5000 }).toBeGreaterThan(0);
  state.listeners = [state.listeners[0], { ...jesse, song: null, since: null }, fox];
  state.version = "1000000000000003";
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: online", { timeout: 8000 });
  // When sockets are back the page returns to one and stops polling.
  state.socket = true;
  await expect.poll(() => state.lines.length, { timeout: 8000 }).toBe(1);
  state.listeners = [state.listeners[0], jesse, fox];
  state.version = "1000000000000004";
  state.push();
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: listening to First in the room", { timeout: 2000 });
});

test("two seats that peek at once, side by side, do not crowd each other's card", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  // A fourth listener lands beside Jesse, on the same side.
  state.listeners = [state.listeners[0], jesse, mia, fox];
  state.version = "1000000000000010";
  await expect(page.locator(".room-seat")).toHaveCount(4);
  const jesseSeat = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  const miaSeat = page.locator(`.room-seat[data-id="${mia.id}"]`);
  await expect(jesseSeat).toHaveCount(1);
  await expect(miaSeat).toHaveCount(1);
  // Both change song in the same beat, so both cards step out unasked, right beside one another.
  state.listeners = [
    state.listeners[0],
    { ...jesse, song: { id: "room-second", title: "Second <in> the room" }, activity: "drafting", device: "phone", progress: { position: 40, duration: 200, age: 0 } },
    { ...mia, song: { id: "room-first", title: "First in the room" }, activity: "lyrics", device: "desktop", progress: { position: 10, duration: 260, age: 0 } },
    fox,
  ];
  state.version = "1000000000000011";
  await expect(jesseSeat).toHaveClass(/is-peeking/, { timeout: 8000 });
  await expect(miaSeat).toHaveClass(/is-peeking/, { timeout: 8000 });
  const jesseBox = await jesseSeat.locator(".room-card").boundingBox();
  const miaBox = await miaSeat.locator(".room-card").boundingBox();
  const [upper, lower] = jesseBox.y <= miaBox.y ? [jesseBox, miaBox] : [miaBox, jesseBox];
  expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.height - 1);
});

test("on a wide screen every card stays visible, and neighbours still do not crowd", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = await studio(page);
  // Two tall, adjacent cards, with nobody hovering or clicking anything.
  state.listeners = [
    state.listeners[0],
    { ...jesse, activity: "drafting", device: "phone", progress: { position: 40, duration: 200, age: 0 } },
    { ...mia, song: { id: "room-first", title: "First in the room" }, activity: "lyrics", device: "desktop", progress: { position: 10, duration: 260, age: 0 } },
    fox,
  ];
  await page.goto("/?sort=catalog");
  const jesseSeat = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  const miaSeat = page.locator(`.room-seat[data-id="${mia.id}"]`);
  await expect(jesseSeat.locator(".room-card")).toBeVisible();
  await expect(miaSeat.locator(".room-card")).toBeVisible();
  const jesseBox = await jesseSeat.locator(".room-card").boundingBox();
  const miaBox = await miaSeat.locator(".room-card").boundingBox();
  const [upper, lower] = jesseBox.y <= miaBox.y ? [jesseBox, miaBox] : [miaBox, jesseBox];
  expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.height - 1);
});

test("your own open card, with its note and buttons, still leaves room for the seat below", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = await studio(page);
  state.listeners = [state.listeners[0], jesse, { ...fox, idle: false, song: { id: "room-first", title: "First in the room" }, progress: { position: 30, duration: 260, age: 0 } }];
  await page.goto("/?sort=catalog");
  const mine = page.locator(".room-seat.is-you");
  const foxSeat = page.locator('.room-seat[data-id="cccccccccccccc02"]');
  await expect(foxSeat.locator(".room-card")).toBeVisible();
  await mine.locator(".room-avatar").click();
  await expect(mine.locator(".room-note")).toBeVisible();
  const mineBox = await mine.locator(".room-card").boundingBox();
  const foxBox = await foxSeat.locator(".room-card").boundingBox();
  const [upper, lower] = mineBox.y <= foxBox.y ? [mineBox, foxBox] : [foxBox, mineBox];
  expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.height - 1);
});

test("hovering a neighbour after opening your own card still spaces the two", async ({ page }) => {
  // No wide screen and no data change here: the neighbour's card shows by hover alone, with no render behind it.
  const state = await studio(page);
  state.listeners = [state.listeners[0], jesse, { ...fox, idle: false, song: { id: "room-first", title: "First in the room" }, progress: { position: 30, duration: 260, age: 0 } }];
  await page.goto("/?sort=catalog");
  const mine = page.locator(".room-seat.is-you");
  const foxSeat = page.locator('.room-seat[data-id="cccccccccccccc02"]');
  await mine.locator(".room-avatar").click();
  await expect(mine.locator(".room-note")).toBeVisible();
  await foxSeat.locator(".room-avatar").hover();
  await expect(foxSeat.locator(".room-card")).toBeVisible();
  const mineBox = await mine.locator(".room-card").boundingBox();
  const foxBox = await foxSeat.locator(".room-card").boundingBox();
  const [upper, lower] = mineBox.y <= foxBox.y ? [mineBox, foxBox] : [foxBox, mineBox];
  expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.height - 1);
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

test("on a phone the seats are small and whole at the edge, and a changed song steps out like a toast", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const state = await studio(page);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  // Every avatar is whole, and none reaches far into the page.
  for (const box of await page.locator(".room-avatar").evaluateAll((all) => all.map((avatar) => avatar.getBoundingClientRect().toJSON()))) {
    expect(Math.min(box.left, 390 - box.right)).toBeGreaterThanOrEqual(0);
    expect(Math.max(box.left, 390 - box.right)).toBeGreaterThan(390 - 40);
  }
  await named.locator(".room-avatar").click();
  await expect(named.locator(".room-card")).toBeVisible();
  const card = await named.locator(".room-card").boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(named).not.toHaveClass(/is-open/);

  // A changed song steps out by itself like a toast, on one line, and goes back within a few seconds.
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(200, 100);
  await expect(named.locator(".room-card")).toBeHidden();
  state.listeners = [state.listeners[0], { ...jesse, song: { id: "room-second", title: "Second in the room, with a title long enough to wrap twice on a phone" } }, fox];
  state.version = "1000000000000002";
  await expect(named).toHaveClass(/is-peeking/, { timeout: 8000 });
  const shown = Date.now();
  await expect(named.locator(".room-card")).toBeVisible();
  const toast = await named.locator(".room-card").boundingBox();
  expect(toast.x).toBeGreaterThanOrEqual(0);
  expect(toast.x + toast.width).toBeLessThanOrEqual(390);
  expect(toast.height).toBeLessThan(60);
  await expect(named).toHaveClass(/is-changed/);
  await expect(named).not.toHaveClass(/is-peeking/, { timeout: 5500 });
  expect(Date.now() - shown).toBeLessThan(5500);
  await expect(named.locator(".room-card")).toBeHidden();
  // No card stays in view on a phone, so your own song is announced the same way.
  state.listeners = [{ ...state.listeners[0], song: { id: "room-first", title: "First in the room" } }, ...state.listeners.slice(1)];
  state.version = "1000000000000003";
  await expect(page.locator(".room-seat.is-you")).toHaveClass(/is-peeking/, { timeout: 8000 });
});

// The screen each face reports comes from the pointer and the size of the screen.
for (const [kind, options] of [
  ["phone", { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }],
  ["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }],
  ["small", { viewport: { width: 1024, height: 700 } }],
  ["desktop", { viewport: { width: 1440, height: 900 } }],
]) test.describe(`on a ${kind}`, () => {
  test.use(options);
  test(`this browser reports itself as a ${kind}`, async ({ page }) => {
    const state = await studio(page);
    await page.goto("/queue/");
    await expect(page.locator(".room-seat")).toHaveCount(3);
    expect(state.reports[0].device).toBe(kind);
  });
});

test("each face shows the screen and what its owner is doing, as a badge and in words, and how far into the song they are", async ({ page }) => {
  const state = await studio(page);
  const busy = { ...jesse, device: "phone", activity: "drafting", progress: { position: 63, duration: 259, age: 0 } };
  state.listeners = [state.listeners[0], busy, { ...fox, device: "desktop", activity: "lyrics" }];
  await page.goto("/?sort=catalog");
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  await expect(named.locator(".room-device")).toHaveAttribute("data-kind", "phone");
  await expect(named.locator(".room-doing")).toHaveAttribute("data-kind", "drafting");
  await expect(named.locator(".room-avatar")).toHaveAttribute("aria-label", "Jesse Gauntt: listening to First in the room, drafting a song, on a phone");
  // Someone with nothing to report has no badges.
  await expect(page.locator(".room-left .room-seat").first().locator(".room-badge")).toHaveCount(0);
  await named.locator(".room-avatar").hover();
  await expect(named.locator(".room-card")).toContainText("On a phone");
  await expect(named.locator(".room-card")).toContainText("Drafting a song");
  // Their place is counted on second by second between reports, and never past the end.
  const place = named.locator(".room-progress");
  await expect(place).toHaveText(/^1:0[3-9] \/ 4:19$/);
  const first = await place.textContent();
  await expect.poll(() => place.textContent(), { timeout: 5000 }).not.toBe(first);
  // A correction (a seek, a stall) is taken at its word.
  state.listeners = [state.listeners[0], { ...busy, progress: { position: 190, duration: 259, age: 0 } }, state.listeners[2]];
  state.version = "1000000000000004";
  await expect(place).toHaveText(/^3:1\d \/ 4:19$/, { timeout: 8000 });
  state.listeners = [state.listeners[0], { ...busy, progress: { position: 258, duration: 259, age: 0 } }, state.listeners[2]];
  state.version = "1000000000000005";
  await expect(place).toHaveText(/^4:1[89] \/ 4:19$/, { timeout: 8000 });
  await page.waitForTimeout(2500);
  await expect(place).toHaveText("4:19 / 4:19");
  // Someone not listening has no place, and lyrics read as their own state.
  const reader = page.locator('.room-seat[data-id="cccccccccccccc02"]');
  await expect(reader.locator(".room-doing")).toHaveAttribute("data-kind", "lyrics");
  await reader.locator(".room-avatar").hover();
  await expect(reader.locator(".room-card")).toContainText("Viewing song lyrics");
  await expect(reader.locator(".room-card")).toContainText("On a desktop");
  await expect(reader.locator(".room-progress")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/avatar-states/desktop-card.png" });
});

test("your own report carries your place in the song, and a seek is reported again", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/?sort=catalog");
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports[0].position).toBeUndefined();
  await page.locator('.track[data-id="room-second"] [data-play]').click();
  await expect.poll(() => state.reports.at(-1).songId, { timeout: 8000 }).toBe("room-second");
  expect(state.reports.at(-1).position).toBeGreaterThanOrEqual(0);
  expect(state.reports.at(-1).duration).toBeCloseTo(4, 0);
  const reports = state.reports.length;
  await page.evaluate(() => { document.querySelector("audio").currentTime = 0; });
  await expect.poll(() => state.reports.length, { timeout: 5000 }).toBeGreaterThan(reports);
});

test("drafting a song and reading lyrics are noticed from the page, and stop when the page is left", async ({ page }) => {
  const state = await studio(page);
  await page.goto("/distonyc/");
  await page.locator("#password").fill("wishbone");
  await page.locator("#login-form button").click();
  await expect(page.locator(".room-seat")).toHaveCount(3);
  expect(state.reports.at(-1).activity).toBeUndefined();
  await page.locator("#idea").fill("A song about a very patient lighthouse keeper.");
  await expect.poll(() => state.reports.at(-1).activity, { timeout: 8000 }).toBe("drafting");
  // The site changes page without unloading; the doing goes with the page.
  await page.locator('a[href="/queue/"]').first().click();
  await expect(page).toHaveURL(/\/queue\/$/);
  await expect.poll(() => state.reports.at(-1).activity, { timeout: 8000 }).toBeUndefined();
  // A lyric sheet is the page for it, even one that is still to arrive.
  await page.goto("/lyrics/?song=room-first");
  await expect.poll(() => state.reports.at(-1).activity, { timeout: 8000 }).toBe("lyrics");
});

test("on a phone the badges stay on the face and a toast stays two short lines", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const state = await studio(page);
  state.listeners = [state.listeners[0], { ...jesse, device: "phone", activity: "lyrics", progress: { position: 63, duration: 259, age: 0 } }, fox];
  await page.goto("/?sort=catalog");
  const named = page.locator('.room-seat[data-id="bbbbbbbbbbbbbb01"]');
  await expect(named.locator(".room-badge")).toHaveCount(2);
  const avatar = await named.locator(".room-avatar").boundingBox();
  for (const badge of await named.locator(".room-badge").all()) {
    const box = await badge.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(16);
    expect(box.y).toBeGreaterThan(avatar.y - 8);
    expect(box.y + box.height).toBeLessThan(avatar.y + avatar.height + 8);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await named.locator(".room-avatar").click();
  await expect(named.locator(".room-progress")).toBeVisible();
  const card = await named.locator(".room-card").boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/avatar-states/phone-card.png" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(200, 100);
  state.listeners = [state.listeners[0], { ...jesse, device: "phone", activity: "lyrics", song: { id: "room-second", title: "Second in the room" }, progress: { position: 5, duration: 259, age: 0 } }, fox];
  state.version = "1000000000000007";
  await expect(named).toHaveClass(/is-peeking/, { timeout: 8000 });
  await expect(named.locator(".room-progress")).toBeHidden();
  await expect(named.locator(".room-device-line")).toBeHidden();
  expect((await named.locator(".room-card").boundingBox()).height).toBeLessThan(80);
});
