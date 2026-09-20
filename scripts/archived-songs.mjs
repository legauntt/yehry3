// Backstage archives a song in the studio API, not in catalog.json: the worker owns that file, and restoring a song
// must lose nothing. So the build asks the API which songs are archived and leaves them out of everything it
// generates from the catalog (the fallback list, per-song data and pages, lyric pages, /catalog.json).

const SONG_ID = /^[a-z0-9-]{1,120}$/;

// The archived IDs from the public catalog summary, or null when they cannot be trusted. That includes an API
// that predates archiving and so does not report them; the build then keeps every song rather than guess.
export async function archivedSongIds(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const { archived } = await response.json();
    return Array.isArray(archived) && archived.every((id) => typeof id === "string" && SONG_ID.test(id)) ? archived : null;
  } catch {
    return null;
  }
}

// A misbehaving API must not empty the fallback, so an implausibly large archive is refused.
export const MAX_ARCHIVED_SHARE = 0.5;

export function publicCatalog(catalog, archived) {
  const hidden = new Set(archived);
  const songs = catalog.songs.filter((song) => !hidden.has(song.id));
  if (songs.length === catalog.songs.length) return catalog;
  if (catalog.songs.length - songs.length > catalog.songs.length * MAX_ARCHIVED_SHARE)
    throw new RangeError(`Refusing to archive ${catalog.songs.length - songs.length} of ${catalog.songs.length} songs`);
  return { ...catalog, songs };
}
