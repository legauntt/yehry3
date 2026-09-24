// Timeline's arithmetic, kept apart from the page so it can be tested without a browser.
// Days are the visitor's own calendar days; songs without a release time are left off.

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const nextDay = (date, by = 1) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + by);

// Every day from the first release to `now`, oldest first, each with its songs in release order.
// Songs are numbered across the whole catalog so the page can mark the 100th, 200th and so on.
export function timelineDays(songs, now = new Date()) {
  const dated = songs
    .map((song) => ({ song, at: Date.parse(song.publishedAt) }))
    .filter(({ at }) => Number.isFinite(at))
    .sort((a, b) => a.at - b.at)
    .map(({ song, at }, index) => ({ song, released: new Date(at), number: index + 1 }));
  if (!dated.length) return [];
  const days = new Map();
  const last = startOfDay(new Date(Math.max(now.getTime(), dated.at(-1).released.getTime())));
  for (let at = startOfDay(dated[0].released); at <= last; at = nextDay(at)) days.set(dayKey(at), { start: at, songs: [] });
  for (const entry of dated) days.get(dayKey(entry.released)).songs.push(entry);
  return [...days.values()];
}

// Headline numbers: how long the catalog has run, how many of those days had a release, the longest
// unbroken run of release days, the current run (today counts if it has songs, yesterday otherwise) and the busiest day.
export function timelineStats(days) {
  let longest = 0, run = 0, busiest = null;
  for (const day of days) {
    run = day.songs.length ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (day.songs.length && (!busiest || day.songs.length > busiest.songs.length)) busiest = day;
  }
  let current = 0;
  const recent = [...days].reverse();
  const from = recent[0]?.songs.length ? 0 : 1;
  for (const day of recent.slice(from)) {
    if (!day.songs.length) break;
    current++;
  }
  return {
    days: days.length,
    activeDays: days.filter((day) => day.songs.length).length,
    songs: days.reduce((sum, day) => sum + day.songs.length, 0),
    longest,
    current,
    busiest,
  };
}

// Quiet days collapse into gaps, so the timeline alternates release days and runs of silence, newest first.
export function timelineRows(days) {
  const rows = [];
  for (const day of [...days].reverse()) {
    if (day.songs.length) rows.push({ kind: "day", day });
    else if (rows.at(-1)?.kind === "gap") rows.at(-1).days.push(day);
    else rows.push({ kind: "gap", days: [day] });
  }
  return rows;
}

// Heat levels 0–4 for the calendar strip, scaled to the busiest day so the colours stay meaningful as volume grows.
export function heatLevel(count, max) {
  if (!count || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

// Calendar columns for the heat strip: one per Monday-start week, seven slots each; slots outside the range are null.
export function heatWeeks(days) {
  if (!days.length) return [];
  const first = days[0].start;
  const offset = (first.getDay() + 6) % 7;
  const slots = [...Array(offset).fill(null), ...days];
  while (slots.length % 7) slots.push(null);
  const weeks = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

// The Monday that starts the week a date falls in.
export const weekStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));

// Week headings threaded into the rows: each goes above the newest row of its week (a run of quiet days
// belongs to the week of its newest day) and carries that week's release days, so the page can roll up
// songs and spend. A week with no release at all gets no heading; its quiet days read as part of the gap.
export function withWeeks(rows) {
  const out = [];
  let week = null;
  for (const row of rows) {
    const start = weekStart(row.kind === "day" ? row.day.start : row.days[0].start);
    if (!week || week.start.getTime() !== start.getTime()) out.push(week = { kind: "week", start, days: [] });
    if (row.kind === "day") week.days.push(row.day);
    out.push(row);
  }
  return out.filter((row) => row.kind !== "week" || row.days.length);
}

// Paid spend in cents for a set of timeline entries, given a per-song cost function (null means free or unknown).
export function spend(entries, costOf) {
  let cents = 0, paid = 0, free = 0;
  for (const { song } of entries) {
    const cost = costOf(song);
    if (cost) { cents += cost.cents; paid++; } else free++;
  }
  return { cents, paid, free };
}
