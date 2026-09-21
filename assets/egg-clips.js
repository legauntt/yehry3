// Sung moments for the cover art easter egg: stretches of a recording's sung lines, from a
// couple of seconds up to nineteen. Each recording that has timed lyric cues gets its lines
// ([start, end, words]) once, and every moment is a range of them ([first, last]), so the
// cover art's comic caption can follow the words as they are sung. The build writes them to
// egg-clips.json, so the egg never has to load the catalog. Votes change hourly, so only the
// release time is baked in; the page adds live votes when it has them.
const shortest = 1.2, shortestMoment = 2, longestMoment = 19, joinGap = 1.5;
// A stretch may end at any line, so each starting line offers a moment for each of these
// ceilings: the longest run of joined lines that still fits.
const ceilings = [4, 8, 13, longestMoment];
const longestWords = 140;
const round = (seconds) => Math.round(seconds * 10) / 10;
// Only lines sung close together join up; a long break would be dead air.
const runFrom = (lines, first, ceiling) => {
  let last = first;
  while (last + 1 < lines.length && lines[last + 1][0] - lines[last][1] <= joinGap && lines[last + 1][1] - lines[first][0] <= ceiling) last += 1;
  return last;
};
// Every stretch under one ceiling: from each starting line, the longest run that still fits.
// Œuful (/oeuful) lets the listener set the ceiling, so it cuts its own from a clip's lines.
export function lineRuns(lines, ceiling) {
  const runs = [];
  for (let first = 0; first < (lines?.length || 0); first += 1) {
    const last = runFrom(lines, first, ceiling), length = lines[last][1] - lines[first][0];
    if (length >= shortestMoment && length <= ceiling) runs.push([first, last]);
  }
  return runs;
}

export function songMoments(song) {
  const text = String(song?.lyrics?.text || "").split(/\r?\n/u);
  const lines = (Array.isArray(song?.lyrics?.cues) ? song.lyrics.cues : [])
    .filter((cue) => {
      const line = text[cue?.line]?.trim();
      return line && !/^\[[^\]]+\]$/u.test(line) && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end - cue.start >= shortest && cue.end - cue.start <= longestMoment;
    })
    .sort((a, b) => a.start - b.start)
    .map((cue) => {
      const words = text[cue.line].trim();
      return [round(cue.start), round(cue.end), words.length > longestWords ? words.slice(0, longestWords - 1).trimEnd() + "…" : words];
    });
  const moments = new Map();
  for (let first = 0; first < lines.length; first += 1) {
    for (const ceiling of ceilings) {
      const last = runFrom(lines, first, ceiling);
      const length = lines[last][1] - lines[first][0];
      if (length >= shortestMoment && length <= ceiling) moments.set(first + "-" + last, [first, last]);
    }
  }
  return { lines, moments: [...moments.values()] };
}

// Recordings with measured quality problems could open on a glitch, so they stay out of the egg.
export function eggClips(songs) {
  return (Array.isArray(songs) ? songs : []).flatMap((song) => {
    if (!song?.id || !song.url || song.qualityIssues?.length) return [];
    const { lines, moments } = songMoments(song);
    return moments.length ? [{ id: song.id, title: song.title, url: song.url, publishedAt: song.publishedAt || null, lines, moments }] : [];
  });
}

// Upvoted and recent songs come up far more often, but the whole collection stays possible.
// A vote counts for 2 (capped at ten), a release is worth 10 and halves every week, and
// every song keeps a floor of 0.1. Without votes or a release time, a song just gets the floor.
const voteWeight = 2, voteCap = 10, freshWeight = 10, halfLife = 7 * 24 * 60 * 60 * 1000, floor = 0.1;
export function eggWeight(clip, votes = 0, now = Date.now()) {
  const released = Date.parse(clip?.publishedAt || "");
  const age = Number.isFinite(released) ? Math.max(0, now - released) : Infinity;
  const fresh = Number.isFinite(age) ? freshWeight * 0.5 ** (age / halfLife) : 0;
  return floor + voteWeight * Math.min(Math.max(Number(votes) || 0, 0), voteCap) + fresh;
}

// The pick says when to start and stop, and which words are sung along the way.
export function pickEggMoment(clips, random = Math.random, avoidId = null, weightOf = () => 1) {
  const pool = (Array.isArray(clips) ? clips : []).filter((clip) => clip.moments?.length);
  const choices = pool.filter((clip) => clip.id !== avoidId);
  const from = choices.length ? choices : pool;
  const weights = from.map((clip) => Math.max(0, Number(weightOf(clip)) || 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * total, index = 0;
  if (total > 0) {
    while (index < from.length - 1 && target >= weights[index]) target -= weights[index++];
  } else index = Math.floor(random() * from.length);
  const clip = from[index];
  if (!clip) return null;
  const [first, last] = clip.moments[Math.floor(random() * clip.moments.length)];
  const sung = clip.lines.slice(first, last + 1).map(([start, end, words]) => ({ start, end, words }));
  return { id: clip.id, title: clip.title, url: clip.url, start: sung[0].start, end: sung.at(-1).end, lines: sung };
}
