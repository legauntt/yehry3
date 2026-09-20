// What the Œuful booth plays next. This first version is plain chance: every song is as likely
// as any other, then any of its sung moments. The only rule is that a song just heard sits out
// for a while, so the mix never stutters on one record. A later version may follow the music
// instead (tempo, key, where a phrase lands); that belongs here, behind the same call.
import { pickEggMoment } from "../assets/egg-clips.js";

const memory = 12;

// clips is the list from egg-clips.json. Returns a function that hands out the next moment,
// { id, title, url, start, end, lines }, or null when there is nothing to play.
export function createPicker(clips, random = Math.random) {
  const pool = (Array.isArray(clips) ? clips : []).filter((clip) => clip?.id && clip.url && clip.moments?.length);
  // A small collection remembers less, so there is always someone left to play.
  const remembered = Math.min(memory, Math.max(0, pool.length - 1));
  const recent = [];
  return () => {
    const rested = pool.filter((clip) => !recent.includes(clip.id));
    const moment = pickEggMoment(rested.length ? rested : pool, random);
    if (!moment) return null;
    recent.push(moment.id);
    while (recent.length > remembered) recent.shift();
    return moment;
  };
}
