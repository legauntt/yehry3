import { watchSong } from "./song-data.js";
import { api } from "./api.js";

export const remixHref = song => `/distonyc/?remix=${encodeURIComponent(song.id)}`;

export function remixBadge(song) {
  return song?.remixOf ? '<span class="remix-badge">Remix</span>' : '';
}

export function remixSeed(song, source) {
  if (!source || source.songId !== song.id) throw new Error("The selected recording is not ready for remixing.");
  const brief = song.originalPrompt || {};
  return {
    prompt: `Remix “${song.title}”. Give it a new arrangement while keeping its identity.${brief.idea ? `\n\nOriginal idea: ${brief.idea}` : ""}${brief.direction ? `\n\nOriginal sound: ${brief.direction}` : ""}`.slice(0, 2000),
    direction: "",
    keep: `Keep the recognizable hook and spirit of “${song.title}”.`.slice(0, 1000),
    basisSongIds: [],
    remixSongId: source.songId,
    remixSource: source,
    voiceModel: brief.voiceModel || song.voiceModel || "v7",
    ...(song.lyrics?.text && song.lyrics.text.length <= 30000 && song.lyrics.text.trim().split(/\s+/u).length <= 3000
      ? { lyricSheet: { text: song.lyrics.text, mode: "adapt" } } : {}),
  };
}

export async function loadRemix() {
  const id = new URLSearchParams(location.search).get("remix");
  if (!id) return null;
  let song;
  await watchSong(id, value => { song = value; }, value => Boolean(value?.title && value?.url)).ready;
  if (!song) return { id, unavailable: true, message: "This remix source could not load. Try again shortly." };
  try {
    const { source } = await api(`/remix-sources/${encodeURIComponent(id)}`);
    return { id, title: song.title, seed: remixSeed(song, source) };
  } catch (error) {
    return { id, title: song.title, unavailable: true, message: error.message };
  }
}

export function remixLink(song, escape) {
  const availability = song.remixAvailability;
  const ready = availability?.status === 'ready' && new Date(availability.expiresAt) > new Date();
  const action = ready
    ? `<a class="text-link" href="${remixHref(song)}" aria-label="Remix ${escape(song.title)}">Remix ↗</a>`
    : availability
      ? '<span class="small remix-unavailable" title="This recording is temporarily unavailable for remixing. Check back later.">Remix unavailable</span>'
      : `<a class="text-link" href="${remixHref(song)}" aria-label="Check remix availability for ${escape(song.title)}">Check remix availability ↗</a>`;
  const parent = song.remixOf;
  const original = parent && /^[a-z0-9-]{1,120}$/.test(parent.songId)
    ? `<a class="text-link remix-original-link" href="/lyrics/?song=${encodeURIComponent(song.id)}#compare-original" aria-label="Compare ${escape(song.title)} with ${escape(parent.title)}">Compare with original ↗</a>` : '';
  return `<span data-remix>${action}${original}</span>`;
}
