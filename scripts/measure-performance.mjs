// Public read-only samples; uses no passwords and never creates requests or votes.
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
const api = process.env.YEHRY3_API_URL || "https://chairlift.fly.dev/yehry3";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const visitor = randomUUID();
async function sample(url, identity = false) {
  const start = performance.now();
  const response = await fetch(url, { headers: identity ? { "X-Visitor-ID": visitor } : {}, signal: AbortSignal.timeout(15000) });
  const headersMs = Math.round(performance.now() - start);
  const body = await response.text();
  console.log(JSON.stringify({ at: new Date().toISOString(), url, status: response.status, headersMs, totalMs: Math.round(performance.now() - start), decodedBytes: Buffer.byteLength(body), serverTiming: response.headers.get("server-timing"), encoding: response.headers.get("content-encoding") }));
  if (!response.ok) throw new Error(`Unexpected HTTP ${response.status}`);
  return JSON.parse(body);
}
const savedCatalog = await sample(`${site}/catalog-summary.json`);
const savedIds = new Set(savedCatalog.songs.map(song => song.id));
let id;
for (let i = 0; i < 3; i++) {
  await sample(`${api}/ready`);
  await sample(`${api}/song-pins`);
  await sample(`${api}/songs/first-page`, true);
  const catalog = await sample(`${api}/songs/summary`, true);
  // New publications can reach Chairlift before their static deployment finishes.
  id ||= catalog.songs.find(song => song.hasOriginalPrompt && savedIds.has(song.id))?.id || catalog.songs.find(song => savedIds.has(song.id))?.id;
  if (id) await sample(`${api}/songs/${encodeURIComponent(id)}`);
}
if (id) await sample(`${site}/songs/${encodeURIComponent(id)}.json`);
