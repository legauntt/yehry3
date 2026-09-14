import { publicApi } from "./api.js";

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
    onSong(null); resolveReady(); return { ready, refresh: async () => {} };
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
  return { ready, refresh };
}
