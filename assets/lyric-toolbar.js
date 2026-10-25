// Keep native disclosure keyboard behavior, with one compact popover open at a time.
export function mountLyricToolbar(main) {
  const toolbar = main.querySelector(".lyric-toolbar");
  const controller = new AbortController(), { signal } = controller;
  const panels = [...toolbar.querySelectorAll(".sheet-more, .profile-details, .lyric-view-help")];
  const profileSummary = toolbar.querySelector(".profile-details > summary");
  profileSummary.classList.add("sheet-icon", "sheet-profile");
  profileSummary.title = "Listener profile";
  const close = except => panels.forEach(panel => { if (panel !== except) panel.open = false; });
  for (const panel of panels) {
    const summary = panel.querySelector("summary");
    summary.setAttribute("role", "button");
    summary.setAttribute("aria-expanded", String(panel.open));
    panel.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", String(panel.open));
      if (panel.open) close(panel);
    }, { signal });
  }
  document.addEventListener("click", event => { if (!toolbar.contains(event.target)) close(); }, { signal });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const open = panels.find(panel => panel.open);
    if (!open) return;
    close();
    open.querySelector("summary").focus({ preventScroll: true });
  }, { signal });
  return () => controller.abort();
}
