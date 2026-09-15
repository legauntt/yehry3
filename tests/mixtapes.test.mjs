import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTape, encodeTape, decodeTape, validateTape, tapeDuration } from "../assets/mixtape-data.js";

test("mixtape links round-trip Unicode names and repeat tracks without accepting extra fields", () => {
  const tape = { ...emptyTape(), name: "Jesse’s 夜 mix 🎶", a: ["song-one", "song-one"], b: ["song-two"] };
  assert.deepEqual(decodeTape(encodeTape({ ...tape, url: "javascript:alert(1)" })), tape);
});
test("mixtape links reject malformed, oversized and unsupported payloads", () => {
  for (const value of [null, { ...emptyTape(), v: 2 }, { ...emptyTape(), name: "a".repeat(81) },
    { ...emptyTape(), color: "url(evil)" }, { ...emptyTape(), a: ["../private"] },
    { ...emptyTape(), a: Array(41).fill("song") }]) assert.throws(() => validateTape(value));
  for (const value of ["", "%", "x".repeat(9001), "e30"]) assert.throws(() => decodeTape(value));
  assert.equal(tapeDuration(["one", "missing"], new Map([["one", { duration: 75 }]])), "1:15 + unknown time");
});
