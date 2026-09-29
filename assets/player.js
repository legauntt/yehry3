// The one player. A single audio element lives for as long as the tab does, so moving between pages
// (see shell.js) never stops a song. Pages start songs and queues here and read its state; the bar
// along the bottom (player-bar.js) is its face on every page. Songs are the catalog's own objects
// (id, title, url, alternates…); a queue may also give each entry a key of its own, so a mixtape that
// lists one song twice still knows which of the two is playing.
import { trackListening } from "./listening.js";
import { api } from "./api.js";
import { nowListening } from "./listeners.js";

export const audio = document.createElement("audio");
audio.id = "audio";
audio.controls = true;
audio.preload = "metadata";

const safe = (value) => {
  try {
    const url = new URL(value, location.origin);
    return ["https:", "http:"].includes(url.protocol) && value ? url.href : "";
  } catch { return ""; }
};
const listeners = { change: new Set(), error: new Set(), recorded: new Set() };
let queue = [], index = -1, source = null;
let request = 0;
let crossfadeSeconds = 0, baseVolume = 1, overlap = null;

function stopOverlap() {
  if (!overlap) return;
  cancelAnimationFrame(overlap.frame);
  overlap.incoming.pause();
  overlap.incoming.removeAttribute("src");
  overlap.incoming.load();
  overlap = null;
  audio.volume = baseVolume;
}

function fadeOverlap(state) {
  if (overlap !== state || state.handoff || audio.paused) return;
  const remaining = Math.max(0, audio.duration - audio.currentTime);
  const portion = Math.max(0, Math.min(1, 1 - remaining / crossfadeSeconds));
  audio.volume = baseVolume * Math.cos(portion * Math.PI / 2);
  state.incoming.volume = baseVolume * Math.sin(portion * Math.PI / 2);
  state.frame = requestAnimationFrame(() => fadeOverlap(state));
}

async function beginOverlap() {
  if (overlap || !crossfadeSeconds || audio.loop || index >= queue.length - 1 || audio.paused || !Number.isFinite(audio.duration)) return;
  const remaining = audio.duration - audio.currentTime;
  if (remaining > crossfadeSeconds || remaining <= 0) return;
  const target = queue[index + 1];
  const url = safe(target.song.url);
  if (!url) return;
  const incoming = document.createElement("audio");
  incoming.preload = "auto";
  incoming.src = url;
  incoming.volume = 0;
  // Some mobile browsers keep media volume fixed at full; use the normal transition there.
  if (incoming.volume > 0.01) return;
  const state = { incoming, target, frame: 0, handoff: false };
  overlap = state;
  try {
    await incoming.play();
    if (overlap === state) fadeOverlap(state);
    else incoming.pause();
  } catch {
    if (overlap === state) stopOverlap();
  }
}

async function finishOverlap() {
  const state = overlap;
  if (!state || state.handoff) return;
  state.handoff = true;
  cancelAnimationFrame(state.frame);
  state.incoming.volume = baseVolume;
  const position = state.incoming.currentTime;
  const mine = ++request;
  index++;
  audio.preload = "auto";
  audio.volume = 0;
  audio.src = safe(state.target.song.url);
  audio.load();
  // Keep the incoming deck audible while the persistent player seeks to its position.
  if (audio.readyState < 1) await new Promise(resolve => {
    const done = () => { clearTimeout(timer); audio.removeEventListener("loadedmetadata", done); audio.removeEventListener("error", done); resolve(); };
    const timer = setTimeout(done, 3000);
    audio.addEventListener("loadedmetadata", done);
    audio.addEventListener("error", done);
  });
  if (mine !== request || overlap !== state) return;
  if (audio.error) { stopOverlap(); emit("error", { kind: "load", song: state.target.song }); return; }
  try { audio.currentTime = state.incoming.currentTime || position; } catch {}
  listening.start(undefined, source);
  nowListening(audio, state.target.song.id);
  emit("change", { song: state.target.song, reason: "crossfade" });
  try {
    await audio.play();
    if (mine !== request || overlap !== state) return;
    const started = performance.now();
    const handoff = () => {
      if (overlap !== state) return;
      const fraction = Math.min(1, (performance.now() - started) / 250);
      audio.volume = baseVolume * Math.sin(fraction * Math.PI / 2);
      state.incoming.volume = baseVolume * Math.cos(fraction * Math.PI / 2);
      if (fraction < 1) state.frame = requestAnimationFrame(handoff);
      else stopOverlap();
    };
    handoff();
  } catch {
    if (overlap === state) stopOverlap();
    emit("error", { kind: "blocked", song: state.target.song });
  }
}

function emit(type, detail) {
  for (const listener of [...listeners[type]]) {
    try { listener(detail); } catch { /* One page's handler never stops another's. */ }
  }
}
// "main" and "lyrics" are listens the studio counts; a mixtape plays without reporting one.
const listening = trackListening(audio, {
  source: "main",
  send: (body) => api("/listens", { method: "POST", body }),
  onRecorded: (id, stats) => emit("recorded", { id, stats }),
});

const entry = () => queue[index] || null;

export const player = {
  audio,
  get current() { return entry()?.song || null; },
  get key() { return entry()?.key ?? null; },
  get queue() { return queue.map((item) => item.song); },
  get keys() { return queue.map((item) => item.key); },
  get index() { return index; },
  get source() { return source; },
  get playing() { return Boolean(entry() && audio.src && !audio.paused && !audio.ended && !audio.error); },
  setVolume(value) {
    if (!Number.isFinite(value)) return;
    baseVolume = Math.max(0, Math.min(1, value));
    if (!overlap) audio.volume = baseVolume;
  },
  setCrossfade(seconds) {
    crossfadeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 5) : 0;
    if (!crossfadeSeconds) stopOverlap();
  },
  // Called with a name and a function; the returned function (or the signal) ends the subscription.
  on(type, listener, signal) {
    listeners[type].add(listener);
    const off = () => listeners[type].delete(listener);
    signal?.addEventListener("abort", off, { once: true });
    return off;
  },
  // Starts a song. With a list, that list becomes the queue (the song is found in it by key, else by id);
  // without one the song plays where it is in the current queue, or alone. Resolves false if the browser
  // wanted a tap before it would play.
  async play(song, list, { source: origin, keys, key, at, autoplay = true, crossfade } = {}) {
    if (!song || !safe(song.url)) return false;
    stopOverlap();
    if (Array.isArray(list) || origin) player.setCrossfade(origin?.startsWith("tape:") ? crossfade : 0);
    if (Array.isArray(list)) {
      queue = list.map((item, position) => ({ song: item, key: keys?.[position] ?? item.id }));
      source = origin || "collection";
    } else if (origin) source = origin;
    let position = queue.findIndex((item) => (key !== undefined ? item.key === key : item.song.id === song.id));
    if (position < 0) {
      queue = [{ song, key: key ?? song.id }];
      position = 0;
      if (!Array.isArray(list)) source = origin || source || "collection";
    } else queue[position] = { song, key: queue[position].key };
    index = position;
    const mine = ++request;
    // A song about to play loads as it plays; one only readied fetches just enough to know its length.
    audio.preload = autoplay ? "none" : "metadata";
    audio.src = safe(song.url);
    // Where in the song to begin (a shared moment, or the place a comparison left off).
    if (Number.isFinite(at) && at > 0)
      audio.addEventListener("loadedmetadata", () => {
        try { audio.currentTime = Number.isFinite(audio.duration) ? Math.min(at, Math.max(0, audio.duration - 0.1)) : at; } catch { /* Starts from the top instead. */ }
      }, { once: true });
    listening.start(["main", "lyrics"].includes(source) ? song.id : undefined, source);
    nowListening(audio, song.id);
    emit("change", { song, reason: "play" });
    // Loaded and ready, but the visitor has not asked to hear it yet.
    if (!autoplay) return true;
    try {
      await audio.play();
      return true;
    } catch {
      if (mine === request) emit("error", { kind: "blocked", song });
      return false;
    }
  },
  // Readies a song (the bar shows it, paused at `at`) without playing it.
  load(song, list, options) { return player.play(song, list, { ...options, autoplay: false }); },
  // Play the song, or pause or resume it if it is the one already loaded.
  async toggle(song, list, options) {
    if (!song) return false;
    const same = options?.key !== undefined ? player.key === options.key : player.current?.id === song.id;
    if (!same || !audio.src) return player.play(song, list, options);
    if (!audio.paused && !audio.ended) { audio.pause(); return true; }
    if (audio.ended) audio.currentTime = 0;
    try { await audio.play(); return true; }
    catch { emit("error", { kind: "blocked", song }); return false; }
  },
  pause() { audio.pause(); overlap?.incoming.pause(); },
  async resume() {
    if (!entry() || !audio.src) return false;
    try { await audio.play(); return true; }
    catch { emit("error", { kind: "blocked", song: player.current }); return false; }
  },
  // Moves along the queue; resolves false when there is nowhere to go.
  async step(offset) {
    const to = index + offset;
    if (to < 0 || to >= queue.length) return false;
    const target = queue[to];
    return player.play(target.song, undefined, { key: target.key });
  },
  // Unloads whatever is loaded; the bar disappears until something else is played.
  clear() {
    request++;
    stopOverlap(); crossfadeSeconds = 0;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    queue = []; index = -1; source = null;
    listening.start(undefined);
    emit("change", { song: null, reason: "clear" });
  },
  // Replace the queue without touching what is playing (a page edited the list the song came from).
  requeue(list, { keys, key, source: origin } = {}) {
    if (!entry()) return;
    const wanted = key ?? player.key;
    const next = list.map((item, position) => ({ song: item, key: keys?.[position] ?? item.id }));
    const position = next.findIndex((item) => item.key === wanted);
    if (position < 0) return;
    queue = next; index = position;
    if (origin) source = origin;
    emit("change", { song: entry().song, reason: "queue" });
  },
  // A different recording of the same song (the bar's A/B switch) is the song's own doing.
  changed(song) { if (entry()) { queue[index] = { song, key: queue[index].key }; emit("change", { song, reason: "side" }); } },
};

// When a song finishes the queue moves on; a looping song never reports that it ended.
audio.addEventListener("ended", () => {
  if (overlap && !overlap.handoff) void finishOverlap();
  else if (index < queue.length - 1 && !overlap) void player.step(1);
  else emit("change", { song: player.current, reason: "finished" });
});
audio.addEventListener("timeupdate", () => {
  if (overlap && !overlap.handoff && audio.duration - audio.currentTime > crossfadeSeconds + 0.5) stopOverlap();
  else void beginOverlap();
});
audio.addEventListener("seeking", () => { if (overlap && !overlap.handoff) stopOverlap(); });
audio.addEventListener("pause", () => { if (overlap && !overlap.handoff) overlap.incoming.pause(); });
audio.addEventListener("play", () => { if (overlap && !overlap.handoff) void overlap.incoming.play().catch(() => stopOverlap()); });
audio.addEventListener("volumechange", () => { if (!overlap) baseVolume = audio.volume; });
audio.addEventListener("error", () => { if (audio.src) emit("error", { kind: "load", song: player.current }); });

// Handy for tests and for a console: window.yehry3Player.
if (typeof window !== "undefined") window.yehry3Player = player;
