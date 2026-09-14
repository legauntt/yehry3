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
let id;
for (let i = 0; i < 3; i++) {
  await sample(`${api}/ready`);
  const catalog = await sample(`${api}/songs/summary`, true);
  id ||= catalog.songs.find(song => song.hasOriginalPrompt)?.id || catalog.songs[0]?.id;
  if (id) await sample(`${api}/songs/${encodeURIComponent(id)}`);
}
await sample(`${site}/catalog-summary.json`);
if (id) await sample(`${site}/songs/${encodeURIComponent(id)}.json`);
