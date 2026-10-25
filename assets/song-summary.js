import { musicBackendOf } from "./music-provenance.js";
import { pitchOf } from "./pitch-badge.js";

export function songSummary(song) {
  const { lyrics, originalPrompt, songPlan, remixSource, remixHealth, remixAvailability, remixOf, ...summary } = song;
  if (remixOf) summary.remixOf = { songId: remixOf.songId, title: remixOf.title };
  return { ...summary, ...(musicBackendOf(song) ? { musicBackend: musicBackendOf(song) } : {}), ...(pitchOf(song) ? { pitchRepair: pitchOf(song) } : {}), hasLyrics: Boolean(lyrics?.text || song.hasLyrics), hasOriginalPrompt: Boolean(originalPrompt || song.hasOriginalPrompt), hasSongPlan: Boolean(songPlan || song.hasSongPlan) };
}
