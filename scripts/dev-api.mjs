// Development/testing only: disposable Mongo replica set; never reads chairlift .env.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { sweepStaleMongoDirs } from "./mongo-temp-sweep.mjs";
const backend = path.resolve(
  process.env.CHAIRLIFT_PATH ||
    path.join(import.meta.dirname, "../../chairlift"),
);
const requireBackend = createRequire(path.join(backend, "package.json"));
const express = requireBackend("express");
const { MongoClient } = requireBackend("mongodb");
const { Store } = requireBackend("./yehry3/store");
const router = requireBackend("./yehry3/router");
if (!process.env.YEHRY3_ADMIN_PASSWORD)
  throw new Error("Set YEHRY3_ADMIN_PASSWORD for the local preview.");
// A forced kill skips stop() below, so earlier previews may have left their data folders behind.
sweepStaleMongoDirs();
const mongo = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: "7.0.14" },
});
const client = await MongoClient.connect(mongo.getUri());
const store = new Store(client, client.db("yehry3_local_preview"));
await store.init();
const catalog = JSON.parse(
  await readFile(path.join(import.meta.dirname, "../catalog.json"), "utf8"),
);
for (const [order, song] of catalog.songs.entries()) {
  const { id, ...fields } = song;
  await store.songs.insertOne({
    _id: id,
    ...fields,
    url: new URL(song.url, "http://127.0.0.1:8080").href,
    order,
    active: true,
  });
}
const app = express();
const yehry3 = router({
  mango: { getDb: () => store.db, getClient: () => client },
  env: {
    YEHRY3_GENERATION_V8: process.env.YEHRY3_GENERATION_V8 || 'false',
    YEHRY3_ELEVEN_MUSIC: process.env.YEHRY3_ELEVEN_MUSIC || 'false',
    YEHRY3_PAID_MUSIC_PASSWORD: process.env.YEHRY3_PAID_MUSIC_PASSWORD || '',
    YEHRY3_MUSIC_CAP_CENTS: process.env.YEHRY3_MUSIC_CAP_CENTS || '20000',
    YEHRY3_MUSIC_PREVIOUS_CENTS: process.env.YEHRY3_MUSIC_PREVIOUS_CENTS || '900',
    YEHRY3_VOICE_V8: process.env.YEHRY3_VOICE_V8 || 'false',
    YEHRY3_VOICE_V9: process.env.YEHRY3_VOICE_V9 || 'false',
    YEHRY3_WORKER_TOKEN: process.env.YEHRY3_WORKER_TOKEN || '',
    YEHRY3_SESSION_SECRET:
      "local-disposable-preview-signing-secret-123456789",
    YEHRY3_PROMPT_PASSWORD: process.env.YEHRY3_PROMPT_PASSWORD || "wishbone",
    YEHRY3_ADMIN_PASSWORD: process.env.YEHRY3_ADMIN_PASSWORD,
    YEHRY3_ORIGINS: process.env.YEHRY3_ORIGINS || "http://127.0.0.1:8080,http://localhost:8080",
  },
});
app.use("/yehry3", yehry3);
const port = Number(process.env.API_PORT || 3000);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Disposable preview API: http://127.0.0.1:${port}/yehry3`),
);
// The listening room's socket, when the Chairlift checkout is new enough to have one.
if (yehry3.upgrade) server.on("upgrade", yehry3.upgrade);
async function stop() {
  server.close();
  await client.close();
  await mongo.stop();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
