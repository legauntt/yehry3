import { api, publicApi } from "./api.js";
import { songAlias } from "./song-links.js";

const cacheKey = "yehry3:public-songs:v1";
let memory = {};
try {
  const saved = JSON.parse(localStorage.getItem(cacheKey));
  if (saved && typeof saved === "object" && !Array.isArray(saved)) memory = saved;
} catch { /* Memory and public static files still work without browser storage. */ }

function remember(song) {
  delete memory[song.id];
  memory[song.id] = song;
  let entries = Object.entries(memory).slice(-12);
  while (entries.length > 1 && JSON.stringify(entries).length > 750000) entries.shift();
  memory = Object.fromEntries(entries);
  try { localStorage.setItem(cacheKey, JSON.stringify(memory)); } catch { /* Cache is optional. */ }
}

// New pretty links can precede their generated HTML. Resolve the complete alias,
// including its title, without making either network source wait for the other.
export async function resolveLyricsSongId(pathname) {
  const alias = /^\/lyrics\/([a-z0-9-]{1,72}-[a-f0-9]{6})(?:\/(?:index\.html)?)?$/.exec(pathname)?.[1];
  if (!alias) return null;
  const lookup = (songs) => {
    if (!Array.isArray(songs)) return null;
    const ids = new Set(songs.filter(song =>
      /^[a-z0-9-]{1,120}$/.test(song?.id || "") && typeof song.title === "string" && songAlias(song) === alias,
    ).map(song => song.id));
    return ids.size === 1 ? [...ids][0] : null;
  };
  const cached = lookup(Object.values(memory));
  if (cached) return cached;
  const sources = [
    api("/songs/summary", { timeout: 5000 }),
    fetch("/catalog-summary.json", { signal: AbortSignal.timeout(5000) }).then(response => {
      if (!response.ok) throw new Error("The saved catalog is unavailable.");
      return response.json();
    }),
  ];
  return Promise.any(sources.map(source => source.then(({ songs }) => {
    const id = lookup(songs);
    if (!id) throw new Error("This catalog does not contain the lyric sheet.");
    return id;
  }))).catch(() => null);
}

export function mergeSong(saved, live) {
  if (!saved) return live;
  if (!live) return saved;
  const song = { ...saved, ...live };
  if (saved.originalPrompt || live.originalPrompt)
    song.originalPrompt = { ...saved.originalPrompt, ...live.originalPrompt };
  song.songPlan = live.songPlan || saved.songPlan;
  if (live.lyrics && saved.lyrics?.text === live.lyrics.text && !live.lyrics.cues?.length && saved.lyrics.cues?.length)
    song.lyrics = { ...live.lyrics, cues: saved.lyrics.cues };
  return song;
}

// A saved result renders synchronously. Independent network reads can then improve
// it; neither a slow API nor an absent static file holds up the other source.
export function watchSong(id, onSong, usable = (song) => Boolean(song)) {
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  if (!/^[a-z0-9-]{1,120}$/.test(id || "")) {
    onSong(null); resolveReady(); return { ready, refresh: async () => {}, dispose() {} };
  }
  let saved = memory[id], live, signature, disposed = false;
  const emit = () => {
    const song = mergeSong(saved, live);
    if (disposed || !usable(song)) return;
    const nextSignature = JSON.stringify(song);
    if (nextSignature !== signature) {
      signature = nextSignature;
      remember(song);
      onSong(song);
    }
    resolveReady();
  };
  emit();
  let pending;
  const refresh = () => pending ||= publicApi(`/songs/${encodeURIComponent(id)}`)
    .then(({ song }) => { if (song?.id === id) { live = song; emit(); } })
    .catch(() => { /* The saved public detail remains readable. */ })
    .finally(() => { pending = null; });
  const published = fetch(`/songs/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(5000) })
    .then(async (response) => {
      if (!response.ok) return;
      const song = await response.json();
      if (song?.id === id) { saved = mergeSong(song, saved); emit(); }
    }).catch(() => { /* Brand-new and unfinished songs can exist only in the API. */ });
  Promise.allSettled([published, refresh()]).then(() => {
    if (!signature && !disposed) onSong(null);
    resolveReady();
  });
  addEventListener("pagehide", (event) => { if (!event.persisted) disposed = true; }, { once: true });
  return { ready, refresh, dispose() { disposed = true; } };
}
