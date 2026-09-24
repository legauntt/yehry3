import { musicBackendOf } from "./music-provenance.js";
import { songCost } from "./song-cost.js";

// Aud'tism's arithmetic, kept apart from the page so it can be tested without a browser.
// Songs without a recorded generator predate that field; paid songs always carry it, so they count as free.

const dayMs = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
// Weeks start on Monday, in the visitor's own time zone.
const startOfWeek = (date) => {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
};

export function auditEntry(song) {
  const released = Date.parse(song.publishedAt);
  const paid = musicBackendOf(song) === "eleven_music";
  const cost = paid ? songCost(song) : null;
  return {
    released: Number.isFinite(released) ? new Date(released) : null,
    paid,
    seconds: Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 0,
    cents: cost?.cents ?? 0,
    estimated: Boolean(cost?.estimated),
  };
}

const empty = () => ({ songs: 0, paid: 0, free: 0, seconds: 0, cents: 0, estimatedCents: 0 });
function add(total, entry) {
  total.songs++;
  total[entry.paid ? "paid" : "free"]++;
  total.seconds += entry.seconds;
  total.cents += entry.cents;
  if (entry.estimated) total.estimatedCents += entry.cents;
}

export function auditTotals(songs) {
  const total = { ...empty(), undated: 0 };
  for (const song of songs) {
    const entry = auditEntry(song);
    add(total, entry);
    if (!entry.released) total.undated++;
  }
  return total;
}

// One bucket per day or week from the first release to `now`, quiet periods included, oldest first.
export function auditPeriods(songs, unit = "day", now = new Date()) {
  const start = unit === "week" ? startOfWeek : startOfDay;
  const entries = songs.map(auditEntry).filter((entry) => entry.released);
  if (!entries.length) return [];
  const buckets = new Map();
  const first = start(new Date(Math.min(...entries.map((entry) => entry.released.getTime()))));
  const last = start(new Date(Math.max(now.getTime(), ...entries.map((entry) => entry.released.getTime()))));
  for (let at = first; at <= last; at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + (unit === "week" ? 7 : 1)))
    buckets.set(dayKey(at), { start: at, ...empty() });
  for (const entry of entries) add(buckets.get(dayKey(start(entry.released))), entry);
  return [...buckets.values()];
}

export const periodDays = (unit) => (unit === "week" ? 7 : 1);
export const periodEnd = (period, unit) => new Date(period.start.getTime() + periodDays(unit) * dayMs - 1);
