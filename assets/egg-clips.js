// Sung moments for the cover art easter egg: one sung line (two if the first is short) from
// each recording that has timed lyric cues. The build writes them to egg-clips.json, so the
// egg never has to load the catalog.
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
    return moments.length ? [{ id: song.id, title: song.title, url: song.url, moments }] : [];
  });
}

export function pickEggMoment(clips, random = Math.random, avoidId = null) {
  const pool = (Array.isArray(clips) ? clips : []).filter((clip) => clip.moments?.length);
  const choices = pool.filter((clip) => clip.id !== avoidId);
  const clip = (choices.length ? choices : pool)[Math.floor(random() * (choices.length || pool.length))];
  if (!clip) return null;
  const [start, end] = clip.moments[Math.floor(random() * clip.moments.length)];
  return { id: clip.id, title: clip.title, url: clip.url, start, end };
}
