// The listening room: everyone on the site right now sits at the edges of the screen with what
// they are playing. Each tab reports its own song with a heartbeat and is sent the room over a
// WebSocket, or reads it with a long poll where a socket cannot be held open, so a change shows up
// within a second or two. Anyone may give themselves a name, from their own card here or from the
// "Authored by" field on Make a request (the two are one saved name); until they do, they are the
// animal the studio assigns them. The studio numbers a name someone else already has: "Jesse (2)".
// Each face also says what screen it is on, what its owner is doing besides listening (drafting a song,
// reading lyrics), and, when a card is open, how far into the song they are.
import { api, signedIn } from "./api.js";
import { API_BASE } from "./config.js";
import { savedAuthor, rememberAuthor, onAuthorChange } from "./authored-by.js";

const tab = crypto.randomUUID();
const hiddenKey = "yehry3:listeners-hidden";
const SETTLE_MS = 600; // Skipping a track or swapping sides pauses for a moment; report once it settles.
const PEEK_MS = 6000;
const TOAST_MS = 4000; // On a phone a changed song steps out like a toast and goes back.
const IDLE_MS = 5 * 60000; // No mouse, key, touch or scroll for this long reads as idle.
const SOCKET_URL = `${API_BASE.replace(/^http/, "ws")}/listeners/socket`;
const SOCKET_GRACE_MS = 3000; // A socket this slow to deliver has the long poll started beside it.
const SOCKET_REST_MS = 10 * 60000; // A network that will not carry a socket is not asked again for this long.
const STATUS_MS = 2000; // How often the screen and what is being done are looked at; a report follows only a change.
const SEEK_MS = 1200; // A seek is reported once the scrubbing settles, and only matters to the studio when it is far.
const players = new Map();
let beatMs = 25000, you = null, room = [], total = 0, version = "", started = false;
let beatTimer, settleTimer, reporting = false, again = false, lastSong = null, nameRestUntil = 0;
let polling = false, pollFailures = 0, socket = null, live = false, socketFailures = 0, socketRestUntil = 0, followTimer, root, openId = null, lastInput = Date.now(), reportedIdle = false;
// The avatars a signed-in listener may choose from, whether the chooser is open, and a choice waiting to be sent.
let avatars = [], picking = false, chosen;
// The name being typed into your own card, and a redraw held back until it is done so typing is not interrupted.
let editingName = false, nameDraft = "", nameTimer, redrawLater = false;
const peeks = new Map();
let reportedStatus = "", seekTimer, ticks = 0;

// The screen a listener is on, from what is under their fingers and how big the screen is. Pure, so it can be tested.
export function deviceKind({ coarse, shortSide, longSide, width }) {
  if (coarse) return shortSide < 600 ? "phone" : "tablet";
  return longSide < 1280 || width < 800 ? "small" : "desktop";
}
const device = () => deviceKind({
  coarse: matchMedia("(pointer: coarse)").matches,
  shortSide: Math.min(screen.width, screen.height),
  longSide: Math.max(screen.width, screen.height),
  width: innerWidth,
});
const DEVICE_LABELS = { phone: "On a phone", tablet: "On a tablet", small: "On a small screen", desktop: "On a desktop" };
const ACTIVITY_LABELS = { drafting: "Drafting a song", lyrics: "Viewing song lyrics" };
// What this page says its visitor is doing, read from the page itself so no page has to report it.
const activityNow = () => {
  const page = document.body?.dataset.page;
  if (page === "lyrics") return "lyrics";
  if (page === "requests" && (document.querySelector("#details-form, #confirm-form") || document.querySelector("#idea")?.value.trim())) return "drafting";
  return null;
};
const statusNow = () => `${device()}|${idleNow() ? "" : activityNow() || ""}`;
// Small line icons, drawn in the text colour.
const ICONS = {
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.3h2"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M11 18.3h2"/>',
  small: '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M1.5 19.5h21"/>',
  desktop: '<rect x="2.5" y="3.5" width="19" height="12.5" rx="1.5"/><path d="M8.5 20.5h7M12 16v4.5"/>',
  drafting: '<path d="M4 20l1-4.2L16.6 4.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19z"/><path d="M14.5 6.3l3.2 3.2"/>',
  lyrics: '<path d="M6 3h9l4 4v14H6z"/><path d="M14.5 3v4.5H19M9 12h7M9 15.5h7M9 19h4"/>',
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "room-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = ICONS[name];
  return svg;
}
export const clock = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds)), h = Math.floor(whole / 3600), m = Math.floor(whole % 3600 / 60), s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const phone = () => matchMedia("(max-width: 700px)").matches;
const invisible = () => {
  try { return localStorage.getItem(hiddenKey) === "true"; } catch { return false; }
};
const playingEntry = () => {
  let song = null, element = null;
  for (const [audio, entry] of players)
    if (!audio.paused && !audio.ended && !audio.error && entry.songId && (!song || entry.at > song.at)) { song = entry; element = audio; }
  return song ? { songId: song.songId, audio: element } : null;
};
const playingSong = () => playingEntry()?.songId || null;
// Playing a song is listening, however still the mouse; otherwise a background tab or five quiet minutes is idle.
const idleNow = () => !playingSong() && (document.hidden || Date.now() - lastInput >= IDLE_MS);
// Someone reading the page or playing a song is here; a silent background tab is not.
const active = () => !document.hidden || Boolean(playingSong());

// Pages call this whenever an audio element is given a song; play and pause are watched from here.
export function nowListening(audio, songId) {
  if (!(audio instanceof HTMLMediaElement)) return;
  const known = players.get(audio);
  players.set(audio, { songId: /^[a-z0-9-]{1,120}$/.test(songId || "") ? songId : null, at: performance.now() });
  if (!known)
    for (const event of ["playing", "pause", "ended", "emptied", "error", "seeked"])
      audio.addEventListener(event, () => {
        if (event === "playing") players.get(audio).at = performance.now();
        if (event === "seeked") return reseek();
        settle();
      });
  settle();
}
// A seek moves the place the studio has for a song, so it is told once the scrubbing has stopped.
function reseek() {
  if (!started) return;
  clearTimeout(seekTimer);
  seekTimer = setTimeout(() => { if (playingSong()) void report(true); }, SEEK_MS);
}
function settle() {
  if (!started) return;
  clearTimeout(settleTimer);
  // A song that stops in a background tab still gets its last word before the tab goes quiet.
  settleTimer = setTimeout(() => { if (playingSong() !== lastSong) void report(true); }, SETTLE_MS);
}

// Pure, so the seating can be tested: you first, a steady side for everyone else, and a bounded column.
export function seats(listeners, selfId, perSide) {
  const self = listeners.find((listener) => listener.id === selfId);
  const sides = { left: self ? [self] : [], right: [] };
  let more = 0;
  for (const listener of listeners) {
    if (listener === self) continue;
    const preferred = parseInt(listener.id.slice(-2), 16) % 2 ? "right" : "left", other = preferred === "left" ? "right" : "left";
    if (sides[preferred].length < perSide) sides[preferred].push(listener);
    else if (sides[other].length < perSide) sides[other].push(listener);
    else more++;
  }
  return { ...sides, more };
}
export const initials = (name) => {
  // The studio's "(2)" for a repeated name is not part of the name.
  const words = String(name).replace(/\s*\(\d+\)$/u, "").trim().split(/\s+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)].map((word) => [...word][0]) : [...(words[0] || "?")].slice(0, 2);
  return letters.join("").toUpperCase();
};

function face(listener) {
  const span = document.createElement("span");
  span.className = "room-face";
  span.textContent = listener.anonymous || listener.picked ? listener.emoji : initials(listener.name);
  return span;
}
function seat(listener) {
  const self = !invisible() && listener.id === you?.id;
  const item = document.createElement("li");
  item.className = "room-seat";
  item.dataset.id = listener.id;
  item.classList.toggle("is-listening", Boolean(listener.song));
  item.classList.toggle("is-initials", !listener.anonymous && !listener.picked);
  item.classList.toggle("is-you", self);
  item.classList.toggle("is-idle", Boolean(listener.idle));
  item.classList.toggle("is-open", openId === listener.id);
  item.classList.toggle("is-picking", self && picking);
  const peek = peeks.get(listener.id);
  // A changed song gives the face a start; its card steps out as well unless the change was your own doing.
  item.classList.toggle("is-changed", Boolean(peek));
  item.classList.toggle("is-peeking", Boolean(peek) && !peek.quiet);
  item.style.setProperty("--room-hue", String(listener.hue));
  // Seats are redrawn whole, so the nod and bob are told the time, and a toast how far along it already is, rather than starting over.
  item.style.setProperty("--room-clock", `${-(Date.now() % 60000)}ms`);
  if (peek) {
    item.style.setProperty("--room-peek-ms", `${peek.ms}ms`);
    item.style.setProperty("--room-peek-at", `${peek.at - Date.now()}ms`);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "room-avatar";
  button.setAttribute("aria-expanded", String(openId === listener.id));
  const kind = DEVICE_LABELS[listener.device] ? listener.device : null, doing = ACTIVITY_LABELS[listener.activity] ? listener.activity : null;
  button.setAttribute("aria-label", `${listener.name}${self ? " (you)" : ""}: ${listener.song ? `listening to ${listener.song.title}` : listener.idle ? "idle" : "online"}${doing ? `, ${ACTIVITY_LABELS[doing].toLowerCase()}` : ""}${kind ? `, ${DEVICE_LABELS[kind].toLowerCase()}` : ""}`);
  button.append(face(listener));
  // Two small badges on the face: what they are doing (top left) and the screen they are on (bottom left).
  for (const [name, className] of [[doing, "room-badge room-doing"], [kind, "room-badge room-device"]]) {
    if (!name) continue;
    const badge = document.createElement("span");
    badge.className = className;
    badge.dataset.kind = name;
    badge.append(icon(name));
    button.append(badge);
  }
  const card = document.createElement("div");
  card.className = "room-card";
  const name = document.createElement("strong");
  name.textContent = listener.name;
  card.append(name);
  if (self) {
    const tag = document.createElement("span");
    tag.className = "room-you";
    tag.textContent = "you";
    card.append(" ", tag);
  }
  const line = document.createElement("span");
  line.className = "room-song";
  if (listener.song) {
    const link = document.createElement("a");
    link.href = `/#${encodeURIComponent(listener.song.id)}`;
    link.textContent = listener.song.title;
    line.append("♪ ", link);
  } else line.textContent = listener.idle ? "Idle" : "Online";
  card.append(line);
  const place = progressText(listener);
  if (place) {
    const progress = document.createElement("span");
    progress.className = "room-progress";
    progress.dataset.id = listener.id;
    progress.textContent = place;
    card.append(progress);
  }
  for (const [name, label, className] of [[doing, ACTIVITY_LABELS[doing], "room-doing-line"], [kind, DEVICE_LABELS[kind], "room-device-line"]]) {
    if (!name) continue;
    const row = document.createElement("span");
    row.className = `room-meta ${className}`;
    row.append(icon(name), label);
    card.append(row);
  }
  if (self) card.append(selfNote());
  item.append(button, card);
  return item;
}
// How far into the song someone is: their own browser knows exactly; anyone else's is the studio's last word counted on
// second by second, until a correction arrives.
function progressText(listener) {
  if (!listener.song) return "";
  const mine = listener.id === you?.id && !invisible() ? playingEntry() : null;
  if (mine?.songId === listener.song.id && Number.isFinite(mine.audio.currentTime)) {
    const length = Number.isFinite(mine.audio.duration) ? mine.audio.duration : listener.progress?.duration;
    return `${clock(mine.audio.currentTime)}${length ? ` / ${clock(length)}` : ""}`;
  }
  const place = listener.progress;
  if (!place) return "";
  const seconds = place.position + (Date.now() - (place.received || Date.now()) + place.age) / 1000;
  return `${clock(place.duration ? Math.min(seconds, place.duration) : seconds)}${place.duration ? ` / ${clock(place.duration)}` : ""}`;
}
function tick() {
  if (!root || document.hidden) return;
  for (const element of root.querySelectorAll(".room-progress")) {
    const text = progressText(room.find((listener) => listener.id === element.dataset.id) || {});
    if (text && element.textContent !== text) element.textContent = text;
  }
  // The screen or the page's doings may have changed without a song or a name to say so.
  if (++ticks % (STATUS_MS / 1000) === 0 && started && !invisible() && you && statusNow() !== reportedStatus) void report(true);
}
function selfNote() {
  const note = document.createElement("span");
  note.className = "room-note";
  note.textContent = you?.anonymous ? "This is your animal. Give yourself a name to appear by it. " : "This is how everyone sees you. ";
  if (editingName) note.append(nameForm());
  else {
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "room-toggle";
    rename.dataset.roomName = "true";
    rename.textContent = savedAuthor().trim() ? "Change name" : "Set a name";
    note.append(rename, " ");
  }
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "room-toggle";
  hide.dataset.roomHide = "true";
  hide.textContent = "Hide me";
  note.append(hide);
  // The studio sends the avatars on offer only to a signed-in browser.
  if (avatars.length) {
    const change = document.createElement("button");
    change.type = "button";
    change.className = "room-toggle";
    change.dataset.roomPick = "true";
    change.setAttribute("aria-expanded", String(picking));
    change.textContent = picking ? "Done" : "Change avatar";
    note.append(" ", change);
    if (picking) note.append(picker());
  }
  return note;
}
// The same saved name as the "Authored by" field on Make a request, so a change in either shows in both.
function nameForm() {
  const form = document.createElement("form");
  form.className = "room-name";
  form.dataset.roomNameForm = "true";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "room-name-input";
  input.maxLength = 100;
  input.autocomplete = "nickname";
  input.placeholder = "Your name";
  input.value = nameDraft;
  input.setAttribute("aria-label", "Your name");
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "room-toggle";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "room-toggle";
  cancel.dataset.roomNameCancel = "true";
  cancel.textContent = "Cancel";
  const help = document.createElement("span");
  help.className = "room-name-help";
  help.textContent = "Also shown as “Authored by” on your requests. If someone else has the name, you appear as “Name (2)”. Leave it empty to go back to your animal.";
  form.append(input, " ", save, " ", cancel, help);
  return form;
}
function startEditingName() {
  editingName = true;
  picking = false;
  nameDraft = savedAuthor().trim();
  if (you) openId = you.id;
  render();
  queueMicrotask(() => root.querySelector(".room-name-input")?.focus({ preventScroll: true }));
}
function stopEditingName() {
  editingName = false;
  if (redrawLater) { redrawLater = false; render(); }
  else if (root) render();
}
function saveName() {
  rememberAuthor(nameDraft.trim().slice(0, 100));
  // The name is sent at once, and the card shows what the studio makes of it as soon as it answers.
  clearTimeout(nameTimer);
  editingName = false;
  redrawLater = false;
  void report(true);
  render();
}
function picker() {
  const grid = document.createElement("span");
  grid.className = "room-picker";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Choose an avatar");
  for (const emoji of avatars) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "room-option";
    option.dataset.roomAvatar = emoji;
    option.setAttribute("aria-pressed", String(Boolean(you?.picked) && you.emoji === emoji));
    option.textContent = emoji;
    grid.append(option);
  }
  if (you?.picked) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "room-toggle room-reset";
    reset.dataset.roomAvatar = "";
    reset.textContent = you.anonymous ? "Use my animal" : "Use my initials";
    grid.append(reset);
  }
  return grid;
}
// The new face is drawn at once and sent with the next report, which is made straight away.
function choose(emoji) {
  chosen = emoji || null;
  picking = false;
  if (chosen) for (const entry of [you, room.find((listener) => listener.id === you?.id)]) if (entry) Object.assign(entry, { emoji: chosen, picked: true });
  void report(true);
  render();
}
// Two neighbours can show a card at once: both peeking, one open beside a peek, a hover or focus, or every
// card at once on a wide screen. A card's height depends on what it says, so no fixed seat spacing stays
// enough forever; nudge the lower seat down instead, just far enough that its card clears the one above it.
// CSS alone decides which cards are showing (hover, focus, open, peek, a wide screen), so that is asked
// directly rather than guessed at again from state this script would have to keep in step with the stylesheet.
const CARD_CLEARANCE = 10;
function spaceCards(list) {
  let prevBottom = null;
  for (const seat of list.children) {
    if (!seat.classList?.contains("room-seat")) { prevBottom = null; continue; }
    const card = seat.querySelector(".room-card");
    if (getComputedStyle(card).visibility !== "visible") { prevBottom = null; continue; }
    const rect = card.getBoundingClientRect();
    let bottom = rect.bottom;
    if (prevBottom !== null && rect.top < prevBottom + CARD_CLEARANCE) {
      const shift = prevBottom + CARD_CLEARANCE - rect.top;
      seat.style.marginTop = `${shift}px`;
      bottom += shift;
    }
    prevBottom = bottom;
  }
}
function render() {
  if (!root) return;
  // Every heartbeat and poll redraws the seats whole, which would take the field away mid-word.
  if (editingName && document.activeElement?.matches?.(".room-name-input")) { redrawLater = true; return; }
  const narrow = phone();
  // Once hidden, a seat with your name can only be another of your browsers, so it is drawn like anyone else.
  const { left, right, more } = seats(room, invisible() ? null : you?.id, narrow ? 3 : 6);
  const extra = more + Math.max(0, total - room.length);
  // Seats are redrawn whole, so keyboard focus is handed to the same person's new seat.
  const focused = root.contains(document.activeElement) ? document.activeElement.closest(".room-seat")?.dataset.id : null;
  queueMicrotask(() => { if (focused) root.querySelector(`.room-seat[data-id="${focused}"] .room-avatar`)?.focus({ preventScroll: true }); });
  // Spacing a card against its neighbour needs real layout, so the room must already be shown (not [hidden])
  // before any seat is measured — including on the very first render, not just later ones.
  const ghost = root.querySelector(".room-ghost");
  ghost.hidden = !invisible();
  root.hidden = !left.length && !right.length && !invisible();
  for (const [side, listeners] of [["left", left], ["right", right]]) {
    const list = root.querySelector(`.room-${side}`);
    list.replaceChildren(...listeners.map(seat));
    if (side === "right" && extra) {
      const chip = document.createElement("li");
      chip.className = "room-more";
      chip.textContent = `+${extra}`;
      chip.title = `${extra} more ${extra === 1 ? "listener" : "listeners"}`;
      list.append(chip);
    }
    spaceCards(list);
  }
}
function accept(data) {
  if (!Array.isArray(data?.listeners)) return;
  if (Number.isFinite(data.beatMs)) beatMs = Math.min(120000, Math.max(10000, data.beatMs));
  const before = new Map(room.map((listener) => [listener.id, listener.song?.id || null]));
  const known = Boolean(version);
  room = data.listeners.filter((listener) => /^[0-9a-f]{16}$/.test(listener?.id || "") && typeof listener.name === "string");
  total = Number.isFinite(data.total) ? data.total : room.length;
  version = typeof data.version === "string" ? data.version : "";
  const received = Date.now();
  for (const listener of room) if (listener.progress) listener.progress.received = received;
  // A new song, or a new arrival with one, shows its card for a moment without being asked.
  const ms = phone() ? TOAST_MS : PEEK_MS;
  for (const listener of room) {
    if (!known || !listener.song || before.get(listener.id) === listener.song.id) continue;
    // Your own song is news only on a phone, where no card stays in view, or when another of your browsers chose it.
    const quiet = listener.id === you?.id && ms === PEEK_MS && listener.song.id === playingSong();
    clearTimeout(peeks.get(listener.id)?.timer);
    peeks.set(listener.id, { at: Date.now(), ms, quiet, timer: setTimeout(() => { peeks.delete(listener.id); render(); }, ms) });
  }
  render();
}

async function report(force = false) {
  if (!started || invisible() || (force !== true && !active())) return;
  if (reporting) { again = true; return; }
  reporting = true;
  clearTimeout(beatTimer);
  const entry = playingEntry(), songId = entry?.songId || null, idle = idleNow();
  const doing = idle ? null : activityNow();
  const status = { device: device(), ...(doing ? { activity: doing } : {}), ...(songId && Number.isFinite(entry.audio.currentTime) ? { position: entry.audio.currentTime, ...(Number.isFinite(entry.audio.duration) ? { duration: entry.audio.duration } : {}) } : {}) };
  // A submitter session outlives an admin one, so it is the one to present when both exist.
  const role = Date.now() < nameRestUntil ? null : signedIn("submitter") ? "submitter" : signedIn("admin") ? "admin" : null;
  // A name needs no sign-in; a session is only for choosing an avatar.
  const name = savedAuthor().trim().slice(0, 100);
  const avatar = role ? chosen : undefined;
  try {
    let data;
    try {
      data = await api("/listeners", { method: "POST", body: { tab, songId, idle, ...status, ...(name ? { name } : {}), ...(avatar !== undefined ? { avatar } : {}) }, ...(role ? { role } : {}) });
    } catch (error) {
      if (!role || ![401, 403, 503].includes(error.status)) throw error;
      // A session that cannot be restored must not keep this listener out of the room, or retry a sign-in every beat.
      nameRestUntil = Date.now() + 10 * 60000;
      data = await api("/listeners", { method: "POST", body: { tab, songId, idle, ...status, ...(name ? { name } : {}) } });
    }
    lastSong = songId;
    reportedIdle = idle;
    reportedStatus = `${status.device}|${doing || ""}`;
    you = data.you || null;
    if (chosen === avatar) chosen = undefined;
    avatars = Array.isArray(data.avatars) ? data.avatars.filter((emoji) => typeof emoji === "string" && emoji.length <= 8) : [];
    if (!avatars.length) picking = false;
    accept(data);
    follow();
  } catch (error) {
    // The room is decoration: the next beat tries again and nothing else on the page waits for it.
    if (error?.status === 400) chosen = undefined; // An avatar the studio no longer offers is not sent again.
  }
  finally {
    reporting = false;
    beatTimer = setTimeout(report, beatMs);
    if (again) { again = false; void report(true); }
  }
}
// The room arrives over a socket where one can be held open, and by long poll until then and everywhere else.
function follow() {
  if (!started || document.hidden || live) return;
  if (!socket && typeof WebSocket === "function" && Date.now() >= socketRestUntil) connect();
  if (!socket) void poll();
}
function connect() {
  let line;
  try { line = new WebSocket(SOCKET_URL); } catch { socketRestUntil = Date.now() + SOCKET_REST_MS; return; }
  socket = line;
  let fed = false;
  // A socket is given a moment to deliver before the long poll is started beside it.
  const grace = setTimeout(() => { if (socket === line && !live) void poll(); }, SOCKET_GRACE_MS);
  line.addEventListener("message", (event) => {
    if (socket !== line) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    fed = live = true;
    socketFailures = 0;
    accept(data);
  });
  line.addEventListener("close", () => {
    clearTimeout(grace);
    if (socket !== line) return;
    socket = null;
    live = false;
    // A socket that never delivered is a network that will not carry one: after three, the long poll has the
    // room to itself for a while. One that did is a restart, and every browser is not brought back in the same instant.
    const rest = fed ? 1000 + Math.random() * 2000 : ++socketFailures >= 3 ? SOCKET_REST_MS : 2000 * 2 ** socketFailures;
    if (socketFailures >= 3) socketFailures = 0;
    socketRestUntil = Date.now() + rest;
    clearTimeout(followTimer);
    followTimer = setTimeout(follow, rest + 50);
    void poll();
  });
}
// A page in the background, or on its way out, gives its socket back.
function hangUp() {
  clearTimeout(followTimer);
  const line = socket;
  socket = null;
  live = false;
  line?.close();
}
async function poll() {
  if (polling || live || !started || document.hidden) return;
  polling = true;
  while (started && !document.hidden && !live) {
    const asked = version, began = Date.now();
    let wait = 0;
    try {
      const data = await api(`/listeners${asked ? `?since=${asked}` : ""}`, { anonymous: true, timeout: 35000 });
      pollFailures = 0;
      accept(data);
      // A server that answers an unchanged room early is full or restarting; do not spin on it.
      if (version === asked && Date.now() - began < 5000) wait = 5000;
    } catch (error) {
      pollFailures++;
      wait = error.status === 404 ? 300000 : Math.min(60000, 5000 * 2 ** Math.min(pollFailures - 1, 4));
    }
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  polling = false;
}
function leave() {
  clearTimeout(beatTimer);
  if (!you) return;
  void api(`/listeners/${tab}`, { method: "DELETE", keepalive: true }).catch(() => {});
}
function setInvisible(hidden) {
  try {
    if (hidden) localStorage.setItem(hiddenKey, "true");
    else localStorage.removeItem(hiddenKey);
  } catch { return; /* Without storage the choice could not last, so the room stays as it is. */ }
  openId = null;
  if (hidden) leave();
  else void report();
  render();
}

export function mountListeners() {
  if (started || !document.body) return;
  started = true;
  if (!document.querySelector('link[href="/assets/listeners.css"]')) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/listeners.css";
    document.head.append(css);
  }
  root = document.createElement("aside");
  root.className = "room";
  root.hidden = true;
  root.setAttribute("aria-label", "Listening now");
  root.innerHTML = '<ul class="room-side room-left"></ul><ul class="room-side room-right"></ul><button type="button" class="room-ghost" hidden title="Nobody can see you or what you play. Select to appear again.">👻 Hidden · Show me</button>';
  document.body.append(root);
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-room-hide]")) return setInvisible(true);
    if (event.target.closest("[data-room-name]")) return startEditingName();
    if (event.target.closest("[data-room-name-cancel]")) return stopEditingName();
    if (event.target.closest(".room-ghost")) return setInvisible(false);
    const option = event.target.closest("[data-room-avatar]");
    if (option) return choose(option.dataset.roomAvatar);
    if (event.target.closest("[data-room-pick]")) {
      picking = !picking;
      if (picking) editingName = false;
      if (you) openId = you.id;
      return render();
    }
    const button = event.target.closest(".room-avatar");
    if (!button) return;
    const id = button.closest(".room-seat").dataset.id;
    openId = openId === id ? null : id;
    picking = false;
    editingName = false;
    render();
  });
  root.addEventListener("input", (event) => { if (event.target.matches(".room-name-input")) nameDraft = event.target.value; });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.closest("[data-room-name-form]")) saveName();
  });
  document.addEventListener("click", (event) => {
    // The path, not the target: a seat that was just redrawn is no longer in the page to look up from.
    if (openId && !event.composedPath().includes(root)) { openId = null; picking = false; editingName = false; redrawLater = false; render(); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openId) { openId = null; picking = false; editingName = false; redrawLater = false; render(); }
  });
  matchMedia("(max-width: 700px)").addEventListener("change", render);
  // Going to the background says so once and then falls silent; coming back is reported straight away.
  document.addEventListener("visibilitychange", () => {
    lastInput = Date.now();
    void report(true);
    if (document.hidden) hangUp();
    else follow();
  });
  for (const event of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"])
    addEventListener(event, () => {
      lastInput = Date.now();
      if (reportedIdle && !document.hidden) { reportedIdle = false; void report(); }
    }, { passive: true, capture: true });
  addEventListener("storage", (event) => { if (event.key === hiddenKey || event.key === null) render(); });
  // A name typed in the "Authored by" field, or saved in another tab, is sent once the typing settles.
  onAuthorChange(() => {
    if (editingName) return;
    render();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => void report(true), 800);
  });
  setInterval(tick, 1000);
  addEventListener("pagehide", () => { leave(); hangUp(); });
  addEventListener("pageshow", (event) => { if (event.persisted) { void report(); follow(); } });
  if (invisible()) follow();
  else void report();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountListeners, { once: true });
  else mountListeners();
}
