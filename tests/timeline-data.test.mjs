import test from "node:test";
import assert from "node:assert/strict";
import { heatLevel, heatWeeks, timelineDays, timelineRows, timelineStats } from "../assets/timeline-data.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const songs = [
  { id: "c", publishedAt: at(2026, 9, 16) },
  { id: "a", publishedAt: at(2026, 9, 14) },
  { id: "b", publishedAt: at(2026, 9, 14, 20) },
  { id: "d", publishedAt: at(2026, 9, 17) },
  { id: "e", publishedAt: at(2026, 9, 18, 9) },
  { id: "x" },
];
const now = new Date(2026, 8, 19, 10);

test("days run from the first release to today, songs numbered in release order", () => {
  const days = timelineDays(songs, now);
  assert.equal(days.length, 6);
  assert.deepEqual(days.map((day) => day.songs.map(({ song }) => song.id)), [["a", "b"], [], ["c"], ["d"], ["e"], []]);
  assert.deepEqual(days[0].songs.map(({ number }) => number), [1, 2]);
  assert.equal(days[4].songs[0].number, 5);
});

test("streaks: the longest run, and the current one still counts before today's first song", () => {
  const stats = timelineStats(timelineDays(songs, now));
  assert.deepEqual({ ...stats, busiest: stats.busiest.start.getDate() }, { days: 6, activeDays: 4, songs: 5, longest: 3, current: 3, busiest: 14 });
  const lapsed = timelineStats(timelineDays(songs, new Date(2026, 8, 20, 10)));
  assert.equal(lapsed.current, 0);
});

test("quiet days fold into gaps, newest first", () => {
  const rows = timelineRows(timelineDays(songs, new Date(2026, 8, 21, 10)));
  assert.deepEqual(rows.map((row) => row.kind === "gap" ? `gap${row.days.length}` : row.day.start.getDate()), ["gap3", 18, 17, 16, "gap1", 14]);
});

test("heat levels scale to the busiest day and weeks start on Monday", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 8].map((n) => heatLevel(n, 8)), [0, 1, 1, 2, 2, 4]);
  assert.equal(heatLevel(1, 100), 1);
  const weeks = heatWeeks(timelineDays(songs, now));
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0][0].start.getDate(), 14); // Sept 14 2026 is a Monday
  assert.equal(weeks[0][6], null); // and the grid pads out the rest of the week
  const midweek = heatWeeks(timelineDays(songs.slice(0, 1), now));
  assert.deepEqual(midweek[0].slice(0, 3), [null, null, midweek[0][2]]);
  assert.equal(midweek[0][2].start.getDate(), 16);
});

test("nothing dated means no days", () => {
  assert.deepEqual(timelineDays([{ id: "x" }], now), []);
  assert.deepEqual(heatWeeks([]), []);
});
