// Usage: node scripts/summarize-startup.mjs artifacts/startup/results.json
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.argv[2] || 'artifacts/startup/results.json');
const data = JSON.parse(await readFile(file, 'utf8'));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ms = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const kib = value => (value / 1024).toFixed(1);
const short = url => new URL(url).pathname + new URL(url).search;
const table = (head, rows) => [head, head.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
const lines = [`# Catalog startup measurements`, '', `${data.at} · ${data.site} · ${data.view} view · Chromium ${data.browser}`, '',
  `${data.host.platform} · ${data.host.cpu.trim()}. Fresh anonymous contexts; no saved profile. Presence is hidden, so no listener heartbeat is submitted. Cold means an empty browser cache, not a cold CDN or server. Warm is a second navigation in the same context with ordinary HTTP cache revalidation. Slow phone: ${data.conditions.slowPhone}.`, '',
  `DOM timestamps use a MutationObserver. “Paint” is the second animation-frame callback after that mutation, an approximation of the next painted frame, not a browser pixel timestamp. Response.json includes remaining body transfer and parsing; it is not pure JSON CPU time. Server app time is included in request time; Mongo totals can overlap and must not be added to wall time. CDP CPU counters are cumulative through a Playwright observation just after the milestone.`, '',
  data.diagnostic ? 'Diagnostic run: CPU and coverage instrumentation enabled; do not compare its wall time to the uninstrumented benchmark.' : 'Benchmark run: no CPU profiler or code coverage; lightweight DOM/fetch/paint observers only.', '',
  '## Median startup times', ''];
const groups = [...new Set(data.results.map(r => `${r.scenario}/${r.cache}`))];
lines.push(table(['Scenario', 'n', 'Collection shell (ms)', 'First cards paint (ms)', 'Full catalog paint (ms)', 'First cards range (ms)'], groups.map(key => {
  const rows = data.results.filter(r => `${r.scenario}/${r.cache}` === key);
  const first = rows.map(r => r.milestones.firstCardsPaint);
  return [key, rows.length, ...['collectionShell', 'firstCardsPaint', 'fullCatalogPaint'].map(name => ms(median(rows.map(r => r.milestones[name])))), `${ms(Math.min(...first))}–${ms(Math.max(...first))}`];
})), '', '## Every measured navigation', '', table(['Scenario', 'Cache', 'Run', 'Shell', 'First cards DOM', 'First cards paint', 'Full catalog DOM', 'Full catalog paint', 'HTTP requests', 'Long tasks'], data.results.map(r => [r.scenario, r.cache, r.run, ...['collectionShell', 'firstCardsDom', 'firstCardsPaint', 'fullCatalogDom', 'fullCatalogPaint'].map(k => ms(r.milestones[k])), r.network.length, r.longTasks.length])), '');

for (const scenario of [...new Set(data.results.map(r => r.scenario))]) {
  const candidates = data.results.filter(r => r.scenario === scenario && r.cache === 'cold');
  const target = median(candidates.map(r => r.milestones.firstCardsPaint));
  const r = [...candidates].sort((a, b) => Math.abs(a.milestones.firstCardsPaint - target) - Math.abs(b.milestones.firstCardsPaint - target))[0];
  const n = r.navigation, m = r.milestones;
  const first = r.fetches.find(f => f.url.endsWith('/songs/first-page'));
  const full = r.fetches.find(f => f.url.endsWith('/songs/summary'));
  const span = (name, begin, end) => [name, ms(begin), ms(end), ms(end - begin)];
  const spans = [span('DNS', n.domainLookupStart, n.domainLookupEnd), span('TCP + TLS', n.connectStart, n.connectEnd), span('HTML request → first byte', n.requestStart, n.responseStart), span('HTML body', n.responseStart, n.responseEnd), span('HTML complete → collection shell', n.responseEnd, m.collectionShell)];
  if (first) spans.push(span('First-page fetch → response headers (includes preflight)', first.start, first.headers), span('First-page body + JSON parsing', first.jsonStart, first.jsonEnd), span('First-page parsed → first cards DOM', first.jsonEnd, m.firstCardsDom));
  spans.push(span('First cards DOM → next paint opportunity', m.firstCardsDom, m.firstCardsPaint));
  if (full) spans.push(span('Full-catalog fetch → response headers (parallel)', full.start, full.headers), span('Full-catalog body + JSON parsing', full.jsonStart, full.jsonEnd), span('Full catalog parsed → DOM', full.jsonEnd, m.fullCatalogDom));
  spans.push(span('Full catalog DOM → next paint opportunity', m.fullCatalogDom, m.fullCatalogPaint));
  lines.push(`## ${scenario}: exact waterfall, cold run ${r.run}`, '', 'All times are milliseconds from navigation. Parallel spans overlap; do not sum every row.', '', table(['Step', 'Starts', 'Ends', 'Duration'], spans), '', 'HTTP API and preflight timings:', '', table(['Method / endpoint', 'Start', 'Headers', 'Finished', 'Wire KiB*', 'Decoded KiB', 'Server-Timing'], r.network.filter(item => item.url.includes('/yehry3/')).map(item => [`${item.method} ${short(item.url)}`, ms(item.start), ms(item.headersAt), ms(item.end), kib(item.encodedBytes || 0), kib(item.decodedBytes), item.serverTiming || '—'])), '', '*CDP encodedDataLength includes protocol/header overhead where Chromium reports it; unfinished requests have no final byte count.', '');
  for (const [milestone, metrics] of Object.entries(r.metrics)) {
    const values = Object.fromEntries(metrics.map(item => [item.name, item.value]));
    lines.push(`${milestone}: script ${ms(values.ScriptDuration * 1000)} ms; style recalculation ${ms(values.RecalcStyleDuration * 1000)} ms; layout ${ms(values.LayoutDuration * 1000)} ms; all main-thread tasks ${ms(values.TaskDuration * 1000)} ms; DOM nodes ${values.Nodes}; JS heap ${kib(values.JSHeapUsedSize)} KiB.`, '');
  }
  const resources = ['Script', 'Stylesheet', 'Font', 'Image', 'Fetch', 'Document'].map(type => {
    const items = r.network.filter(item => item.type === type);
    return [type, items.length, kib(items.reduce((s, i) => s + (i.encodedBytes || 0), 0)), kib(items.reduce((s, i) => s + i.decodedBytes, 0))];
  });
  lines.push(table(['Resource kind', 'Requests', 'Wire KiB*', 'Decoded KiB'], resources), '');
  if (r.coverage) for (const kind of ['js', 'css']) {
    const items = r.coverage[kind];
    const bytes = items.reduce((sum, i) => sum + i.bytes, 0), used = items.reduce((sum, i) => sum + i.usedBytes, 0);
    lines.push(`### ${kind.toUpperCase()} startup coverage`, '', `${items.length} files; ${kib(bytes)} KiB source, ${kib(bytes - used)} KiB (${((1 - used / bytes) * 100).toFixed(1)}%) not exercised. Unused during startup is not safe to delete: interactions, alternate views, fonts, and media queries need separate coverage.`, '', table(['File', 'Source KiB', 'Used KiB', 'Not exercised KiB'], [...items].sort((a, b) => (b.bytes - b.usedBytes) - (a.bytes - a.usedBytes)).map(item => [short(item.url), kib(item.bytes), kib(item.usedBytes), kib(item.bytes - item.usedBytes)])), '');
  }
}
lines.push('Raw navigation, fetch, Resource Timing, CDP network, long-task, layout-shift and CPU counters are in `results.json` and the per-run JSON files. Diagnostic `.cpuprofile` files open in Chrome DevTools Performance. Screenshots and row dimensions are retained beside them.');
const output = path.join(path.dirname(file), 'timings.md');
await writeFile(output, lines.join('\n'));
console.log(output);
