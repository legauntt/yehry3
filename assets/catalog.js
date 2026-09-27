import { API_BASE } from "./config.js";
import { api } from "./api.js";

// The public snapshot is reused only within this mounted catalog. Personal state
// is read on every refresh and never written into the shared snapshot.
export function createCatalogLoader({ request = fetch, state = options => api("/catalog/state", options) } = {}) {
  let snapshot, etag;
  async function publicSnapshot({ timeout = 15000 } = {}) {
    const response = await request(`${API_BASE}/catalog`, {
      headers: etag ? { "If-None-Match": etag } : {},
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status === 304 && snapshot) return snapshot;
    if (!response.ok) throw new Error("The catalog could not load. Please try again.");
    const data = await response.json();
    if (!Array.isArray(data.songs)) throw new Error("The catalog could not load. Please try again.");
    snapshot = data;
    etag = response.headers.get("ETag");
    return snapshot;
  }
  return async options => {
    const [catalog, personal] = await Promise.all([publicSnapshot(options), state(options)]);
    return {
      ...catalog,
      songs: catalog.songs.map(song => ({ ...song, feedback: {
        downvoted: false, milquetoast: false, pinned: false, artRemixed: false,
        ...(Object.hasOwn(personal.feedback || {}, song.id) ? personal.feedback[song.id] : {}),
      } })),
      nextVoteAt: personal.nextVoteAt ?? null,
    };
  };
}
