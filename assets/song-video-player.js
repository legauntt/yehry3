import videos from "./song-videos.js";

export function mountSongVideos(root, scope) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const preview = document.createElement("video");
  preview.className = "song-video-preview";
  preview.muted = true;
  preview.loop = true;
  preview.playsInline = true;
  preview.preload = "none";
  preview.setAttribute("aria-hidden", "true");
  const dialog = document.createElement("dialog");
  dialog.className = "song-video-viewer";
  dialog.setAttribute("aria-labelledby", "song-video-title");
  dialog.innerHTML = `<header><div><h2 id="song-video-title"></h2><p>15-second silent video</p></div><button type="button" data-video-close autofocus aria-label="Close video">Close ×</button></header><video controls muted loop playsinline preload="none"></video><p class="song-video-status" role="status"></p>`;
  document.body.append(dialog);
  const full = dialog.querySelector("video");
  full.muted = true;
  const close = dialog.querySelector("[data-video-close]");
  const status = dialog.querySelector(".song-video-status");
  let timer, candidate, active, opener, songId, generation = 0;
  function release(video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  function stop() {
    clearTimeout(timer);
    candidate = null;
    generation++;
    active?.classList.remove("is-video-playing");
    active = null;
    if (preview.hasAttribute("src")) release(preview);
    preview.remove();
  }
  function eligible(card) {
    return card?.isConnected && root.dataset.view === "grid" && fine.matches && !reduced.matches
      && !document.hidden && !document.querySelector("dialog[open]") && !navigator.connection?.saveData;
  }
  function schedule(card) {
    if (active?.closest(".track") === card) return;
    stop();
    if (!eligible(card)) return;
    candidate = card;
    timer = setTimeout(async () => {
      const art = card.querySelector("[data-video-art]");
      const video = videos[art?.dataset.videoArt];
      if (candidate !== card || !eligible(card) || !card.matches(":hover") || !video) return;
      const token = ++generation;
      active = art;
      preview.dataset.framing = video.framing;
      art.append(preview);
      preview.src = video.src;
      try {
        await preview.play();
        if (token === generation && active === art) art.classList.add("is-video-playing");
      } catch { if (token === generation) stop(); }
    }, 2000);
  }
  scope.on(root, "pointermove", event => {
    if (event.pointerType !== "mouse") return;
    const card = event.target.closest(".track");
    if (card?.querySelector("[data-video-art]")) schedule(card);
    else stop();
  });
  scope.on(root, "pointerout", event => {
    const card = event.target.closest(".track");
    if (card && !card.contains(event.relatedTarget)) stop();
  });
  scope.on(root, "pointerdown", stop);
  scope.on(window, "scroll", stop, { capture: true, passive: true });
  scope.on(window, "blur", stop);
  scope.on(document, "visibilitychange", () => { stop(); if (document.hidden) full.pause(); });
  scope.on(reduced, "change", stop);
  scope.on(fine, "change", stop);
  scope.on(preview, "error", stop);
  // Covers, menus and other interactions cancel the idle preview timer as well.
  scope.on(document, "click", stop, { capture: true });
  scope.on(document, "keydown", stop, { capture: true });
  const observer = new MutationObserver(() => {
    if ((active && !root.contains(active)) || (candidate && !root.contains(candidate)) || root.dataset.view !== "grid") stop();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-view"] });
  scope.on(root, "click", event => {
    const button = event.target.closest("[data-video-open]");
    const video = videos[button?.dataset.videoOpen];
    if (!video || dialog.open) return;
    opener = button;
    songId = button.dataset.videoOpen;
    dialog.querySelector("h2").textContent = button.closest(".track").querySelector("h3")?.textContent || "Song video";
    status.textContent = "Loading video…";
    full.src = video.src;
    dialog.showModal();
    document.documentElement.classList.add("song-video-open");
    close.focus({ preventScroll: true });
    full.play().catch(() => {
      if (dialog.open) status.textContent = full.error ? "The video could not load. Close and try again." : "Press play to watch the video.";
    });
  });
  scope.on(full, "playing", () => { status.textContent = ""; });
  scope.on(full, "error", () => { status.textContent = "The video could not load. Close and try again."; });
  scope.on(close, "click", () => dialog.close());
  scope.on(dialog, "close", () => {
    if (dialog.open) return;
    release(full);
    document.documentElement.classList.remove("song-video-open");
    if (!scope.left) (opener?.isConnected ? opener : root.querySelector(`[data-video-open="${CSS.escape(songId)}"]`))?.focus({ preventScroll: true });
  });
  scope.on(dialog, "click", event => {
    if (event.target !== dialog) return;
    const b = dialog.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close();
  });
  scope.onLeave(() => {
    observer.disconnect();
    stop();
    release(full);
    dialog.close();
    dialog.remove();
    document.documentElement.classList.remove("song-video-open");
  });
}
