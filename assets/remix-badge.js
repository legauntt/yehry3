// A recording is a remix from the moment its source is frozen on the request,
// long before publication fills in the parent link on the catalog entry.
export function remixOrigin(item) {
  const source = item?.remixOf || item?.details?.remixSource || item?.originalPrompt?.remixOf;
  return source?.songId ? source : null;
}

export function remixBadge(item) {
  const source = remixOrigin(item);
  if (!source) return "";
  const title = source.title
    ? `Remix of “${String(source.title).replace(/[&<>"']/g, (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])}”`
    : "Remix of another recording";
  return `<span class="remix-badge" title="${title}">Remix</span>`;
}
