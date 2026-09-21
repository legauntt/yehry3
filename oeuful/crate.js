// What Œuful plays next. Well liked and well listened-to songs come up more often, the listener
// sets how long a side may run, and a song rests for a dozen records before it can come round
// again. This is the one place to change when the mix should follow the music instead.
import { lineRuns, pickEggMoment } from "../assets/egg-clips.js";

const memory = 12;

// Every song keeps a weight of 1, so the whole collection stays in the crate. An upvote (less
// any downvotes, up to ten) adds 1.5 and each doubling of plays adds 1, which makes a favourite
// ten to twenty times as likely as a song nobody has found yet, whenever it is not resting. A
// song that is more disliked than liked is held back instead.
const voteWeight = 1.5, voteCap = 10;
export function crateWeight(song) {
  const net = (Number(song?.votes) || 0) - (Number(song?.downvotes) || 0);
  const heard = Math.log2(1 + Math.max(0, Number(song?.playCount) || 0));
  return net < 0 ? (1 + heard) / (1 - net) : 1 + voteWeight * Math.min(net, voteCap) + heard;
}

// A clip's stretches under a ceiling, leaning towards the ones that come close to it, so the
// length the listener asks for is the length they hear.
const stretches = new WeakMap();
function stretch(clip, ceiling) {
  let cut = stretches.get(clip);
  if (!cut) stretches.set(clip, (cut = new Map()));
  if (!cut.has(ceiling)) {
    const runs = lineRuns(clip.lines, ceiling);
    const full = runs.filter(([first, last]) => clip.lines[last][1] - clip.lines[first][0] >= ceiling / 2);
    cut.set(ceiling, full.length ? full : runs);
  }
  return cut.get(ceiling);
}

// `weightOf(clip)` and `ceiling()` are asked at every pick, so live votes that arrive late and a
// length the listener has just changed both count from the next record on. Without a ceiling the
// clips' own moments are used.
export function createPicker(clips, { random = Math.random, weightOf = () => 1, ceiling = () => 0 } = {}) {
  const pool = (Array.isArray(clips) ? clips : []).filter((clip) => clip?.id && clip.url && clip.moments?.length);
  const remembered = Math.min(memory, Math.max(0, pool.length - 1));
  const recent = [];
  return () => {
    const limit = Number(ceiling()) || 0;
    const cut = limit ? pool.map((clip) => ({ ...clip, moments: stretch(clip, limit) })).filter((clip) => clip.moments.length) : [];
    const sized = cut.length ? cut : pool;
    const rested = sized.filter((clip) => !recent.includes(clip.id));
    const moment = pickEggMoment(rested.length ? rested : sized, random, null, weightOf);
    if (!moment) return null;
    recent.push(moment.id);
    while (recent.length > remembered) recent.shift();
    return moment;
  };
}
