import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const catalog = JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8"));
const config = JSON.parse(await readFile(new URL("../staticwebapp.config.json", import.meta.url), "utf8"));
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
test("no wildcard rewrite shadows the per-song pages", () => {
  // Azure applies a matching rewrite even when the file exists, which would hide each song's metadata.
  for (const route of config.routes)
    if (route.route.startsWith("/song/")) assert.equal(route.rewrite, undefined, `${route.route} must not rewrite`);
});
test("every song has a built page whose link preview names it, and forwards to the collection", async () => {
  const dist = new URL("../dist/song/", import.meta.url);
  const pages = (await readdir(dist, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(pages.sort(), catalog.songs.map((song) => song.id).sort(), "One page per song, no strays");
  for (const song of catalog.songs) {
    const html = await readFile(new URL(`${song.id}/index.html`, dist), "utf8");
    const title = escape(song.title);
    assert.ok(html.includes(`<title>${title} · yehry3</title>`), `Title of ${song.id}`);
    assert.ok(html.includes(`<meta property="og:title" content="${title}" />`), `og:title of ${song.id}`);
    assert.ok(html.includes(`<meta property="og:url" content="https://yehry3.app/song/${song.id}/" />`));
    assert.match(html, /<meta property="og:description" content="[^"]+" \/>/);
    const audio = `<meta property="og:audio" content="${escape(song.url)}" />`;
    if (/^https:\/\//.test(song.url || "")) assert.ok(html.includes(audio), `og:audio of ${song.id}`);
    else assert.ok(!html.includes("og:audio"), `${song.id} has no public https audio`);
    assert.ok(html.includes(`href="/#${song.id}"`), "Fallback link to the collection");
    assert.ok(html.includes('<script src="/assets/song-redirect.js"></script>'));
    assert.doesNotMatch(html, /\{\{/, "Every placeholder was filled");
    assert.match(html, /noindex,\s*nofollow,\s*noarchive/);
  }
});
