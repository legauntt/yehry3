import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eggClips, eggWeight, pickEggMoment, songMoments } from "../assets/egg-clips.js";

const song = (over = {}) => ({
  id: "a-1",
  title: "A",
  url: "https://example.test/a.mp3",
  lyrics: {
    text: "[Verse]\nfirst line sung\nsecond line sung\n\n[Chorus]\nthird line sung\nfourth line sung",
    cues: [
      { line: 1, start: 2, end: 3.5 },
      { line: 2, start: 3.9, end: 6 },
      { line: 5, start: 20, end: 24.44 },
      { line: 6, start: 40, end: 40.5 },
      { line: 4, start: 10, end: 12 },
    ],
  },
  ...over,
});

test("moments are runs of sung lines, never headings or slivers", () => {
  assert.deepEqual(songMoments(song()), {
    lines: [[2, 3.5, "first line sung"], [3.9, 6, "second line sung"], [20, 24.4, "third line sung"]],
    // The first two lines run together; the third is too far on to join them.
    moments: [[0, 1], [1, 1], [2, 2]],
  });
  assert.deepEqual(songMoments({}), { lines: [], moments: [] });
});

test("moments run from two seconds to nineteen and never bridge a long break", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
  const cues = Array.from({ length: 12 }, (_, index) => ({ line: index, start: index * 2, end: index * 2 + 1.8 }));
  const { lines: sung, moments } = songMoments({ lyrics: { text: lines, cues } });
  const lengths = moments.map(([first, last]) => sung[last][1] - sung[first][0]);
  assert.ok(Math.min(...lengths) >= 2 && Math.max(...lengths) <= 19);
  assert.ok(Math.max(...lengths) > 15 && Math.min(...lengths) < 4, lengths.join());
  // A gap of a few seconds keeps the lines on either side apart.
  const apart = songMoments({ lyrics: { text: "a\nb", cues: [{ line: 0, start: 0, end: 2.5 }, { line: 1, start: 6, end: 8.5 }] } });
  assert.deepEqual(apart.moments, [[0, 0], [1, 1]]);
  // A line too long for any moment is left out.
  assert.deepEqual(songMoments({ lyrics: { text: "a", cues: [{ line: 0, start: 0, end: 20 }] } }).lines, []);
});

test("recordings with quality issues or no audio stay out of the egg", () => {
  const clips = eggClips([song(), song({ id: "b", qualityIssues: [{ code: "x" }] }), song({ id: "c", url: "" }), song({ id: "d", lyrics: { text: "x" } })]);
  assert.deepEqual(clips.map((clip) => clip.id), ["a-1"]);
});

test("a pick avoids the previous song when it can", () => {
  const clips = [
    { id: "a", title: "A", url: "/a", lines: [[1, 4, "one"]], moments: [[0, 0]] },
    { id: "b", title: "B", url: "/b", lines: [[2, 5, "two"], [6, 9, "three"]], moments: [[0, 0], [0, 1]] },
  ];
  assert.deepEqual(pickEggMoment(clips, () => 0, "a"), { id: "b", title: "B", url: "/b", start: 2, end: 5, lines: [{ start: 2, end: 5, words: "two" }] });
  // A longer moment carries every line it sings, so the caption can follow along.
  assert.deepEqual(pickEggMoment(clips, () => 0.9, "a"), { id: "b", title: "B", url: "/b", start: 2, end: 9, lines: [{ start: 2, end: 5, words: "two" }, { start: 6, end: 9, words: "three" }] });
  assert.equal(pickEggMoment(clips.slice(0, 1), () => 0.9, "a").id, "a");
  assert.equal(pickEggMoment([], () => 0), null);
});

const now = Date.parse("2026-09-20T12:00:00Z");
const daysAgo = (days) => new Date(now - days * 864e5).toISOString();

test("the build carries each recording's release time", () => {
  assert.equal(eggClips([song({ publishedAt: daysAgo(2) })])[0].publishedAt, daysAgo(2));
  assert.equal(eggClips([song()])[0].publishedAt, null);
});

test("upvoted and recent songs weigh far more than old unloved ones", () => {
  const old = eggWeight({ publishedAt: daysAgo(90) }, 0, now);
  assert.ok(old > 0 && old < 0.2);
  assert.ok(eggWeight({ publishedAt: daysAgo(1) }, 0, now) > 50 * old);
  assert.ok(eggWeight({ publishedAt: daysAgo(90) }, 5, now) > 50 * old);
  assert.ok(eggWeight({ publishedAt: daysAgo(1) }, 0, now) > eggWeight({ publishedAt: daysAgo(14) }, 0, now));
  assert.ok(eggWeight({ publishedAt: daysAgo(90) }, 8, now) > eggWeight({ publishedAt: daysAgo(90) }, 2, now));
  // Missing or junk release times and votes fall back to the floor rather than throwing.
  assert.equal(eggWeight({}, undefined, now), eggWeight({ publishedAt: "soon" }, -3, now));
  assert.equal(eggWeight({ publishedAt: daysAgo(-5) }, 0, now), eggWeight({ publishedAt: daysAgo(0) }, 0, now));
  assert.equal(eggWeight({}, 500, now), eggWeight({}, 10, now));
});

test("picks follow the weights but every song stays possible", () => {
  const clips = ["old", "loved", "new"].map((id) => ({ id, title: id, url: `/${id}`, lines: [[1, 4, id]], moments: [[0, 0]] }));
  const weights = { old: 1, loved: 6, new: 3 };
  const at = (random) => pickEggMoment(clips, () => random, null, (clip) => weights[clip.id]).id;
  assert.deepEqual([0, 0.09, 0.1, 0.69, 0.7, 0.99].map(at), ["old", "old", "loved", "loved", "new", "new"]);
  // Every weight zero still picks something, and the previous song is still avoided.
  assert.equal(pickEggMoment(clips, () => 0.5, null, () => 0).id, "loved");
  assert.equal(pickEggMoment(clips, () => 0, "old", (clip) => weights[clip.id]).id, "loved");
});

test("the build publishes moments that fit inside each recording", async () => {
  const { clips } = JSON.parse(await readFile(new URL("../dist/egg-clips.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../dist/catalog-summary.json", import.meta.url), "utf8")).songs;
  assert.ok(clips.length > 20);
  for (const clip of clips) {
    const { duration } = catalog.find((entry) => entry.id === clip.id);
    for (const [first, last] of clip.moments) {
      const start = clip.lines[first][0], end = clip.lines[last][1];
      assert.ok(start >= 0 && end - start >= 2 && end - start <= 19.1 && end <= Number(duration) + 0.5, `${clip.id} ${start}-${end} of ${duration}`);
    }
    for (const [start, end, words] of clip.lines) assert.ok(end > start && words, `${clip.id} line at ${start}`);
  }
});
