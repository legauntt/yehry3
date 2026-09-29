import test from "node:test";
import assert from "node:assert/strict";
import { POLICY, selectTreatment, sourcePacket, makePrompt, compactSources, estimateCost } from "../scripts/artwork-policy.mjs";
import { songArtworkMarkup } from "../assets/cover-art.js";

test("artwork levels respect votes, listens and the fixed future-pin cutoff", () => {
  assert.equal(selectTreatment({ votes: 0, playCount: 9 }), "basic");
  assert.equal(selectTreatment({ votes: 1, playCount: 0 }), "emphasis");
  assert.equal(selectTreatment({ votes: 0, playCount: 10 }), "emphasis");
  assert.equal(selectTreatment({ votes: 0, playCount: 10 }, null, { lowListens: 25 }), "basic");
  assert.equal(selectTreatment({ adminPinned: true, artworkPinnedAt: POLICY.freshPinsAfter }), "basic");
  const pinned = { artworkPinnedAt: "2026-09-27T23:00:00Z", adminPinned: false };
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

test("exclude-pinned overrides redo and monument eligibility and fails closed on missing status", () => {
  const base = { votes: 2, artworkPinnedAt: "2026-09-27T23:00:00Z" };
  for (const adminPinned of [true, undefined, null, 1, "false"]) {
    assert.equal(selectTreatment({ ...base, adminPinned }, { treatment: "basic" }, { redo: true, excludePinned: true }), null);
  }
  assert.equal(selectTreatment({ adminPinned: false, votes: 1 }, undefined, { excludePinned: true }), "emphasis");
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

test("new-song lifecycle matures once after 24 hours and preserves finished and pinned covers", () => {
  const firstSeenAt = "2026-09-28T01:00:00Z";
  const song = { adminPinned: false, votes: 20 };
  const options = { lifecycle: true, firstSeenAt, now: Date.parse(firstSeenAt), incubationHours: 24 };
  assert.equal(selectTreatment(song, null, options), "incubating", "early votes do not trigger expensive art during incubation");
  const early = { treatment: "incubating", firstSeenAt };
  assert.equal(selectTreatment(song, early, { ...options, now: options.now + 86399999 }), null);
  assert.equal(selectTreatment(song, early, { ...options, now: options.now + 86400000 }), "mature");
  assert.equal(selectTreatment(song, null, { ...options, now: options.now + 86400000 }), "mature", "a missed first pass goes directly to mature");
  for (const treatment of ["basic", "emphasis", "mature", "monument", "existing"])
    assert.equal(selectTreatment(song, { treatment }, { ...options, now: options.now + 86400000 }), null);
  for (const adminPinned of [true, undefined, null, "false"])
    assert.equal(selectTreatment({ ...song, adminPinned }, early, { ...options, now: options.now + 86400000 }), null);
  assert.equal(selectTreatment(song, early, { ...options, firstSeenAt: "2026-09-29T01:00:00Z", now: options.now + 86400000 }), "mature", "saved first observation survives a local observation reset");
});
