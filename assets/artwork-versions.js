// Only public image metadata belongs here; generation inputs stay private.
export function artworkVersions(art) {
  if (!art?.src) return [];
  const seen = new Set();
  const prior = [...(art.history || []), ...(art.previous ? [{ src: art.previous, alt: "Earlier cover artwork" }] : [])];
  return [...prior.filter(version => version.src !== art.src), art]
    .filter(version => version?.src && !seen.has(version.src) && seen.add(version.src))
    .map((version, index) => ({ src: version.src, alt: version.alt || "Cover artwork", ...(version.createdAt ? { createdAt: version.createdAt } : {}), label: String(index + 1) }));
}

export function retainArtworkHistory(current, next) {
  const history = artworkVersions(current).filter(version => version.src !== next.src)
    .map(({ label, ...version }) => version);
  return { ...next, history, previous: history.at(-1)?.src || null };
}
