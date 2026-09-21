// The listening room: everyone on the site right now sits at the edges of the screen with what
// they are playing. Each tab reports its own song with a heartbeat and reads the room with a long
// poll, so a change shows up within a second or two. A signed-in browser is shown by its saved
// "Authored by" name; everyone else gets the animal the studio assigns them.
import { api, signedIn } from "./api.js";
import { savedAuthor } from "./authored-by.js";

const tab = crypto.randomUUID();
const hiddenKey = "yehry3:listeners-hidden";
const SETTLE_MS = 1500; // Skipping a track or swapping sides pauses for a moment; report once it settles.
const PEEK_MS = 6000;
const IDLE_MS = 5 * 60000; // No mouse, key, touch or scroll for this long reads as idle.
const players = new Map();
let beatMs = 25000, you = null, room = [], total = 0, version = "", started = false;
let beatTimer, settleTimer, reporting = false, again = false, lastSong = null, nameRestUntil = 0;
let polling = false, pollFailures = 0, root, openId = null, lastInput = Date.now(), reportedIdle = false;
const peeks = new Map();

const invisible = () => {
  try { return localStorage.getItem(hiddenKey) === "true"; } catch { return false; }
};
const playingSong = () => {
  let song = null;
  for (const [audio, entry] of players)
    if (!audio.paused && !audio.ended && !audio.error && entry.songId && (!song || entry.at > song.at)) song = entry;
  return song?.songId || null;
};
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
    for (const event of ["playing", "pause", "ended", "emptied", "error"])
      audio.addEventListener(event, () => { if (event === "playing") players.get(audio).at = performance.now(); settle(); });
  settle();
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
  const words = String(name).trim().split(/\s+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)].map((word) => [...word][0]) : [...(words[0] || "?")].slice(0, 2);
  return letters.join("").toUpperCase();
};

function face(listener) {
  const span = document.createElement("span");
  span.className = "room-face";
  span.textContent = listener.anonymous ? listener.emoji : initials(listener.name);
  return span;
}
function seat(listener) {
  const self = !invisible() && listener.id === you?.id;
  const item = document.createElement("li");
  item.className = "room-seat";
  item.dataset.id = listener.id;
  item.classList.toggle("is-listening", Boolean(listener.song));
  item.classList.toggle("is-named", !listener.anonymous);
  item.classList.toggle("is-you", self);
  item.classList.toggle("is-idle", Boolean(listener.idle));
  item.classList.toggle("is-open", openId === listener.id);
  item.classList.toggle("is-peeking", peeks.has(listener.id));
  item.style.setProperty("--room-hue", String(listener.hue));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "room-avatar";
  button.setAttribute("aria-expanded", String(openId === listener.id));
  button.setAttribute("aria-label", `${listener.name}${self ? " (you)" : ""}: ${listener.song ? `listening to ${listener.song.title}` : listener.idle ? "idle" : "online"}`);
  button.append(face(listener));
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
  if (self) card.append(selfNote());
  item.append(button, card);
  return item;
}
function selfNote() {
  const note = document.createElement("span");
  note.className = "room-note";
  const member = signedIn("submitter") || signedIn("admin");
  note.textContent = !you?.anonymous ? "This is how everyone sees you. "
    : member ? "Add an Authored by name on Make a request to appear by name. "
      : "Sign in on Make a request to appear by your name. ";
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "room-toggle";
  hide.dataset.roomHide = "true";
  hide.textContent = "Hide me";
  note.append(hide);
  return note;
}
function render() {
  if (!root) return;
  const narrow = matchMedia("(max-width: 700px)").matches;
  // Once hidden, a seat with your name can only be another of your browsers, so it is drawn like anyone else.
  const { left, right, more } = seats(room, invisible() ? null : you?.id, narrow ? 3 : 6);
  const extra = more + Math.max(0, total - room.length);
  // Seats are redrawn whole, so keyboard focus is handed to the same person's new seat.
  const focused = root.contains(document.activeElement) ? document.activeElement.closest(".room-seat")?.dataset.id : null;
  queueMicrotask(() => { if (focused) root.querySelector(`.room-seat[data-id="${focused}"] .room-avatar`)?.focus({ preventScroll: true }); });
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
  }
  const ghost = root.querySelector(".room-ghost");
  ghost.hidden = !invisible();
  root.hidden = !left.length && !right.length && !invisible();
}
function accept(data) {
  if (!Array.isArray(data?.listeners)) return;
  if (Number.isFinite(data.beatMs)) beatMs = Math.min(120000, Math.max(10000, data.beatMs));
  const before = new Map(room.map((listener) => [listener.id, listener.song?.id || null]));
  const known = Boolean(version);
  room = data.listeners.filter((listener) => /^[0-9a-f]{16}$/.test(listener?.id || "") && typeof listener.name === "string");
  total = Number.isFinite(data.total) ? data.total : room.length;
  version = typeof data.version === "string" ? data.version : "";
  // A new song, or a new arrival with one, shows its card for a moment without being asked.
  for (const listener of room) {
    if (!known || listener.id === you?.id || !listener.song || before.get(listener.id) === listener.song.id) continue;
    clearTimeout(peeks.get(listener.id));
    peeks.set(listener.id, setTimeout(() => { peeks.delete(listener.id); render(); }, PEEK_MS));
  }
  render();
}

async function report(force = false) {
  if (!started || invisible() || (force !== true && !active())) return;
  if (reporting) { again = true; return; }
  reporting = true;
  clearTimeout(beatTimer);
  const songId = playingSong(), idle = idleNow();
  // A submitter session outlives an admin one, so it is the one to present when both exist.
  const role = Date.now() < nameRestUntil ? null : signedIn("submitter") ? "submitter" : signedIn("admin") ? "admin" : null;
  const name = role ? savedAuthor().trim().slice(0, 100) : "";
  try {
    let data;
    try {
      data = await api("/listeners", { method: "POST", body: { tab, songId, idle, ...(name ? { name } : {}) }, ...(role && name ? { role } : {}) });
    } catch (error) {
      if (!role || !name || ![401, 403, 503].includes(error.status)) throw error;
      // A session that cannot be restored must not keep this listener out of the room, or retry a sign-in every beat.
      nameRestUntil = Date.now() + 10 * 60000;
      data = await api("/listeners", { method: "POST", body: { tab, songId, idle } });
    }
    lastSong = songId;
    reportedIdle = idle;
    you = data.you || null;
    accept(data);
    void poll();
  } catch { /* The room is decoration: the next beat tries again and nothing else on the page waits for it. */ }
  finally {
    reporting = false;
    beatTimer = setTimeout(report, beatMs);
    if (again) { again = false; void report(true); }
  }
}
async function poll() {
  if (polling || !started || document.hidden) return;
  polling = true;
  while (started && !document.hidden) {
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
    if (event.target.closest(".room-ghost")) return setInvisible(false);
    const button = event.target.closest(".room-avatar");
    if (!button) return;
    const id = button.closest(".room-seat").dataset.id;
    openId = openId === id ? null : id;
    render();
  });
  document.addEventListener("click", (event) => {
    if (openId && !event.target.closest(".room")) { openId = null; render(); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openId) { openId = null; render(); }
  });
  matchMedia("(max-width: 700px)").addEventListener("change", render);
  // Going to the background says so once and then falls silent; coming back is reported straight away.
  document.addEventListener("visibilitychange", () => { lastInput = Date.now(); void report(true); if (!document.hidden) void poll(); });
  for (const event of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"])
    addEventListener(event, () => {
      lastInput = Date.now();
      if (reportedIdle && !document.hidden) { reportedIdle = false; void report(); }
    }, { passive: true, capture: true });
  addEventListener("storage", (event) => { if (event.key === hiddenKey || event.key === null) render(); });
  addEventListener("pagehide", leave);
  addEventListener("pageshow", (event) => { if (event.persisted) { void report(); void poll(); } });
  if (invisible()) void poll();
  else void report();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountListeners, { once: true });
  else mountListeners();
}
