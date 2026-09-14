import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile(new URL("../wiseau/clips.json", import.meta.url), "utf8"),
);
const config = JSON.parse(
  await readFile(new URL("../staticwebapp.config.json", import.meta.url), "utf8"),
);
test("every shared Tommy line has a stable id, a playable file, and a waveform", async () => {
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.clips));
  assert.equal(new Set(manifest.clips.map((clip) => clip.id)).size, manifest.clips.length);
  for (const clip of manifest.clips) {
    assert.match(clip.id, /^[a-z0-9]{8}$/, `Unexpected id ${clip.id}`);
    assert.ok(clip.text.trim().length > 0, `Empty text for ${clip.id}`);
    assert.equal(clip.url, `/wiseau/clips/${clip.id}.mp3`);
    assert.ok(clip.duration > 0 && clip.duration < 120, `Unlikely duration for ${clip.id}`);
    assert.ok(Number.isFinite(Date.parse(clip.createdAt)), `Missing date for ${clip.id}`);
    assert.equal(clip.peaks.length, 96, `Waveform for ${clip.id} must hold 96 peaks`);
    assert.ok(clip.peaks.every((peak) => peak >= 0 && peak <= 1));
    const file = await stat(new URL(`..${clip.url}`, import.meta.url));
    assert.equal(file.size, clip.bytes, `Size mismatch for ${clip.id}`);
  }
  // The folder appears with the first shared clip; until then there is nothing to list.
  const files = await readdir(new URL("../wiseau/clips/", import.meta.url)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  assert.deepEqual(
    files.sort(),
    manifest.clips.map((clip) => `${clip.id}.mp3`).sort(),
    "Every clip file must be listed exactly once",
  );
});
test("the share page rewrite comes after the routes for its own files", () => {
  const order = config.routes.map((route) => route.route);
  const rewrite = config.routes.find((route) => route.route === "/wiseau/*");
  assert.equal(rewrite?.rewrite, "/wiseau/index.html");
  for (const own of ["/wiseau/clips.json", "/wiseau/wiseau.js", "/wiseau/wiseau.css", "/wiseau/clips/*"])
    assert.ok(
      order.indexOf(own) !== -1 && order.indexOf(own) < order.indexOf("/wiseau/*"),
      `${own} must be matched before the wildcard rewrite or Azure would serve the page instead`,
    );
});
