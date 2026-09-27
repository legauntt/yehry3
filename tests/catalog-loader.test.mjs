import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { hostname: "localhost" };
globalThis.window = new EventTarget();
const { createCatalogLoader } = await import("../assets/catalog.js");

test("conditional refreshes reuse all songs while replacing only this visitor's state", async () => {
  const headers = [], songs = Array.from({ length: 75 }, (_, i) => ({ id: `song-${i}`, votes: i }));
  let count = 0, mine = { feedback: { "song-74": { pinned: true, artPrompt: "my sketch" } }, nextVoteAt: "later" };
  const load = createCatalogLoader({
    request: async (_url, options) => {
      headers.push(options.headers);
      assert.equal(options.credentials, "omit");
      return count++ ? new Response(null, { status: 304 }) : Response.json({ songs, catalogRevision: "one" }, { headers: { ETag: 'W/"one"' } });
    },
    state: async () => mine,
  });
  const first = await load();
  assert.equal(first.songs.length, 75); assert.equal(first.songs[74].feedback.pinned, true);
  first.songs[0].votes = 999;
  mine = { feedback: {}, nextVoteAt: null };
  const next = await load();
  assert.equal(next.songs.length, 75); assert.equal(next.songs[0].votes, 0);
  assert.equal(next.songs[74].feedback.pinned, false); assert.equal(next.songs[74].feedback.artPrompt, undefined);
  assert.equal(next.nextVoteAt, null);
  assert.deepEqual(headers, [{}, { "If-None-Match": 'W/"one"' }]);
});

test("a failed personal read does not claim online success, and can retry against the saved public snapshot", async () => {
  let first = true, failed = true;
  const load = createCatalogLoader({
    request: async () => { if (!first) return new Response(null, { status: 304 }); first = false; return Response.json({ songs: [{ id: "old" }] }, { headers: { ETag: '"one"' } }); },
    state: async () => { if (failed) throw Error("state offline"); return { feedback: {} }; },
  });
  await assert.rejects(load(), /state offline/); failed = false;
  assert.equal((await load()).songs[0].id, "old");
});

test("a changed snapshot replaces archives and metadata; 304 without a snapshot is rejected", async () => {
  let version = 0;
  const load = createCatalogLoader({ request: async () => Response.json(version++ ? { songs: [], archived: ["old"] } : { songs: [{ id: "old" }], archived: [] }), state: async () => ({ feedback: {} }) });
  assert.equal((await load()).songs.length, 1); assert.deepEqual((await load()).archived, ["old"]);
  await assert.rejects(createCatalogLoader({ request: async () => new Response(null, { status: 304 }), state: async () => ({}) })(), /catalog could not load/);
});
