// Build a private, cue-only sync report from an already committed lyric audit.
// Usage: node scripts/prepare-reviewed-cue-sync.mjs <audit-commit> <report.json>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const [auditCommit, output] = process.argv.slice(2);
if (!/^[a-f0-9]{7,40}$/i.test(auditCommit || "") || !output) {
  throw new Error("Usage: node scripts/prepare-reviewed-cue-sync.mjs <audit-commit> <report.json>");
}

function catalogAt(ref) {
  return JSON.parse(execFileSync("git", ["show", `${ref}:catalog.json`], {
    maxBuffer: 100 * 1024 * 1024,
  }).toString());
}

const before = new Map(catalogAt(`${auditCommit}^`).songs.map((song) => [song.id, song]));
const after = new Map(catalogAt(auditCommit).songs.map((song) => [song.id, song]));
const current = JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8"));
const response = await fetch("https://chairlift.fly.dev/yehry3/songs", {
  headers: { "X-Visitor-ID": randomUUID(), Origin: "https://yehry3.app" },
  signal: AbortSignal.timeout(45000),
});
assert.equal(response.status, 200, "Could not read the public Chairlift catalog");
const live = new Map((await response.json()).songs.map((song) => [song.id, song]));
const rows = [];

for (const song of current.songs) {
  const published = live.get(song.id);
  if (!published || !song.lyrics || !published.lyrics) continue;
  if (isDeepStrictEqual(song.lyrics, published.lyrics)) continue;
  const previous = before.get(song.id);
  const reviewed = after.get(song.id);
  assert.ok(previous && reviewed, `No committed audit for ${song.id}`);
  assert.deepEqual(published.lyrics, previous.lyrics, `Chairlift cues changed since the audit: ${song.id}`);
  assert.deepEqual(song.lyrics, reviewed.lyrics, `Fallback cues changed since the audit: ${song.id}`);
  assert.deepEqual(
    Object.fromEntries(Object.entries(previous.lyrics).filter(([key]) => key !== "cues")),
    Object.fromEntries(Object.entries(reviewed.lyrics).filter(([key]) => key !== "cues")),
    `Audit changed lyric content: ${song.id}`,
  );
  for (const field of ["url", "duration"]) {
    assert.equal(song[field], previous[field], `Local recording changed: ${song.id}`);
    assert.equal(song[field], reviewed[field], `Reviewed recording changed: ${song.id}`);
    assert.equal(song[field], published[field], `Chairlift recording changed: ${song.id}`);
  }
  rows.push({ id: song.id, title: song.title, url: song.url, duration: song.duration,
    before: previous.lyrics, after: reviewed.lyrics, changed: true });
}

assert.ok(rows.length, "No reviewed cue differences need syncing");
await writeFile(output, `${JSON.stringify({ version: 1, auditCommit, at: new Date().toISOString(), songs: rows }, null, 2)}\n`, { flag: "wx" });
console.log(`Prepared ${rows.length} cue-only repairs in ${output}. No live data was changed.`);
