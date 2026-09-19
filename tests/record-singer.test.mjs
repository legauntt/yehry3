import test from "node:test";
import assert from "node:assert/strict";
import { singableLines } from "../assets/record-lyrics.js";

test("record singer keeps lyric lines and removes section markers and fragments", () => {
  assert.deepEqual(singableLines("[Verse]\nA full lyric line walks into the night\nToo short\n[Chorus]\nAnother real song line comes rolling home"), [
    "A full lyric line walks into the night",
    "Another real song line comes rolling home",
  ]);
});
