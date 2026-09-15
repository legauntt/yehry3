import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTape, encodeTape, decodeTape, validateTape, tapeDuration, tapeHref } from "../assets/mixtape-data.js";

test("mixtape links round-trip Unicode names and repeat tracks without accepting extra fields", () => {
  const tape = { ...emptyTape(), name: "Jesse’s 夜 mix 🎶", a: ["song-one", "song-one"], b: ["song-two"] };
  assert.deepEqual(decodeTape(encodeTape({ ...tape, url: "javascript:alert(1)" })), tape);
});
test("mixtape links reject malformed, oversized and unsupported payloads", () => {
  for (const value of [null, { ...emptyTape(), v: 3 }, { ...emptyTape(), name: "a".repeat(81) },
    { ...emptyTape(), color: "url(evil)" }, { ...emptyTape(), a: ["../private"] },
    { ...emptyTape(), a: Array(41).fill("song") }]) assert.throws(() => validateTape(value));
  for (const value of ["", "%", "x".repeat(9001), "e30"]) assert.throws(() => decodeTape(value));
  assert.equal(tapeDuration(["one", "missing"], new Map([["one", { duration: 75 }]])), "1:15 + unknown time");
});

test("old drafts and links gain independent labels; handwriting stays bounded and URLs contain only an ID", () => {
  const old = { v: 1, name: "Old tape", color: "green", a: ["one"], b: [] };
  const encoded = Buffer.from(JSON.stringify(old)).toString("base64url");
  const upgraded = decodeTape(encoded);
  assert.equal(upgraded.v, 2);
  assert.deepEqual(upgraded.labels, { a: { text: "", ink: [] }, b: { text: "", ink: [] } });
  upgraded.labels.a.text = "Opening act";
  upgraded.labels.b.ink = [[[0, 0], [1000, 240]]];
  assert.deepEqual(decodeTape(encodeTape(upgraded)), upgraded);
  for (const ink of ["svg", [[]], [[[Infinity, 0]]], [[[1001, 0]]], [[[0, 241]]], [Array(1201).fill([0, 0])]]) {
    assert.throws(() => validateTape({ ...upgraded, labels: { ...upgraded.labels, a: { text: "", ink } } }));
  }
  assert.equal(tapeHref("aBcD_efG-123"), "/mixtapes/aBcD_efG-123");
  assert.throws(() => tapeHref("../private"));
});
