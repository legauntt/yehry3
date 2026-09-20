import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTape, encodeTape, decodeTape, validateTape, tapeDuration, tapeHref } from "../assets/mixtape-data.js";
import { artImage, drawClipart } from "../assets/tape-art.js";
import { sideInk } from "../assets/tape-handwriting.js";

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

test("a new tape is empty, labels are drawn, and clipart is a bounded picture of numbers that older tapes lack", () => {
  const blank = emptyTape();
  assert.deepEqual([blank.name, blank.a, blank.b], ["", [], []]);
  assert.deepEqual(blank.labels, { a: { text: "", ink: [] }, b: { text: "", ink: [] } });
  // Publishing a nameless tape gives it the default name; typed text is optional legacy data.
  const art = { flip: 1, theme: "ghost", seed: 4000000000, palette: 3 };
  const drawn = validateTape({ ...blank, a: ["one"], labels: { a: { ink: [[[0, 0]]], art }, b: { ink: [] } } });
  assert.equal(drawn.name, "My Tony C mixtape");
  // Keys come back in a fixed order so equal pictures make equal tapes.
  assert.deepEqual(Object.keys(drawn.labels.a.art), ["seed", "theme", "palette", "flip"]);
  assert.deepEqual(drawn.labels.a, { text: "", ink: [[[0, 0]]], art: { seed: 4000000000, theme: "ghost", palette: 3, flip: 1 } });
  assert.deepEqual(decodeTape(encodeTape(drawn)), drawn);
  for (const bad of ["star", "<svg onload=x>", 7, null, [], {}, { theme: "ghost" }, { seed: -1 }, { seed: 4294967296 }, { seed: 1.5 }, { seed: 1, theme: "Ghost" },
    { seed: 1, palette: 64 }, { seed: 1, tilt: "3" }, { seed: 1, src: "javascript:alert(1)" }])
    assert.throws(() => validateTape({ ...blank, a: ["one"], labels: { a: { ink: [], art: bad }, b: { ink: [] } } }));
});

test("clipart is drawn from words with the song covers' generator, per side, and never carries markup", () => {
  const one = drawClipart("a", "a robot in sunglasses, blue");
  assert.ok(Number.isInteger(one.art.seed));
  assert.equal(one.art.theme, "robot");
  assert.ok(one.understood.length >= 2);
  assert.doesNotThrow(() => validateTape({ ...emptyTape(), a: ["one"], labels: { a: { ink: [], art: one.art }, b: { ink: [] } } }));
  assert.deepEqual(drawClipart("a", "a robot in sunglasses, blue"), one);
  assert.notDeepEqual(drawClipart("a", "a robot in sunglasses, blue", 1).art, one.art);
  assert.notDeepEqual(drawClipart("b", "a robot in sunglasses, blue").art, one.art);
  assert.ok(Number.isInteger(drawClipart("a", "  ").art.seed));
  const image = artImage("a", { seed: 1 });
  assert.match(image, /^<img class="tape-art" src="data:image\/svg\+xml,/);
  assert.match(image, /alt="Side A clipart\./);
  assert.match(artImage("b", { seed: 1 }, true), /alt=""/);
  assert.equal(artImage("a", undefined), "");
  const hostile = drawClipart("a", '"><script>alert(1)</script>');
  assert.doesNotMatch(artImage("a", hostile.art), /<script|"><|onerror/i);
});

test("the pre-drawn Side A and Side B lettering fits the label and the shared handwriting limits", () => {
  for (const side of ["a", "b"]) {
    const ink = sideInk(side);
    assert.ok(ink.length > 4 && ink.length <= 60);
    assert.ok(ink.flat().length <= 1200);
    assert.doesNotThrow(() => validateTape({ ...emptyTape(), a: ["one"], labels: { a: { text: "", ink }, b: { text: "", ink: [] } } }));
    const xs = ink.flat().map(([x]) => x);
    assert.ok(Math.min(...xs) > 100 && Math.max(...xs) < 900);
  }
  assert.notDeepEqual(sideInk("a"), sideInk("b"));
});
