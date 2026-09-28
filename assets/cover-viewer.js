import artwork from "./artwork-catalog.js";

// The whole saved cover is a native button, including keyboard activation.
// This viewer never touches the player or its audio element.
export function mountCoverViewer(root, scope) {
  const dialog = document.createElement("dialog");
  dialog.className = "cover-viewer";
  dialog.setAttribute("aria-labelledby", "cover-viewer-title");
  dialog.innerHTML = `<header class="cover-viewer-header"><h2 id="cover-viewer-title"></h2><div class="cover-viewer-actions"><button type="button" data-cover-zoom aria-pressed="false">Actual size</button><a data-cover-original target="_blank" rel="noopener">Open original ↗</a><button type="button" data-cover-close autofocus aria-label="Close cover">Close ×</button></div></header><p class="cover-viewer-status" role="status"></p><div class="cover-viewer-image"><img alt="" decoding="async"></div>`;
  document.body.append(dialog);
  const title = dialog.querySelector("h2");
  const image = dialog.querySelector("img");
  const viewport = dialog.querySelector(".cover-viewer-image");
  const status = dialog.querySelector(".cover-viewer-status");
  const zoom = dialog.querySelector("[data-cover-zoom]");
  const original = dialog.querySelector("[data-cover-original]");
  const close = dialog.querySelector("[data-cover-close]");
  let opener, songId;

  function fit() {
    dialog.classList.remove("is-zoomed");
    zoom.setAttribute("aria-pressed", "false");
    zoom.textContent = "Actual size";
    viewport.scrollTo(0, 0);
  }
  scope.on(root, "click", event => {
    const button = event.target.closest("[data-cover-open]");
    if (!button || dialog.open) return;
    const art = artwork[button.dataset.coverOpen];
    if (!art) return;
    opener = button;
    songId = button.dataset.coverOpen;
    title.textContent = button.closest(".track").querySelector("h3")?.textContent || "Song cover";
    image.alt = art.alt;
    original.href = art.src;
    fit();
    status.textContent = "Loading cover…";
    image.src = art.src;
    dialog.showModal();
    document.documentElement.classList.add("cover-viewer-open");
    close.focus({ preventScroll: true });
  });
  scope.on(image, "load", () => { status.textContent = ""; });
  scope.on(image, "error", () => { status.textContent = "The cover could not load. Try Open original."; });
  scope.on(close, "click", () => dialog.close());
  scope.on(zoom, "click", () => {
    if (dialog.classList.contains("is-zoomed")) return fit();
    dialog.classList.add("is-zoomed");
    zoom.setAttribute("aria-pressed", "true");
    zoom.textContent = "Fit image";
  });
  scope.on(dialog, "close", () => {
    if (dialog.open) return; // Ignore a queued close event after a quick reopen.
    document.documentElement.classList.remove("cover-viewer-open");
    image.removeAttribute("src");
    // A catalog refresh can replace the trigger while the viewer is open.
    const target = opener?.isConnected ? opener : root.querySelector(`[data-cover-open="${CSS.escape(songId)}"]`);
    target?.focus({ preventScroll: true });
  });
  scope.on(dialog, "click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
      dialog.close();
  });
  scope.on(dialog, "keydown", event => {
    if (event.key !== "Tab") return; // Escape uses native dialog dismissal.
    if (event.shiftKey && document.activeElement === zoom) {
      event.preventDefault(); close.focus();
    } else if (!event.shiftKey && document.activeElement === close) {
      event.preventDefault(); zoom.focus();
    }
  });
  scope.onLeave(() => {
    dialog.close();
    dialog.remove();
    document.documentElement.classList.remove("cover-viewer-open");
  });
}
