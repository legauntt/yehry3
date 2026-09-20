// Sung moments for the cover art easter egg: one sung line (two if the first is short) from
// each recording that has timed lyric cues. The build writes them to egg-clips.json, so the
// egg never has to load the catalog. Votes change hourly, so only the release time is baked in;
// the page adds live votes when it has them.
const shortest = 1.2, wanted = 3, longest = 7, joinGap = 0.8;
const round = (seconds) => Math.round(seconds * 10) / 10;

export function songMoments(song) {
  const text = String(song?.lyrics?.text || "").split(/\r?\n/u);
  const cues = (Array.isArray(song?.lyrics?.cues) ? song.lyrics.cues : [])
    .filter((cue) => {
      const line = text[cue?.line]?.trim();
      return line && !/^\[[^\]]+\]$/u.test(line) && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end - cue.start >= shortest && cue.end - cue.start <= longest;
    })
    .sort((a, b) => a.start - b.start);
  const moments = [];
  for (let index = 0; index < cues.length; index += 1) {
    const { start } = cues[index];
    let { end } = cues[index];
    const next = cues[index + 1];
    if (end - start < wanted && next && next.start - end <= joinGap && next.end - start <= longest) end = next.end;
    moments.push([round(start), round(end)]);
  }
  return moments;
}

// Recordings with measured quality problems could open on a glitch, so they stay out of the egg.
export function eggClips(songs) {
  return (Array.isArray(songs) ? songs : []).flatMap((song) => {
    if (!song?.id || !song.url || song.qualityIssues?.length) return [];
    const moments = songMoments(song);
    return moments.length ? [{ id: song.id, title: song.title, url: song.url, publishedAt: song.publishedAt || null, moments }] : [];
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
  const [start, end] = clip.moments[Math.floor(random() * clip.moments.length)];
  return { id: clip.id, title: clip.title, url: clip.url, start, end };
}
