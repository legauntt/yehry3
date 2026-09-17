import { musicBackendOf } from "./music-provenance.js";

export function songSummary(song) {
  const { lyrics, originalPrompt, songPlan, ...summary } = song;
  return { ...summary, ...(musicBackendOf(song) ? { musicBackend: musicBackendOf(song) } : {}), hasLyrics: Boolean(lyrics?.text || song.hasLyrics), hasOriginalPrompt: Boolean(originalPrompt || song.hasOriginalPrompt), hasSongPlan: Boolean(songPlan || song.hasSongPlan) };
}
