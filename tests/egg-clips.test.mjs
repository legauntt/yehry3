import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eggClips, pickEggMoment, songMoments } from "../assets/egg-clips.js";

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

test("moments are sung lines, joined when short, never headings or slivers", () => {
  assert.deepEqual(songMoments(song()), [[2, 6], [3.9, 6], [20, 24.4]]);
  assert.deepEqual(songMoments({}), []);
});

test("recordings with quality issues or no audio stay out of the egg", () => {
  const clips = eggClips([song(), song({ id: "b", qualityIssues: [{ code: "x" }] }), song({ id: "c", url: "" }), song({ id: "d", lyrics: { text: "x" } })]);
  assert.deepEqual(clips.map((clip) => clip.id), ["a-1"]);
});

test("a pick avoids the previous song when it can", () => {
  const clips = [{ id: "a", title: "A", url: "/a", moments: [[1, 4]] }, { id: "b", title: "B", url: "/b", moments: [[2, 5], [6, 9]] }];
  assert.deepEqual(pickEggMoment(clips, () => 0, "a"), { id: "b", title: "B", url: "/b", start: 2, end: 5 });
  assert.equal(pickEggMoment(clips.slice(0, 1), () => 0.9, "a").id, "a");
  assert.equal(pickEggMoment([], () => 0), null);
});

test("the build publishes moments that fit inside each recording", async () => {
  const { clips } = JSON.parse(await readFile(new URL("../dist/egg-clips.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../dist/catalog-summary.json", import.meta.url), "utf8")).songs;
  assert.ok(clips.length > 20);
  for (const clip of clips) {
    const { duration } = catalog.find((entry) => entry.id === clip.id);
    for (const [start, end] of clip.moments) assert.ok(start >= 0 && end > start && end - start <= 7.1 && end <= Number(duration) + 0.5, `${clip.id} ${start}-${end} of ${duration}`);
  }
});
