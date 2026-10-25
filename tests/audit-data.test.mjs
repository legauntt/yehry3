import test from "node:test";
import assert from "node:assert/strict";
import { auditPeriods, auditTotals } from "../assets/audit-data.js";

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const songs = [
  { id: "a", publishedAt: at(2026, 9, 14), duration: 180, musicBackend: "eleven_music" },
  { id: "b", publishedAt: at(2026, 9, 14, 20), duration: 240, musicBackend: "local" },
  { id: "c", publishedAt: at(2026, 9, 16), duration: 120 },
  { id: "d", publishedAt: at(2026, 9, 21), duration: null, originalPrompt: { musicBackend: "eleven_music" } },
  { id: "e", duration: 60, musicBackend: "local" },
];

test("totals count paid songs by their estimated or recorded cost and everything else as free", () => {
  assert.deepEqual(auditTotals(songs), { songs: 5, paid: 2, free: 3, seconds: 600, cents: 95, estimatedCents: 95, undated: 1 });
});

test("days run from the first release to today, quiet days included", () => {
  const days = auditPeriods(songs, "day", new Date(2026, 8, 22, 9));
  assert.equal(days.length, 9);
  assert.deepEqual(days.map((day) => day.songs), [2, 0, 1, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual({ paid: days[0].paid, free: days[0].free, cents: days[0].cents }, { paid: 1, free: 1, cents: 45 });
});

test("weeks start on Monday", () => {
  const weeks = auditPeriods(songs, "week", new Date(2026, 8, 22, 9));
  assert.deepEqual(weeks.map((week) => [week.start.getDay(), week.start.getDate(), week.songs, week.cents]), [[1, 14, 3, 45], [1, 21, 1, 50]]);
});

test("an empty or undated catalog has no periods", () => {
  assert.deepEqual(auditPeriods([], "day"), []);
  assert.deepEqual(auditPeriods([{ id: "x" }], "week"), []);
});
