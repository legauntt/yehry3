// One public feed per tab. Screens subscribe to topics; writes and personalized
// reads stay on the ordinary API. Every reconnect refreshes the catalog baseline.
import { api } from "./api.js";
import { API_BASE } from "./config.js";

const SOCKET_URL = `${API_BASE.replace(/^http/, "ws")}/events/socket`;
const REST_MS = 10 * 60000;
const subscriptions = new Map();
let started = false, socket = null, live = false, polling = false, epoch = 0;
let failures = 0, restUntil = 0, timer, last = null, resync = true;
const active = () => subscriptions.size > 0 && !document.hidden;

function accept(data) {
  const room = data?.topics?.listeners, catalog = data?.topics?.catalog;
  if (!/^[0-9a-f]{16}$/.test(room?.version || "") || !Array.isArray(room.listeners) ||
      !/^[0-9a-f]{16}$/.test(catalog?.version || "") || data.version !== room.version + catalog.version) return false;
  const before = last;
  last = data;
  for (const [topic, callbacks] of subscriptions) {
    if (!resync && before?.topics[topic]?.version === data.topics[topic]?.version) continue;
    for (const callback of callbacks) {
      try { callback(data.topics[topic]); } catch { /* One screen cannot stop other subscribers. */ }
    }
  }
  resync = false;
  return true;
}
function follow() {
  if (!active() || live) return;
  if (!socket && typeof WebSocket === "function" && Date.now() >= restUntil) connect();
  if (!socket) void poll();
}
function connect() {
  let line;
  try { line = new WebSocket(SOCKET_URL); } catch { restUntil = Date.now() + REST_MS; return; }
  socket = line;
  let fed = false;
  const grace = setTimeout(() => { if (socket === line && !live) void poll(); }, 3000);
  line.addEventListener("message", event => {
    if (socket !== line || !active()) return;
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    // A valid first snapshot catches changes made while disconnected, even if
    // a different machine happens to have the same revision as our last one.
    if (!fed) resync = true;
    if (!accept(data)) return;
    fed = live = true;
    failures = 0;
  });
  line.addEventListener("close", () => {
    clearTimeout(grace);
    if (socket !== line) return;
    socket = null;
    live = false;
    epoch++;
    resync = true;
    const rest = fed ? 1000 + Math.random() * 2000 : ++failures >= 3 ? REST_MS : 2000 * 2 ** failures;
    if (failures >= 3) failures = 0;
    restUntil = Date.now() + rest;
    clearTimeout(timer);
    timer = setTimeout(follow, rest + 50);
    void poll();
  });
}
function hangUp() {
  clearTimeout(timer);
  const line = socket;
  socket = null;
  live = false;
  epoch++;
  resync = true;
  line?.close();
}
async function poll() {
  if (polling || live || !active()) return;
  polling = true;
  let failed = 0;
  while (active() && !live) {
    if (!socket && Date.now() >= restUntil && typeof WebSocket === "function") connect();
    const asked = resync ? "" : last?.version || "", began = Date.now(), cycle = epoch;
    let wait = 0;
    try {
      const data = await api(`/events${asked ? `?since=${asked}` : ""}`, { anonymous: true, timeout: 35000 });
      // A held response may arrive after a newer socket snapshot or a return
      // from the background. It must never put older state back on screen.
      if (live || cycle !== epoch || !active()) continue;
      if (!accept(data)) throw new Error("Invalid event snapshot");
      failed = 0;
      if (data.version === asked && Date.now() - began < 5000) wait = 5000;
    } catch (error) {
      wait = error.status === 404 ? 300000 : Math.min(60000, 5000 * 2 ** Math.min(failed++, 4));
    }
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  }
  polling = false;
}
export function subscribe(topic, callback, { signal } = {}) {
  if (!["listeners", "catalog"].includes(topic)) throw new Error("Unknown public topic");
  if (signal?.aborted) return () => {};
  if (!subscriptions.has(topic)) subscriptions.set(topic, new Set());
  subscriptions.get(topic).add(callback);
  const leave = () => {
    subscriptions.get(topic)?.delete(callback);
    if (!subscriptions.get(topic)?.size) subscriptions.delete(topic);
    if (!subscriptions.size) hangUp();
  };
  signal?.addEventListener("abort", leave, { once: true });
  if (last) queueMicrotask(() => {
    if (subscriptions.get(topic)?.has(callback)) {
      try { callback(last.topics[topic]); } catch { /* Keep subscribers independent. */ }
    }
  });
  if (!started) {
    started = true;
    document.addEventListener("visibilitychange", () => { if (document.hidden) hangUp(); else follow(); });
    addEventListener("pagehide", hangUp);
    addEventListener("pageshow", event => { if (event.persisted) follow(); });
  }
  follow();
  return leave;
}
// Bursts (a seed, publication or several votes) cause one refresh. Abort belongs
// to the page's scope, so a swapped-out screen never refreshes its replacement.
export function watchCatalog(refresh, { signal, getRevision = () => null } = {}) {
  let timer, initial = true;
  const leave = subscribe("catalog", snapshot => {
    // Only the first snapshot can be satisfied by the completed initial read.
    // Reconnects still resync personal state, even at an unchanged public revision.
    const matches = initial && snapshot.version === getRevision();
    initial = false;
    if (matches) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!signal?.aborted && !document.hidden) void refresh(); }, 200);
  }, { signal });
  const stop = () => { clearTimeout(timer); leave(); };
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
