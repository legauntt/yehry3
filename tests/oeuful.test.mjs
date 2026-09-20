import assert from "node:assert/strict";
import test from "node:test";
import { createPicker } from "../oeuful/crate.js";

const clip = (id, moments = [[0, 0]]) => ({ id, title: "Song " + id, url: "https://example.test/" + id + ".mp3", lines: [[10, 14, "first"], [14.5, 18, "second"]], moments });
// A repeatable stand-in for Math.random.
const dice = (seed = 7) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("Œuful never runs dry and rests a song before playing it again", () => {
  const clips = Array.from({ length: 20 }, (_, index) => clip("s" + index));
  const next = createPicker(clips, dice());
  const played = Array.from({ length: 400 }, () => next().id);
  for (let index = 0; index < played.length; index += 1)
    assert.ok(!played.slice(Math.max(0, index - 12), index).includes(played[index]), "A song came back within twelve records");
  assert.equal(new Set(played).size, 20, "Every song gets a turn");
});

test("Œuful hands the booth a moment with its start, end and sung lines", () => {
  const moment = createPicker([clip("only", [[0, 1]])], dice())();
  assert.deepEqual(moment, { id: "only", title: "Song only", url: "https://example.test/only.mp3", start: 10, end: 18, lines: [{ start: 10, end: 14, words: "first" }, { start: 14.5, end: 18, words: "second" }] });
});

test("Œuful keeps going with a tiny collection and stops cleanly with none", () => {
  const solo = createPicker([clip("a")], dice());
  assert.deepEqual([solo().id, solo().id, solo().id], ["a", "a", "a"]);
  const pair = createPicker([clip("a"), clip("b")], dice());
  const turns = Array.from({ length: 10 }, () => pair().id);
  for (let index = 1; index < turns.length; index += 1) assert.notEqual(turns[index], turns[index - 1]);
  assert.equal(createPicker([], dice())(), null);
  assert.equal(createPicker([{ id: "no-moments", url: "x", moments: [] }], dice())(), null);
});
