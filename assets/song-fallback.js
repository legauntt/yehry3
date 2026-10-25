// A song can be published before Azure has built its per-song share page.
// Confirm it is public before sending a visitor to its live collection entry.
const match = /^\/song\/([a-z0-9-]{1,120})(?:\/(?:index\.html)?)?$/.exec(location.pathname);
if (match) {
  const { API_BASE } = await import("./config.js");
  const id = match[1];
  try {
    const response = await fetch(`${API_BASE}/songs/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const { song } = await response.json();
      if (song?.id === id && song.status === "published") {
        location.replace(`/?shared=${encodeURIComponent(id)}#${encodeURIComponent(id)}`);
      }
    }
  } catch {
    // Keep the normal 404 page if the API cannot confirm the song.
  }
}
