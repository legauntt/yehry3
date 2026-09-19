import test from "node:test";
import assert from "node:assert/strict";
import { lyricPassage, singableLines } from "../assets/record-lyrics.js";

test("record singer keeps lyric lines and removes section markers and fragments", () => {
  assert.deepEqual(singableLines("[Verse]\nA full lyric line walks into the night\nToo short\n[Chorus]\nAnother real song line comes rolling home"), [
    "A full lyric line walks into the night",
    "Another real song line comes rolling home",
  ]);
});

test("record singer varies between the single-line baseline and viewport-sized passages", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `Lyric line ${index + 1}`);
  assert.deepEqual(lyricPassage(lines, () => 0, { width: 1280, height: 900 }), ["Lyric line 1"]);
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 1280, height: 900 }), lines.slice(4, 12));
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 390, height: 844 }), lines.slice(8, 12));
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 390, height: 560 }), ["Lyric line 12"]);
});
