const restored = new WeakSet();

export function sharedTimestamp(url = new URL(location.href)) {
  const value = url.searchParams.get("t");
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(value || "")) return null;
  const seconds = Number(value);
  return seconds <= 86400 ? seconds : null;
}

const timeLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function mountMomentSharing(main) {
  const player = main.querySelector(".shared-song-player"), audio = player?.querySelector("audio");
  if (!audio) return () => {};
  const controller = new AbortController(), { signal } = controller;
  const panel = document.createElement("div");
  panel.className = "lyric-moment";
  panel.innerHTML = '<div class="actions"><button type="button" class="quiet" id="share-moment">Share this moment</button></div><p class="small" id="moment-status" role="status"></p><div id="moment-link-field" hidden><label for="moment-link">Link to this moment</label><input id="moment-link" type="text" readonly></div>';
  player.append(panel);
  const button = panel.querySelector("#share-moment"), status = panel.querySelector("#moment-status");
  const update = () => { button.textContent = `Share this moment · ${timeLabel(audio.currentTime || 0)}`; };
  const timestamp = sharedTimestamp();
  if (timestamp !== null && !restored.has(audio)) {
    const seek = () => {
      if (restored.has(audio)) return;
      restored.add(audio);
      audio.currentTime = Number.isFinite(audio.duration) ? Math.min(timestamp, Math.max(0, audio.duration - .1)) : timestamp;
      status.textContent = `Starts at ${timeLabel(audio.currentTime)}. Press play when you’re ready.`;
      update();
    };
    if (audio.readyState) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true, signal });
  }
  button.addEventListener("click", async () => {
    const seconds = Math.max(0, Math.round((audio.currentTime || 0) * 10) / 10);
    const url = new URL(location.href);
    url.searchParams.set("t", String(seconds));
    const lines = [...main.querySelectorAll("button.lyric-line")];
    const line = lines.filter(item => Number(item.dataset.start) <= seconds).at(-1);
    url.hash = line?.id || "";
    history.replaceState(history.state, "", url);
    main.querySelectorAll(".lyric-line.is-linked").forEach(item => item.classList.remove("is-linked"));
    line?.classList.add("is-linked");
    const input = panel.querySelector("#moment-link");
    input.value = url.href;
    panel.querySelector("#moment-link-field").hidden = false;
    try { await navigator.clipboard.writeText(url.href); status.textContent = `Link copied at ${timeLabel(seconds)}.`; }
    catch { input.focus(); input.select(); status.textContent = `Copy this link to share the song at ${timeLabel(seconds)}.`; }
  }, { signal });
  audio.addEventListener("timeupdate", update, { signal });
  audio.addEventListener("seeking", update, { signal });
  update();
  return () => controller.abort();
}
