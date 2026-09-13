export function shortSongHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export function songAlias(song) {
  const slug = String(song.title || "song")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .replace(/-$/g, "") || "song";
  return `${slug}-${shortSongHash(song.id)}`;
}

export function lyricsHref(song) {
  return `/lyrics/${songAlias(song)}/`;
}
