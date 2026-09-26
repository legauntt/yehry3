import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performanceTranscript, transcriptLyrics } from "../assets/performance-lyrics.js";
import { performanceTranscripts } from "../scripts/performance-transcripts.mjs";

const id = "distonyc-e87d33434caabdd9e3d27ab3";
const catalog = JSON.parse(await readFile(new URL("../catalog.json", import.meta.url)));
const song = catalog.songs.find(song => song.id === id);
const draft = JSON.parse(await readFile(new URL(`../lyric-transcripts/${id}.whisper.json`, import.meta.url)));

test("Whisper keeps its actual disagreements and timestamps rather than borrowing the written sheet", () => {
  const lyrics = transcriptLyrics(performanceTranscript(draft, song, "whisper"));
  assert.match(lyrics.text, /For candy/);
  assert.match(song.lyrics.text, /Put candy/i);
  assert.equal(lyrics.cues[1].start, 10.58);
  assert.equal(lyrics.cues[1].uncertain, true);
  assert.equal(lyrics.text.split("\n").length, 44);
  assert.notDeepEqual(lyrics.cues, song.lyrics.cues);
});

test("a transcript cannot be used for a different song, recording, model or guide singer", () => {
  for (const change of [{ songId: "different" }, { audioUrl: song.url + "?other" },
    { audioSha256: "0".repeat(64) }, { input: "guide-singer" }, { model: "invented" },
    { duration: song.duration + 10 }, { review: "verified" }])
    assert.throws(() => performanceTranscript({ ...draft, ...change }, song, "whisper"));
});

test("malformed timings or text never become clickable lyric lines", () => {
  for (const row of [{ start: -1 }, { end: Infinity }, { end: draft.duration + 1 },
    { end: 0 }, { text: "line\ninjection" }, { text: "" }, { uncertain: "false" }])
    assert.throws(() => performanceTranscript({ ...draft, segments: [{ ...draft.segments[0], ...row }] }, song, "whisper"));
  assert.throws(() => performanceTranscript({ ...draft, segments: [...draft.segments].reverse() }, song, "whisper"));
});

test("public exports drop private fields and exclude archived recordings", async () => {
  const sanitized = performanceTranscript({ ...draft, input_file: "private.wav", signature: {},
    segments: draft.segments.map(row => ({ ...row, words: [{ probability: .1 }], privateNote: "private" })) }, song, "whisper");
  assert.deepEqual(sanitized, draft);
  assert.deepEqual(await performanceTranscripts([]), { index: {}, files: {} });
  const { index, files } = await performanceTranscripts(catalog.songs);
  assert.deepEqual(index[id], { audioUrl: song.url, methods: ["whisper"] });
  assert.deepEqual(JSON.parse(await readFile(new URL(`../dist/lyric-transcripts/${id}.whisper.json`, import.meta.url))), files[`${id}.whisper.json`]);
});

test("legacy released-audio transcripts and an explicit no-words result remain honest", () => {
  const legacy = { ...song, url: "https://github.com/legauntt/gatsby-opus/releases/download/tonyai-v1/legacy.mp3" };
  const mixed = { ...draft, audioUrl: legacy.url, input: "released-recording", inputSha256: draft.audioSha256 };
  assert.equal(performanceTranscript(mixed, legacy, "whisper").input, "released-recording");
  assert.throws(() => performanceTranscript({ ...mixed, inputSha256: "0".repeat(64) }, legacy, "whisper"));
  const empty = performanceTranscript({ ...mixed, segments: [], outcome: "no-words-recognized" }, legacy, "whisper");
  assert.match(transcriptLyrics(empty).text, /did not recognize any words/);
  assert.deepEqual(transcriptLyrics(empty).cues, []);
  assert.throws(() => performanceTranscript({ ...mixed, segments: [] }, legacy, "whisper"));
});
