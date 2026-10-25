import { test } from "node:test";
import assert from "node:assert/strict";
import { artworkVersions, retainArtworkHistory } from "../assets/artwork-versions.js";
import artwork from "../assets/artwork-catalog.js";
import { access } from "node:fs/promises";

test("artwork replacement preserves every unique saved version and only public metadata", () => {
  let art = { src: "/assets/a.webp", alt: "A", createdAt: "2026-09-01T00:00:00Z", prompt: "private" };
  art = retainArtworkHistory(art, { src: "/assets/b.webp", alt: "B" });
  art = retainArtworkHistory(art, { src: "/assets/c.webp", alt: "C" });
  art = retainArtworkHistory(art, { src: "/assets/c.webp", alt: "C" });
  assert.deepEqual(artworkVersions(art).map(v => v.src), ["/assets/a.webp", "/assets/b.webp", "/assets/c.webp"]);
  assert.equal(art.history[0].prompt, undefined);
  assert.equal(art.history[0].createdAt, "2026-09-01T00:00:00Z");
  assert.equal(art.previous, "/assets/b.webp");
  assert.deepEqual(artworkVersions(null), []);
});

test("current cover stays last when an earlier version becomes current again", () => {
  const art = retainArtworkHistory({ src: "/assets/b.webp", history: [{ src: "/assets/a.webp" }] }, { src: "/assets/a.webp" });
  assert.deepEqual(artworkVersions(art).map(v => v.src), ["/assets/b.webp", "/assets/a.webp"]);
});

test("every recovered cover version has a saved public asset", async () => {
  for (const art of Object.values(artwork)) {
    const versions = artworkVersions(art);
    assert.equal(versions.at(-1).src, art.src);
    for (const version of versions) await access(new URL(".." + version.src, import.meta.url));
  }
});
