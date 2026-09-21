import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { sweepStaleMongoDirs } from "../scripts/mongo-temp-sweep.mjs";

const HOUR = 60 * 60 * 1000;

function withTemp(run) {
  const tmp = mkdtempSync(path.join(tmpdir(), "sweep-test-"));
  const make = (name, ageMs) => {
    const dir = path.join(tmp, name);
    mkdirSync(path.join(dir, "journal"), { recursive: true });
    writeFileSync(path.join(dir, "collection-0.wt"), "x");
    const when = new Date(Date.now() - ageMs);
    utimesSync(dir, when, when);
  };
  try {
    return run(tmp, make);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("the sweep removes old mongo-mem folders no mongod is using and leaves everything else", () => {
  withTemp((tmp, make) => {
    make("mongo-mem-stale", 5 * HOUR);
    make("mongo-mem-running", 5 * HOUR);
    make("mongo-mem-fresh", 60 * 1000);
    make("other-folder", 5 * HOUR);
    writeFileSync(path.join(tmp, "mongo-mem-file"), "not a directory");

    const removed = sweepStaleMongoDirs({ tmp, live: `mongod.exe --dbpath ${path.join(tmp, "mongo-mem-running")} --port 1` });

    assert.deepEqual(removed, ["mongo-mem-stale"]);
    assert.deepEqual(readdirSync(tmp).sort(), ["mongo-mem-file", "mongo-mem-fresh", "mongo-mem-running", "other-folder"]);
  });
});

test("the sweep removes nothing when the process list cannot be read", () => {
  withTemp((tmp, make) => {
    make("mongo-mem-stale", 5 * HOUR);

    const removed = sweepStaleMongoDirs({ tmp, live: () => { throw new Error("no process list"); } });

    assert.deepEqual(removed, []);
    assert.deepEqual(readdirSync(tmp), ["mongo-mem-stale"]);
  });
});
