import test from "node:test";
import assert from "node:assert/strict";
import { lyricPassage, pickRecordSong, recordLyricCandidates, singableLines } from "../assets/record-lyrics.js";

test("record singer keeps lyric lines and removes section markers and fragments", () => {
  assert.deepEqual(singableLines("[Verse]\nA full lyric line walks into the night\nToo short\n[Chorus]\nAnother real song line comes rolling home"), [
    "A full lyric line walks into the night",
    "Another real song line comes rolling home",
  ]);
});

test("record singer varies between the single-line baseline and viewport-sized passages", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `Lyric line ${index + 1}`);
  assert.deepEqual(lyricPassage(lines, () => 0, { width: 1280, height: 900 }), ["Lyric line 1"]);
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 1280, height: 900 }), lines.slice(4, 12));
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 390, height: 844 }), lines.slice(8, 12));
  assert.deepEqual(lyricPassage(lines, () => .999, { width: 390, height: 560 }), ["Lyric line 12"]);
});

test("record lyric songs are limited to liked songs and releases under three days old", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const song = (id, votes, age, lyrics = true) => ({
    id,
    votes,
    hasLyrics: lyrics,
    publishedAt: new Date(now - age).toISOString(),
  });
  const candidates = recordLyricCandidates([
    song("liked-old", 1, 30 * 24 * 60 * 60 * 1000),
    song("fresh-unliked", 0, 3 * 24 * 60 * 60 * 1000 - 1),
    song("exactly-three-days", 0, 3 * 24 * 60 * 60 * 1000),
    song("old-unliked", 0, 4 * 24 * 60 * 60 * 1000),
    song("liked-without-lyrics", 20, 0, false),
  ], now);
  assert.deepEqual(candidates.map(({ id }) => id), ["liked-old", "fresh-unliked"]);
});

test("record lyric selection gives the top liked song a modest weight boost", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const songs = [
    { id: "fresh", votes: 0, hasLyrics: true, publishedAt: new Date(now - 60_000).toISOString() },
    { id: "top-liked", votes: 20, hasLyrics: true, publishedAt: "2020-01-01T00:00:00Z" },
  ];
  assert.equal(pickRecordSong(songs, () => 0.39, now).id, "fresh");
  assert.equal(pickRecordSong(songs, () => 0.41, now).id, "top-liked");
});
