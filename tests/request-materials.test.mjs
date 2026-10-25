import { test } from "node:test";
import assert from "node:assert/strict";
import { wordCount, sungWords, lyricError, durationIssue, materialBrief } from "../assets/request-materials.js";
import { publicPromptBrief } from "../assets/prompt-brief.js";
import { appendLyricPrompt, versionPromptHistory } from "../assets/lyric-prompts.js";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
test("lyric limits accept the boundary without truncation and count Unicode whitespace", () => {
  assert.equal(wordCount("one\u00a0two\nthree"), 3);
  assert.equal(lyricError("é ".repeat(3000)), "");
  assert.match(lyricError("é ".repeat(3001)), /3,000/);
  assert.match(lyricError("字".repeat(30001)), /30,000/);
  assert.match(lyricError("[Verse]\n[End]"), /words to sing/);
  assert.equal(durationIssue({ lyricSheet: { text: "word ".repeat(3000), mode: "adapt" } }), "");
  assert.equal(durationIssue({ lyricSheet: { text: "word ".repeat(600), mode: "preserve" } }), "");
});

test('preserved lyrics respect chosen lengths, backend caps, and section labels', () => {
  const details = { lyricSheet: { text: '[Final Chorus]\n' + 'word '.repeat(503), mode: 'preserve' } };
  assert.equal(sungWords(details.lyricSheet.text), 503);
  assert.match(durationIssue({ ...details, generation: { duration: 250 } }), /selected 250-second/);
  assert.equal(durationIssue({ ...details, generation: { duration: 350 } }), '');
  const long = { lyricSheet: { text: 'word '.repeat(1101), mode: 'preserve' } };
  assert.equal(durationIssue(long), '');
  assert.match(durationIssue({ ...long, musicBackend: 'eleven_music' }), /10-minute/);
  assert.match(durationIssue({ ...long, generation: { candidates: 2 } }), /10-minute/);
  assert.match(durationIssue({ lyricSheet: { text: 'word '.repeat(2091), mode: 'preserve' } }), /19-minute/);
  assert.equal(durationIssue({ ...long, musicBackend: 'eleven_music' }, 'A rap song'), '');
});
test("material review escapes lyrics, URLs, reference notes and fetched content", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = materialBrief({ lyricSheet: { text: attack, mode: "preserve" }, references: [{ url: attack, purpose: "creative", note: attack, snapshot: { text: attack, message: attack } }] }, escape);
  assert.doesNotMatch(html, /<img|onerror="alert/);
  assert.match(html, /Keep my wording/); assert.match(html, /public once the request is confirmed/);
  assert.equal(materialBrief({}, escape), "");
});

test("reference links allow HTTPS without credentials and leave unsafe URLs as text", () => {
  const references = ["https://example.org/song?a=1&b=2", "javascript:alert(1)", "data:text/html,bad", "https://user:password@example.org/private"]
    .map(url => ({ url, purpose: "creative" }));
  const html = materialBrief({ references }, escape);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/example.org\/song\?a=1&amp;b=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("public prompt details show supplied material and omit operational fields", () => {
  const materials = { lyricSheet: { text: "SUPPLIED LYRIC <img src=x>", mode: "adapt" }, references: [{ url: "https://example.org/song", purpose: "creative", note: "SUPPLIED NOTE", snapshot: { text: "SAVED PAGE", owner: "INTERNAL OWNER" } }], adminNote: "INTERNAL NOTE" };
  const html = publicPromptBrief({ originalPrompt: { idea: "<b>A song</b>", ...materials }, details: materials, ...materials }, escape);
  assert.doesNotMatch(html, /INTERNAL|<img|<b>/);
  assert.match(html, /SUPPLIED LYRIC &lt;img src=x&gt;/);
  assert.match(html, /SUPPLIED NOTE/);
  assert.match(html, /SAVED PAGE/);
  assert.match(html, /href="https:\/\/example.org\/song"/);
  assert.match(html, /&lt;b&gt;A song&lt;\/b&gt;/);
  assert.match(html, /Tony V6/);
  assert.doesNotMatch(html, /No basis songs selected/);
});

test("missing request details do not claim there were no supplied materials", () => {
  const song = { originalPrompt: { idea: "An older request" } };
  assert.doesNotMatch(publicPromptBrief(song, escape), /No lyric sheet or reference links supplied|<h3>Advanced<\/h3>/);
  const unavailable = publicPromptBrief(song, escape, { materialsUnavailable: true });
  assert.match(unavailable, /Lyrics and references could not be loaded/);
  assert.doesNotMatch(unavailable, /No lyric sheet/);
});

test('lyric prompts render as text and distinguish incomplete older history', () => {
  const history = versionPromptHistory({ prompt: '<img src=x> Funnier.' });
  const html = publicPromptBrief({ originalPrompt: { lyricSheet: { text: 'Chosen lyrics', mode: 'preserve', promptHistory: history } } }, escape);
  assert.match(html, /Lyric prompt history/);
  assert.match(html, /&lt;img src=x&gt; Funnier/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Some earlier prompts were not retained/);
  assert.doesNotMatch(materialBrief({ lyricSheet: { text: 'Old sheet', mode: 'adapt' } }, escape), /Lyric prompt history/);
  let lineage;
  for (let i = 0; i < 35; i++) lineage = appendLyricPrompt(lineage, 'Revision ' + i);
  assert.equal(lineage.prompts.length, 32);
  assert.equal(lineage.prompts[0], 'Revision 3');
  assert.equal(lineage.incomplete, true);
});
