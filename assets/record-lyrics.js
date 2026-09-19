export function singableLines(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= 12 &&
      line.length <= 110 &&
      !(line.startsWith("[") && line.endsWith("]")) &&
      line.split(/\s+/u).length >= 3,
    );
}

const freshLyricWindow = 3 * 24 * 60 * 60 * 1000;

function likedVotes(song) {
  const votes = Number(song?.votes);
  return Number.isFinite(votes) && votes > 0 ? votes : 0;
}

function publishedTimestamp(song) {
  const published = Date.parse(song?.publishedAt || "");
  if (Number.isFinite(published)) return published;
  const order = Number(song?.order);
  return order < 0 && Number.isFinite(order) ? -order : NaN;
}

export function recordLyricCandidates(songs, now = Date.now()) {
  const cutoff = Number(now) - freshLyricWindow;
  return (Array.isArray(songs) ? songs : []).filter((song) =>
    song?.id &&
    (song.hasLyrics || song.lyrics?.text) &&
    (likedVotes(song) > 0 || publishedTimestamp(song) > cutoff),
  );
}

export function pickRecordSong(songs, random = Math.random, now = Date.now()) {
  const candidates = recordLyricCandidates(songs, now);
  if (!candidates.length) return undefined;
  const highestVotes = Math.max(0, ...candidates.map(likedVotes));
  const weights = candidates.map((song) => {
    const votes = likedVotes(song);
    return 1 + (highestVotes ? 0.5 * votes / highestVotes : 0);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let draw = Math.max(0, Math.min(0.999999999999, Number(random()) || 0)) * total;
  for (let index = 0; index < candidates.length; index += 1) {
    if (draw < weights[index]) return candidates[index];
    draw -= weights[index];
  }
  return candidates.at(-1);
}

export function lyricPassage(lines, random = Math.random, viewport = {}) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const width = Number(viewport.width) || 1280;
  const height = Number(viewport.height) || 720;
  const minimum = Math.min(8, Math.max(1, Number(viewport.minLines) || 1));
  const maximum = Math.min(8, Math.max(minimum, Number(viewport.maxLines) || 8));
  const expandedLimit = width < 540
    ? (height < 600 ? 1 : 4)
    : height < 700 ? 4 : height < 900 ? 6 : 8;
  const visibleMaximum = Math.min(lines.length, expandedLimit, maximum);
  const visibleMinimum = Math.min(visibleMaximum, minimum);
  const counts = Array.from({ length: visibleMaximum - visibleMinimum + 1 }, (_, index) => visibleMinimum + index);
  const count = Math.min(lines.length, counts[Math.floor(random() * counts.length)]);
  const start = Math.floor(random() * (lines.length - count + 1));
  return lines.slice(start, start + count);
}
