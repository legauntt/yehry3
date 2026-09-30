import test from "node:test";
import assert from "node:assert/strict";
import videos from "../assets/song-videos.js";
import history from "../assets/song-video-history.js";
import { videoVersions } from "../assets/song-video-versions.js";

test("preserved videos precede the current default with unique stable letters", () => {
  assert.deepEqual(videoVersions("missing-song"), []);
  for (const id of Object.keys(videos)) {
    const versions = videoVersions(id);
    assert.equal(versions.at(-1).src, videos[id].src);
    assert.equal(new Set(versions.map(v => v.src)).size, versions.length);
    assert.equal(versions[0].label, "A");
    assert.equal(new Set(versions.map(v => v.label)).size, versions.length);
    for (const old of history[id] || []) assert.ok(versions.some(v => v.src === old.src));
  }
  for (const id of Object.keys(history)) assert.ok(videos[id], `Orphan history: ${id}`);
});
