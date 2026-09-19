import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { songArtwork, songArtworkMarkup, voteTier } from "../assets/song-art.js";
import { songSummary } from "../assets/song-summary.js";

const catalog = async () => JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8")).songs;
const svgOf = art => decodeURIComponent(art.src.split(",")[1]);

test("every published recording gets distinct, stable artwork using compact metadata", async () => {
  const songs = await catalog();
  const images = songs.map(song => songArtwork(song));
  assert.equal(new Set(images.map(art => art.src)).size, songs.length);
  for (const song of songs) {
    const full = songArtwork(song), summary = songArtwork(songSummary(song));
    assert.deepEqual(full, summary);
    assert.match(full.alt, /^Silly clip art: /);
    assert.match(decodeURIComponent(full.src), /viewBox="0 0 240 200"/);
  }
});
test("recognizable title subjects receive matching illustrations", () => {
  for (const [title, expected] of [
    ["Arbys at Eleven", ["burger"]], ["The Save File Has Teeth", ["save"]],
    ["The Book of Parallel Cs", ["book"]], ["Medusa", ["snake"]],
    // Several subjects in one title share the spotlight between recordings.
    ["Blood on My Shoes at Daybreak", ["shoe", "sun"]], ["The Midnight Chrome Express", ["train", "car", "moon"]],
    ["Round and Round (Acoustic)", ["donut", "guitar"]],
  ]) {
    const seen = new Set(Array.from({ length: 40 }, (_, index) => songArtwork({ id: title + index, title }).theme));
    assert.deepEqual([...seen].sort(), [...expected].sort(), title);
  }
});
test("the catalog no longer leans on one fallback or one drawing per remix family", async () => {
  const songs = await catalog();
  const counts = new Map();
  for (const song of songs) counts.set(songArtwork(song).theme, (counts.get(songArtwork(song).theme) || 0) + 1);
  // The old first-match picker put 19 of 183 songs on the record and used 43 drawings.
  assert.ok(Math.max(...counts.values()) <= Math.ceil(songs.length * 0.07), "one drawing dominates: " + JSON.stringify([...counts]));
  assert.ok(counts.size >= 45);
  // Recordings that share a title still differ in more than color.
  const looks = Array.from({ length: 12 }, (_, index) => svgOf(songArtwork({ id: "untitled-" + index, title: "Untitled" })).replace(/#[0-9a-f]{6}/g, ""));
  assert.equal(new Set(looks).size, looks.length);
  assert.ok(new Set(Array.from({ length: 40 }, (_, index) => songArtwork({ id: "plain-" + index, title: "Untitled" }).theme)).size >= 6);
});
test("upvoted songs switch to distinct award art at 1, 3, 5, and 7 votes", async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 40, -2, "3", null, undefined, NaN].map(votes => voteTier(votes)?.votes || 0), [0, 1, 1, 3, 3, 5, 5, 7, 7, 0, 3, 0, 0, 0]);
  const regular = new Set(["record", ...(await catalog()).map(song => songArtwork(song).theme)]);
  const casts = new Map(), backgrounds = new Map();
  for (const votes of [1, 3, 5, 7]) for (let index = 0; index < 40; index++) {
    const song = { id: "loved-" + index, title: "Round and Round " + index };
    const art = songArtwork({ ...song, votes }), plain = songArtwork(song);
    assert.equal(art.tier, votes);
    assert.equal(plain.tier, 0);
    assert.notEqual(art.src, plain.src);
    assert.ok(!regular.has(art.theme), art.theme + " is also regular art");
    assert.match(art.alt, /^Silly clip art: /);
    casts.set(votes, (casts.get(votes) || new Set()).add(art.theme));
    backgrounds.set(votes, (backgrounds.get(votes) || new Set()).add(svgOf(art).match(/<rect width="240" height="200" fill="(#[0-9a-f]{6})"/)[1]));
    // One heart per tier reached, and the votes inside a tier do not reshuffle the art.
    assert.equal(svgOf(art).split('scale(.85)" d="M10 18').length - 1, [1, 3, 5, 7].indexOf(votes) + 1);
    assert.equal(songArtwork({ ...song, votes: votes + 1 }).src, art.src);
    // The grid view's track number sits on the top-left corner of the art.
    for (const [, x] of svgOf(art).matchAll(/translate\((\d+) 11\) scale\(\.85\)/g)) assert.ok(Number(x) > 120, "tier hearts would hide under the track number");
  }
  const all = [...casts.values()].flatMap(cast => [...cast]);
  assert.equal(new Set(all).size, all.length, "tiers share a mascot");
  for (const cast of casts.values()) assert.ok(cast.size >= 2);
  const colors = [...backgrounds.values()].flatMap(set => [...set]);
  assert.equal(new Set(colors).size, colors.length, "tiers share a background");
  assert.match(songArtworkMarkup({ id: "a", title: "A", votes: 5 }, value => value), /data-art-tier="5"/);
  assert.doesNotMatch(songArtworkMarkup({ id: "a", title: "A", votes: 0 }, value => value), /data-art-tier/);
});
test("new and unusual titles are safe and do not need lyrics or remote image URLs", () => {
  const hostile = '<script>alert("hi")</script><image href="https://example.com/track"/>';
  for (const votes of [0, 7]) {
    const art = songArtwork({ id: hostile, title: hostile, votes });
    assert.doesNotMatch(svgOf(art), /script|https:|href=|onload=/);
  }
  assert.notEqual(songArtwork({ id: "one", title: "Untitled" }).src, songArtwork({ id: "two", title: "Untitled" }).src);
  assert.ok(songArtwork({}).src.startsWith("data:image/svg+xml,"));
});
