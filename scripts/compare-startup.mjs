// Usage: node scripts/compare-startup.mjs before/results.json after/results.json
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [beforeFile, afterFile] = process.argv.slice(2);
assert.ok(beforeFile && afterFile, "Supply before and after results.json paths");
const [before, after] = await Promise.all([beforeFile, afterFile].map(async file => JSON.parse(await readFile(file, "utf8"))));
assert.equal(before.diagnostic, false, "Compare benchmarks separately from diagnostics");
assert.equal(after.diagnostic, false);
for (const key of ["view", "browser", "conditions"]) assert.deepEqual(before[key], after[key], `${key} changed`);
const median = values => {
  assert.ok(values.length && values.every(Number.isFinite), "Missing measurement");
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const table = rows => rows.map(row => `| ${row.join(" | ")} |`).join("\n");
const metrics = {
  "Shell (ms)": r => r.milestones.collectionShell,
  "First cards paint (ms)": r => r.milestones.firstCardsPaint,
  "Full catalog paint (ms)": r => r.milestones.fullCatalogPaint,
  "JS files": r => r.network.filter(n => n.type === "Script").length,
  "JS decoded KiB": r => r.network.filter(n => n.type === "Script").reduce((sum, n) => sum + n.decodedBytes, 0) / 1024,
  "Summary requests": r => r.network.filter(n => n.method === "GET" && new URL(n.url).pathname.endsWith("/songs/summary")).length,
};
const groups = [...new Set(before.results.map(r => `${r.scenario}/${r.cache}`))];
const rows = [["Scenario", "Metric", "Before median", "After median", "Change"], ["---", "---", "---", "---", "---"]];
for (const group of groups) {
  const select = data => data.results.filter(r => `${r.scenario}/${r.cache}` === group);
  const old = select(before), next = select(after);
  assert.equal(next.length, old.length, `Run counts differ for ${group}`);
  for (const [name, pick] of Object.entries(metrics)) {
    const a = median(old.map(pick)), b = median(next.map(pick));
    rows.push([group, name, a.toFixed(1), b.toFixed(1), `${((b / a - 1) * 100).toFixed(1)}%`]);
  }
}
const report = `# Startup comparison\n\nBefore: ${before.at}; after: ${after.at}. ${before.view} view; ${before.browser}.\n\n${table(rows)}\n\nPaint is the profiler's next-frame approximation. Request counts cover its observation window, not an entire session. Cold means an empty browser cache. These are repeated observations, not an isolated causal experiment. Exact steps, ranges, API timings and CPU counters are in each run's timings.md.\n`;
const output = path.join(path.dirname(afterFile), "comparison.md");
await writeFile(output, report);
console.log(output);
