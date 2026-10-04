// Read public catalog attribution only; no login or database access required.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const source = process.argv[2] || "https://chairlift.fly.dev/yehry3/songs/summary";
let catalog;
if (/^https?:/.test(source)) {
  const response = await fetch(source, { headers: { "X-Visitor-ID": randomUUID() }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
  catalog = await response.json();
} else catalog = JSON.parse(await readFile(source, "utf8"));
const counts = new Map();
for (const song of catalog.songs) {
  const name = typeof song.authoredBy === "string" ? song.authoredBy.trim() : "";
  if (name) counts.set(name, (counts.get(name) || 0) + 1);
}
for (const [name, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${name}\t${count}`);
}
