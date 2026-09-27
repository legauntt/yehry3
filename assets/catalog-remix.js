import { publicApi } from "./api.js";

// A page-local cache coalesces repeated opens, but never turns catalog rendering
// into one request per track. Failures are retried on the next menu open.
export function createRemixLookup() {
  const entries = new Map();
  function peek(id) {
    const entry = entries.get(id);
    if (entry?.pending) return { status: "loading" };
    return entry?.until > Date.now() ? entry.availability : undefined;
  }
  function load(id) {
    const entry = entries.get(id);
    if (entry?.pending) return entry.pending;
    if (peek(id)) return Promise.resolve(entry.availability);
    const pending = publicApi(`/songs/${encodeURIComponent(id)}/remix`)
      .then(({ remixAvailability }) => {
        if (!["ready", "unavailable"].includes(remixAvailability?.status)) throw new Error("Remix availability did not load.");
        const until = Math.min(Date.now() + 30000, remixAvailability.status === "ready"
          ? Date.parse(remixAvailability.expiresAt) || 0 : Infinity);
        entries.set(id, { availability: remixAvailability, until });
        return remixAvailability;
      })
      .catch(error => { entries.delete(id); throw error; });
    entries.set(id, { pending });
    return pending;
  }
  return { peek, load };
}
