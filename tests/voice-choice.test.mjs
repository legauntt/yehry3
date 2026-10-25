import { test } from "node:test";
import assert from "node:assert/strict";
import { startingVoice, usesGeneration, startingEpoch, rememberedEpoch, rememberEpoch } from "../assets/voice-choice.js";

test("V9 epochs prefer a saved request, then the last offered browser pick", () => {
  const epochs = [10, 110, 150, 300];
  assert.equal(startingEpoch({ saved: '110', remembered: 150, epochs }), 110);
  assert.equal(startingEpoch({ remembered: 150, epochs }), 150);
  assert.equal(startingEpoch({ remembered: 999, epochs }), 300);
  assert.equal(startingEpoch({ remembered: 150, epochs: [10, 110], defaultEpoch: 110 }), 110);
});

test("epoch preference tolerates blocked browser storage", () => {
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(rememberedEpoch(), null);
    assert.doesNotThrow(() => rememberEpoch(150));
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

const models = (...ids) => ids.map((id) => ({ id }));
const all = models("v6", "v7", "v8", "v9");

test("a new request starts on the newest voice on offer", () => {
  assert.equal(startingVoice({ models: all, generationAvailable: true }), "v9");
  assert.equal(startingVoice({ models: models("v6", "v7", "v8"), generationAvailable: true }), "v8");
  assert.equal(startingVoice({ models: models("v6", "v7"), generationAvailable: true }), "v7");
  assert.equal(startingVoice({ models: models("v6"), generationAvailable: true }), "v6");
});

test("V8 and V9 are not a default while V8 song generation is unavailable", () => {
  assert.ok(usesGeneration("v8") && usesGeneration("v9") && !usesGeneration("v7"));
  assert.equal(startingVoice({ models: all, generationAvailable: false }), "v7");
  assert.equal(startingVoice({ remembered: "v9", models: all, generationAvailable: false }), "v7");
});

test("this browser's last pick beats the default, and the request's own saved voice beats both", () => {
  assert.equal(startingVoice({ remembered: "v6", models: all, generationAvailable: true }), "v6");
  assert.equal(startingVoice({ saved: "v7", remembered: "v6", models: all, generationAvailable: true }), "v7");
  // A saved voice that is switched off stays selected; the form shows it as temporarily unavailable.
  assert.equal(startingVoice({ saved: "v9", models: models("v6", "v7"), generationAvailable: true }), "v9");
});

test("a remembered voice that is no longer offered falls back to the default", () => {
  assert.equal(startingVoice({ remembered: "v9", models: models("v6", "v7", "v8"), generationAvailable: true }), "v8");
  assert.equal(startingVoice({ remembered: "nonsense", models: all, generationAvailable: true }), "v9");
});

test("VDB is remembered and restores on its own draft without changing the site default", () => {
  assert.equal(startingVoice({ remembered: "vdb", models: models(...all.map(model => model.id), "vdb"), generationAvailable: false }), "vdb");
  assert.equal(startingVoice({ saved: "vdb", models: all, generationAvailable: true }), "vdb");
  assert.equal(usesGeneration("vdb"), false);
});
