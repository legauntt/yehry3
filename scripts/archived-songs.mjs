// Backstage archives a song in the studio API, not in catalog.json: the worker owns that file, and restoring a song
// must lose nothing. So the build asks the API which songs are archived and leaves them out of everything it
// generates from the catalog (the fallback list, per-song data and pages, lyric pages, /catalog.json).

import { randomUUID } from "node:crypto";
import archiveApprovals from "../archive-approvals.json" with { type: "json" };

const SONG_ID = /^[a-z0-9-]{1,120}$/;

// The archived IDs from the public catalog summary, or null when they cannot be trusted. That includes an API
// that predates archiving and so does not report them; the build then keeps every song rather than guess.
export async function archivedSongIds(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json", "X-Visitor-ID": randomUUID(), Origin: "https://yehry3.app" } });
    if (!response.ok) return null;
    const { archived } = await response.json();
    return Array.isArray(archived) && archived.every((id) => typeof id === "string" && SONG_ID.test(id)) ? archived : null;
  } catch {
    return null;
  }
}

// Large pruning batches need a reviewed list of exact IDs. Approval only relaxes
// the size guard: the API still decides which songs are currently archived.
export const MAX_ARCHIVED_SHARE = 0.5;

export function publicCatalog(catalog, archived, approved = archiveApprovals.archived) {
  if (!Array.isArray(approved) || !approved.every((id) => typeof id === "string" && SONG_ID.test(id)))
    throw new TypeError("Invalid approved archive IDs");
  const hidden = new Set(archived);
  const songs = catalog.songs.filter((song) => !hidden.has(song.id));
  if (songs.length === catalog.songs.length) return catalog;
  const allowed = new Set(approved);
  if (catalog.songs.length - songs.length > catalog.songs.length * MAX_ARCHIVED_SHARE &&
      catalog.songs.some((song) => hidden.has(song.id) && !allowed.has(song.id)))
    throw new RangeError(`Refusing to archive ${catalog.songs.length - songs.length} of ${catalog.songs.length} songs`);
  return { ...catalog, songs };
}
