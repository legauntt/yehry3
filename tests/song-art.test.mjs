import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { songArtwork } from "../assets/song-art.js";
import { songSummary } from "../assets/song-summary.js";

test("every published recording gets distinct, stable artwork using compact metadata", async () => {
  const { songs } = JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8"));
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
    ["Arbys at Eleven", "burger"], ["The Save File Has Teeth", "save"],
    ["The Book of Parallel Cs", "book"], ["Medusa", "snake"],
    ["Blood on My Shoes at Daybreak", "shoe"], ["The Midnight Chrome Express", "train"],
  ]) assert.equal(songArtwork({ id: title, title }).theme, expected);
});
test("new and unusual titles are safe and do not need lyrics or remote image URLs", () => {
  const hostile = '<script>alert("hi")</script><image href="https://example.com/track"/>';
  const art = songArtwork({ id: hostile, title: hostile });
  const svg = decodeURIComponent(art.src.split(",")[1]);
  assert.doesNotMatch(svg, /script|https:|href=|onload=/);
  assert.notEqual(songArtwork({ id: "one", title: "Untitled" }).src, songArtwork({ id: "two", title: "Untitled" }).src);
  assert.ok(songArtwork({}).src.startsWith("data:image/svg+xml,"));
});

