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
test("no wildcard rewrite shadows the per-clip pages", () => {
  // Azure applies a matching rewrite even when the requested file exists, so a /wiseau/*
  // rewrite would serve the index instead of dist/wiseau/<id>/index.html and its metadata.
  for (const route of config.routes)
    if (route.route.startsWith("/wiseau") && route.route.endsWith("*"))
      assert.equal(route.rewrite, undefined, `${route.route} must not rewrite`);
  for (const own of ["/wiseau/clips.json", "/wiseau/wiseau.js", "/wiseau/wiseau.css", "/wiseau/clips/*"])
    assert.ok(config.routes.some((route) => route.route === own), `${own} keeps its cache rule`);
});
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
test("every shared line has its own built page whose link preview quotes it", async () => {
  const dist = new URL("../dist/wiseau/", import.meta.url);
  const index = await readFile(new URL("index.html", dist), "utf8");
  assert.doesNotMatch(index, /og:title/, "The index keeps its generic metadata");
  const pages = (await readdir(dist, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "clips")
    .map((entry) => entry.name);
  assert.deepEqual(pages.sort(), manifest.clips.map((clip) => clip.id).sort(), "One page per clip, no strays");
  for (const clip of manifest.clips) {
    const html = await readFile(new URL(`${clip.id}/index.html`, dist), "utf8");
    const quote = escape(`“${clip.text}”`);
    assert.ok(html.includes(`<title>${quote} · Tommy says · yehry3</title>`), `Title of ${clip.id}`);
    assert.ok(html.includes(`<meta property="og:title" content="${quote}" />`), `og:title of ${clip.id}`);
    assert.ok(html.includes(`<meta property="og:url" content="https://yehry3.app/wiseau/${clip.id}" />`));
    assert.ok(html.includes(`<meta property="og:audio" content="https://yehry3.app${clip.url}" />`));
    assert.match(html, /<meta property="og:description" content="\d+ seconds? in the voice of [^"]*He never said this\." \/>/);
    assert.ok(html.includes('<script type="module" src="/wiseau/wiseau.js"></script>'), "The player loads from the site root");
    assert.match(html, /noindex,\s*nofollow,\s*noarchive/);
  }
});
