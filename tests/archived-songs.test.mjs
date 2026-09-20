import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { archivedSongIds, publicCatalog } from "../scripts/archived-songs.mjs";

const catalog = { version: 1, songs: ["a", "b", "c", "d"].map((id) => ({ id, title: id.toUpperCase() })) };

async function serve(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}/songs/summary`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const json = (body, status = 200) => (request, response) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

test("archived songs leave the public catalog, and it stays the same object when nothing is archived", () => {
  assert.equal(publicCatalog(catalog, []), catalog);
  assert.equal(publicCatalog(catalog, ["not-in-catalog"]), catalog);
  const trimmed = publicCatalog(catalog, ["b"]);
  assert.deepEqual(trimmed.songs.map((song) => song.id), ["a", "c", "d"]);
  assert.equal(trimmed.version, 1);
  assert.equal(catalog.songs.length, 4, "the source catalog is not modified");
  assert.deepEqual(publicCatalog(catalog, ["a", "b"]).songs.map((song) => song.id), ["c", "d"]);
});

test("an archive that would empty the fallback is refused", () => {
  assert.throws(() => publicCatalog(catalog, ["a", "b", "c"]), RangeError);
  assert.throws(() => publicCatalog(catalog, catalog.songs.map((song) => song.id)), RangeError);
});

test("the archived IDs come from the summary the studio API publishes", async () => {
  assert.deepEqual(await serve(json({ songs: [], archived: ["b", "x-1"] }), archivedSongIds), ["b", "x-1"]);
  assert.deepEqual(await serve(json({ songs: [], archived: [] }), archivedSongIds), []);
});

test("an API that cannot say what is archived is not trusted to hide anything", async () => {
  // An API that predates archiving omits the field; failures and junk must never look like "nothing archived".
  assert.equal(await serve(json({ songs: [] }), archivedSongIds), null);
  assert.equal(await serve(json({ archived: "b" }), archivedSongIds), null);
  assert.equal(await serve(json({ archived: ["../etc/passwd"] }), archivedSongIds), null);
  assert.equal(await serve(json({ archived: [1] }), archivedSongIds), null);
  assert.equal(await serve(json({ error: "down" }, 503), archivedSongIds), null);
  assert.equal(await serve((request, response) => response.end("not json"), archivedSongIds), null);
  assert.equal(await archivedSongIds("http://127.0.0.1:1/songs/summary"), null);
});
