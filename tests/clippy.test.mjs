import test from "node:test";
import assert from "node:assert/strict";
import { clippyOptions, clippyMarkup } from "../assets/clippy.js";

test("current failure chooses evidence-based remedies, with at most five options", () => {
  const ids = error => clippyOptions({status: "failed", workerError: error}).map(option => option.id);
  assert.deepEqual(ids("Eleven Music 400 bad_composition_plan"), ["paid-plan", "inspect", "archive"]);
  assert.deepEqual(ids("wordless plan requires lexical words"), ["nonverbal", "inspect", "archive"]);
  assert.deepEqual(ids("one-sample boundary fault"), ["saved-work", "inspect", "archive"]);
  assert.equal(ids("duration wordless vocal ending bad_composition_plan packaging").length, 5);
  assert.deepEqual(ids("unknown fault"), ["inspect", "archive"]);
});

test("song names and past failures do not diagnose the current request", () => {
  const options = clippyOptions({status: "failed", prompt: "Wordless vocal ending", history: [{error: "bad_composition_plan"}]});
  assert.deepEqual(options.map(option => option.id), ["inspect", "archive"]);
  assert.deepEqual(clippyOptions({status: "published"}), []);
  const review = clippyOptions({status: "published", reviewState: "needs_review", result: {validationFailures: ["unfinished_ending", "vocal_dropout"]}});
  assert.deepEqual(review.map(option => option.id), ["vocals", "ending", "inspect", "archive"]);
  assert.match(review.find(option => option.id === "ending").reason, /remained unfinished/);
  assert.match(review.find(option => option.id === "vocals").reason, /still omitted/);
});

test("archive advice follows available controls and active work is disclosed", () => {
  const escape = text => String(text).replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const doc = {id: '"><script>', status: "failed", workerActive: true};
  const html = clippyMarkup(doc, escape, {canArchive: false});
  assert.match(html, /Recovery is still running/);
  assert.match(html, /available status changes/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(clippyMarkup({...doc, workerActive: false}, escape, {canArchive: true}), /Use Archive below/);
  assert.match(clippyMarkup({id: "id", status: "published", reviewState: "needs_review"}, escape), /Use Regenerate above/);
});
