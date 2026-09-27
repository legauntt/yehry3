import test from "node:test";
import assert from "node:assert/strict";
import { POLICY, selectTreatment, sourcePacket, makePrompt, compactSources, estimateCost } from "../scripts/artwork-policy.mjs";
import { songArtworkMarkup } from "../assets/cover-art.js";

test("artwork levels respect votes, listens and the fixed future-pin cutoff", () => {
  assert.equal(selectTreatment({ votes: 0, playCount: 9 }), "basic");
  assert.equal(selectTreatment({ votes: 1, playCount: 0 }), "emphasis");
  assert.equal(selectTreatment({ votes: 0, playCount: 10 }), "emphasis");
  assert.equal(selectTreatment({ votes: 0, playCount: 10 }, null, { lowListens: 25 }), "basic");
  assert.equal(selectTreatment({ pins: 1, artworkPinnedAt: POLICY.freshPinsAfter }), "basic");
  const pinned = { artworkPinnedAt: "2026-09-27T23:00:00Z", pins: 0 };
  assert.equal(selectTreatment(pinned, { treatment: "existing" }), "monument", "unpinning cannot erase a milestone");
  assert.equal(selectTreatment(pinned, { treatment: "monument" }), null, "a completed monument is not regenerated");
  assert.equal(selectTreatment({ votes: 12 }, { treatment: "existing" }), null, "keep supplied covers");
  assert.equal(selectTreatment({ votes: 12 }, { treatment: "basic" }), null, "rerunning preserves generated images");
  assert.equal(selectTreatment({ votes: 1 }, { treatment: "existing" }, { redo: true }), "emphasis");
});

test("full lyrics, original brief and every planner choice reach the prompt losslessly", () => {
  const lyrics = "complete lyric sheet with deliberate contradictions. ".repeat(12);
  const song = { id: "song", title: "Test", lyrics: { text: lyrics, cues: [{ at: 1, text: "first line" }] }, originalPrompt: { idea: "aria", lyricSheet: { text: lyrics }, references: [{ title: "source", summary: "reference evidence" }] }, songPlan: { lyrics, bpm: 72, arrangement: "courtroom scale", musicalSettings: { keyscale: "D minor", instruments: ["piano", "low strings"] } } };
  const packet = sourcePacket(song), compact = compactSources(packet), prompt = makePrompt(packet, "emphasis");
  assert.deepEqual(packet.song.lyrics, song.lyrics);
  assert.deepEqual(packet.song.originalPrompt, song.originalPrompt);
  assert.deepEqual(packet.song.songPlan, song.songPlan);
  assert.deepEqual(packet.missing, []);
  const resolve = value => value?.textRef ? compact.texts[value.textRef] : Array.isArray(value) ? value.map(resolve) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  assert.deepEqual(resolve(compact.sources), packet);
  for (const text of [lyrics, '"bpm":72', '"D minor"', "reference evidence", "courtroom scale", "first line"]) assert.ok(prompt.includes(text));
  assert.equal(prompt.split(lyrics).length, 2, "identical lyrics encoded once, with exact references");
  assert.deepEqual(sourcePacket({ id: "instrumental" }).missing, ["lyrics", "originalPrompt", "songPlan"]);
  assert.ok(estimateCost(prompt, "monument") > estimateCost(prompt, "basic"));
});

test("exclude-pinned overrides redo and monument eligibility and fails closed on missing counts", () => {
  const base = { votes: 2, artworkPinnedAt: "2026-09-27T23:00:00Z" };
  for (const pins of [1, 2, undefined, null, -1, "0"]) {
    assert.equal(selectTreatment({ ...base, pins }, { treatment: "basic" }, { redo: true, excludePinned: true }), null);
  }
  assert.equal(selectTreatment({ pins: 0, votes: 1 }, undefined, { excludePinned: true }), "emphasis");
});

test("Dashboard uses saved raster covers and a safe sleeve while artwork is pending", () => {
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const unknown = songArtworkMarkup({ id: "missing", title: '<img onerror="bad">' }, escape);
  assert.ok(unknown.includes("track-art-pending"));
  assert.ok(!unknown.includes("<img onerror"));
  assert.ok(!unknown.includes("svg"));
  const cover = songArtworkMarkup({ id: "distonyc-06d2b8c3c8dffed19df347bb", votes: 99 }, escape);
  assert.match(cover, /src="\/assets\/artwork\/.+\.webp"/);
  assert.ok(!cover.includes("data-art-tier"));
});
