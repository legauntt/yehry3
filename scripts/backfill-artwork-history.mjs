#!/usr/bin/env node
// Recover saved public covers from registry history; never publish generation inputs.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { retainArtworkHistory } from "../assets/artwork-versions.js";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { state: { type: "string" } } });
const file = "assets/artwork-catalog.js";
const prefix = "// Saved covers. Updated by scripts/song-artwork.mjs.\nexport default ";
const parse = text => JSON.parse(text.slice(text.indexOf("export default ") + 15).trim().replace(/;$/, ""));
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const current = parse(await readFile(path.join(root, file), "utf8"));
const revisions = git(["log", "--reverse", "--format=%H", "--", file]).trim().split(/\s+/).filter(Boolean);
const retained = {};
const missing = new Set();
async function available(version) {
  if (!version?.src?.startsWith("/assets/") || version.src.includes("..")) return null;
  try { await access(path.join(root, version.src)); return version; }
  catch {
    // Compression replaced masters with the same image at a smaller size.
    const optimized = version.src.replace(/\.webp$/, "-q86.webp");
    try { await access(path.join(root, optimized)); return { ...version, src: optimized }; }
    catch { missing.add(version.src); return null; }
  }
}
for (const revision of revisions) {
  const registry = parse(git(["show", `${revision}:${file}`]));
  for (const [id, art] of Object.entries(registry)) {
    if (!current[id]) continue;
    // Older registries kept only a predecessor link. Recover that before its replacement.
    for (const version of [...(art.history || []), ...(art.previous ? [{ src: art.previous, alt: "Earlier cover artwork" }] : []), art]) {
      const saved = await available(version);
      if (!saved) continue;
      retained[id] ||= new Map();
      const previous = retained[id].get(saved.src);
      if (!previous || !previous.createdAt && saved.createdAt) retained[id].set(saved.src, saved);
    }
  }
}
if (values.state) {
  const ledger = JSON.parse(await readFile(path.join(values.state, "ledger.json"), "utf8"));
  for (const [key, job] of Object.entries(ledger.jobs).sort((a, b) => (a[1].at || "").localeCompare(b[1].at || ""))) {
    if (job.status !== "complete" || !/^[a-z0-9-]+$/.test(key)) continue;
    const packet = JSON.parse(await readFile(path.join(values.state, key, "sources.json"), "utf8").catch(() => "{}"));
    const id = job.songId || packet.song?.id;
    if (!current[id]) continue;
    const saved = await available({ src: job.src, alt: `Earlier cover artwork`, ...(job.at ? { createdAt: job.at } : {}) });
    if (saved) {
      retained[id] ||= new Map();
      if (!retained[id].has(saved.src)) retained[id].set(saved.src, saved);
    }
  }
}
for (const [id, art] of Object.entries(current)) {
  const earlier = [...(retained[id]?.values() || [])].filter(version => version.src !== art.src);
  const seed = earlier.length ? { ...earlier.at(-1), history: earlier.slice(0, -1) } : null;
  current[id] = earlier.length ? retainArtworkHistory(seed, art) : art;
}
await writeFile(path.join(root, file), prefix + JSON.stringify(current, null, 2) + ";\n");
console.log(JSON.stringify({ revisions: revisions.length, songs: Object.keys(current).length, songsWithHistory: Object.values(current).filter(art => art.history?.length).length, earlierImages: Object.values(current).reduce((n, art) => n + (art.history?.length || 0), 0), missingImages: [...missing] }, null, 2));
