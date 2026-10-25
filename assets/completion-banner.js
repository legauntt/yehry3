// Keep a visible route to a song that finished while this page was open.
export function completionBanner(scope) {
  let active = null;
  const banner = document.createElement("aside");
  banner.className = "completion-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;
  document.body.append(banner);
  scope.onLeave(() => banner.remove());

  return ({ inStudio = [], queued = [], recent = [] }) => {
    const next = new Set([...inStudio, ...queued].map(song => song.id));
    let found = false;
    if (active) {
      const finished = recent.filter(song => active.has(song.id)
        && !next.has(song.id) && /^distonyc-[a-f0-9]{24}$/.test(song.id));
      if (finished.length) {
        found = true;
        banner.replaceChildren();
        const message = document.createElement("span");
        message.textContent = finished.length === 1
          ? `Ready to hear: ${finished[0].title || finished[0].idea || "New song"}.`
          : `${finished.length} songs are ready to hear.`;
        const link = document.createElement("a");
        // A distinct catalog URL reloads its snapshot even when this banner is
        // clicked from the collection page before its next catalog poll.
        link.href = `/?collection=all#${finished[0].id}`;
        link.textContent = finished.length === 1 ? "Find it in the catalog →" : "Find the newest in the catalog →";
        const close = document.createElement("button");
        close.type = "button";
        close.setAttribute("aria-label", "Dismiss song announcement");
        close.textContent = "×";
        close.addEventListener("click", () => { banner.hidden = true; });
        banner.append(message, link, close);
        banner.hidden = false;
      }
    }
    active = next;
    return found;
  };
}
