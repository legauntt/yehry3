// A short local record of the Remix flow, kept only in this browser. Ids and
// states, never prompt text. Read it with `yehry3RemixTrace()` in the console.
const KEY = "yehry3:remix-trace";
const LIMIT = 60;

export function remixTrace() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

export function traceRemix(event, fields = {}) {
  const entry = { at: new Date().toISOString(), event, page: location.pathname + location.search, ...fields };
  try { localStorage.setItem(KEY, JSON.stringify([...remixTrace(), entry].slice(-LIMIT))); } catch { /* Tracing is optional. */ }
  try { console.info("[remix]", event, fields); } catch { /* No console. */ }
}

export const draftRemixId = (doc) => doc?.details?.remixSource?.songId || null;

window.yehry3RemixTrace = remixTrace;
