import test from "node:test";
import assert from "node:assert/strict";
import { dehakaAttemptCount, dehakaNextStep, dehakaQuote } from "../assets/dehaka.js";

test("Dehaka rotates bounded quotes and summarizes saved recovery context", () => {
  assert.equal(dehakaQuote(() => 0), "I evolve. I adapt. The queue survives.");
  assert.equal(dehakaQuote(() => 0.999), "I collect context. Then I adapt.");
  assert.equal(dehakaAttemptCount([
    { action: "status", status: "processing" },
    { action: "status", status: "failed" },
    { action: "note" },
    { action: "shepherd" },
  ]), 3);
  assert.match(dehakaNextStep({ recovery: { shepherd: {} } }, true, false), /saved evidence/);
  assert.match(dehakaNextStep({}, false, true), /Add any useful intent/);
});
