import { test } from "node:test";
import assert from "node:assert/strict";
import { songBadges, voiceModelBadge } from "../assets/song-badges.js";
import { remixBadge, remixOrigin } from "../assets/remix-badge.js";

const source = { songId: "distonyc-aaaaaaaaaaaaaaaaaaaaaaaa", title: "The <original>" };

test("the badge row keeps one shape for songs, queued requests and drafts", () => {
  const published = { id: "one", voiceModel: "v8", musicBackend: "eleven_music", remixOf: source };
  const queued = { id: "two", originalPrompt: { voiceModel: "v7", musicBackend: "local" }, remixOf: source };
  const draft = { id: "three", details: { voiceModel: "v7", musicBackend: "eleven_music", remixSource: source } };
  for (const item of [published, queued, draft]) {
    const html = songBadges(item);
    assert.match(html, /^<span class="song-badges">/);
    assert.match(html, /class="voice-model-badge/);
    assert.match(html, /class="music-backend-badge/);
    assert.match(html, /class="remix-badge"/);
  }
  assert.match(songBadges(published), />V8</);
  assert.match(songBadges(queued), />V7</);
  assert.match(songBadges(queued), />Local · ACE</);
  assert.match(songBadges(published), />EMP</);
  assert.equal(songBadges(null), "");
});

test("an unlabeled recording keeps the established V6 voice and no invented generator", () => {
  const html = songBadges({ id: "legacy" });
  assert.match(html, /voice-model-badge"[^>]*>V6</);
  assert.doesNotMatch(html, /music-backend-badge|remix-badge/);
  assert.match(voiceModelBadge("v7"), /voice-model-badge v7"/);
  assert.match(voiceModelBadge({ voiceModel: "V8" }), /voice-model-badge v8"[^>]*>V8</);
});

test("a remix is marked from its frozen source, with the parent title escaped", () => {
  assert.equal(remixOrigin({ details: { remixSource: source } }), source);
  assert.equal(remixOrigin({ remixOf: { title: "No ID" } }), null);
  assert.equal(remixBadge({}), "");
  const html = remixBadge({ remixOf: source });
  assert.match(html, /title="Remix of “The &lt;original&gt;”"/);
  assert.equal(remixBadge({ remixOf: { songId: "x" } }), '<span class="remix-badge" title="Remix of another recording">Remix</span>');
});
