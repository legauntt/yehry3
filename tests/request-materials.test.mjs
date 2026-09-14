import { test } from "node:test";
import assert from "node:assert/strict";
import { wordCount, lyricError, durationIssue, materialBrief } from "../assets/request-materials.js";
import { publicPromptBrief } from "../assets/prompt-brief.js";
const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
test("lyric limits accept the boundary without truncation and count Unicode whitespace", () => {
  assert.equal(wordCount("one\u00a0two\nthree"), 3);
  assert.equal(lyricError("é ".repeat(3000)), "");
  assert.match(lyricError("é ".repeat(3001)), /3,000/);
  assert.match(lyricError("字".repeat(30001)), /30,000/);
  assert.match(lyricError("[Verse]\n[End]"), /words to sing/);
  assert.equal(durationIssue({ lyricSheet: { text: "word ".repeat(3000), mode: "adapt" } }), "");
  assert.match(durationIssue({ lyricSheet: { text: "word ".repeat(600), mode: "preserve" } }), /5-minute/);
});
test("private review escapes lyrics, URLs, reference notes and fetched content", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = materialBrief({ lyricSheet: { text: attack, mode: "preserve" }, references: [{ url: attack, purpose: "creative", note: attack, snapshot: { text: attack, message: attack } }] }, escape);
  assert.doesNotMatch(html, /<img|onerror="alert/);
  assert.match(html, /Keep my wording/); assert.match(html, /stay private/);
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

test("public prompt details exclude attachments even if supplied and tolerate older missing fields", () => {
  const privateFields = { lyricSheet: { text: "PRIVATE LYRIC", mode: "adapt" }, references: [{ url: "https://private.example/", snapshot: { text: "PRIVATE SNAPSHOT" } }], adminNote: "PRIVATE NOTE" };
  const html = publicPromptBrief({ originalPrompt: { idea: "<b>A song</b>", ...privateFields }, details: privateFields, ...privateFields }, escape);
  assert.doesNotMatch(html, /PRIVATE|private\.example|<b>/);
  assert.match(html, /&lt;b&gt;A song&lt;\/b&gt;/);
  assert.match(html, /Tony V6/);
  assert.match(html, /No basis songs selected/);
});
