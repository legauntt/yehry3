import { test } from "node:test";
import assert from "node:assert/strict";
import { startingVoice, usesGeneration } from "../assets/voice-choice.js";

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
