import assert from "node:assert/strict";
import test from "node:test";
import { crateWeight, createPicker } from "../oeuful/crate.js";

const clip = (id, moments = [[0, 0]]) => ({ id, title: "Song " + id, url: "https://example.test/" + id + ".mp3", lines: [[10, 14, "first"], [14.5, 18, "second"]], moments });
// A repeatable stand-in for Math.random.
const dice = (seed = 7) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("Œuful never runs dry and rests a song before playing it again", () => {
  const clips = Array.from({ length: 20 }, (_, index) => clip("s" + index));
  const next = createPicker(clips, { random: dice() });
  const played = Array.from({ length: 400 }, () => next().id);
  for (let index = 0; index < played.length; index += 1)
    assert.ok(!played.slice(Math.max(0, index - 12), index).includes(played[index]), "A song came back within twelve records");
  assert.equal(new Set(played).size, 20, "Every song gets a turn");
});

test("Œuful hands the booth a moment with its start, end and sung lines", () => {
  const moment = createPicker([clip("only", [[0, 1]])], { random: dice() })();
  assert.deepEqual(moment, { id: "only", title: "Song only", url: "https://example.test/only.mp3", start: 10, end: 18, lines: [{ start: 10, end: 14, words: "first" }, { start: 14.5, end: 18, words: "second" }] });
});

test("Œuful keeps going with a tiny collection and stops cleanly with none", () => {
  const solo = createPicker([clip("a")], { random: dice() });
  assert.deepEqual([solo().id, solo().id, solo().id], ["a", "a", "a"]);
  const pair = createPicker([clip("a"), clip("b")], { random: dice() });
  const turns = Array.from({ length: 10 }, () => pair().id);
  for (let index = 1; index < turns.length; index += 1) assert.notEqual(turns[index], turns[index - 1]);
  assert.equal(createPicker([], { random: dice() })(), null);
  assert.equal(createPicker([{ id: "no-moments", url: "x", moments: [] }], { random: dice() })(), null);
});

test("Œuful plays liked and listened-to songs more often without losing the rest", () => {
  assert.equal(crateWeight(undefined), 1);
  assert.equal(crateWeight({ votes: 2 }), 4);
  assert.equal(crateWeight({ votes: 50 }), 16, "Votes stop counting at ten");
  assert.equal(crateWeight({ playCount: 3 }), 3);
  assert.equal(crateWeight({ votes: 1, downvotes: 3, playCount: 1 }), 2 / 3);
  const songs = new Map([["s0", { votes: 8, playCount: 14 }], ["s1", { playCount: 23 }], ["s2", { downvotes: 2 }]]);
  const next = createPicker(Array.from({ length: 30 }, (_, index) => clip("s" + index)), { random: dice(), weightOf: (picked) => crateWeight(songs.get(picked.id)) });
  const turns = new Map();
  for (let index = 0; index < 3000; index += 1) {
    const { id } = next();
    turns.set(id, (turns.get(id) || 0) + 1);
  }
  assert.equal(turns.size, 30, "Every song still gets a turn");
  const plain = (3000 - turns.get("s0") - turns.get("s1") - turns.get("s2")) / 27;
  assert.ok(turns.get("s0") > 2 * plain, "A liked song comes up more");
  assert.ok(turns.get("s1") > 1.5 * plain, "So does one that is listened to a lot");
  assert.ok(turns.get("s2") < plain / 2, "A disliked song is held back");
});

test("Œuful cuts its sides to the length the listener asks for", () => {
  // Twelve three-second lines, half a second apart.
  const lines = Array.from({ length: 12 }, (_, index) => [10 + index * 3.5, 13 + index * 3.5, "line " + index]);
  let seconds = 8;
  const next = createPicker([{ id: "long", title: "Long", url: "https://example.test/long.mp3", lines, moments: [[0, 0]] }], { random: dice(), ceiling: () => seconds });
  const lengths = (count) => Array.from({ length: count }, () => next()).map((moment) => moment.end - moment.start);
  for (const length of lengths(40)) assert.equal(length, 6.5, "Two lines fit under eight seconds, and one alone is too short to be preferred");
  seconds = 20;
  const longer = lengths(40);
  for (const length of longer) assert.ok(length >= 10 && length <= 20, "Got " + length);
  assert.ok(longer.includes(17));
  // Nothing fits under two and a half seconds, so the clip's own moments stand in.
  seconds = 2.5;
  assert.deepEqual(lengths(3), [3, 3, 3]);
});
