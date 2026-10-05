import videos from "./song-videos.js";
import { videoVersions } from "./song-video-versions.js";
import { player, audio } from "./player.js";
import { videoLoopAudio } from "./video-loop-audio.js";

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
  dialog.innerHTML = `<header><div><h2 id="song-video-title"></h2><p data-video-description></p></div><button type="button" data-video-close autofocus aria-label="Close video">Close ×</button></header><video controls muted loop playsinline preload="none"></video><p class="song-video-status" role="status"></p>`;
  const versions = document.createElement("div");
  versions.className = "song-video-versions";
  versions.setAttribute("role", "group");
  versions.setAttribute("aria-label", "Compare video versions");
  versions.hidden = true;
  dialog.querySelector("header").after(versions);
  document.body.append(dialog);
  const full = dialog.querySelector("video");
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Play video with sound";
  play.dataset.videoPlay = "";
  play.hidden = true;
  full.before(play);
  const soundControls = document.createElement("div");
  soundControls.hidden = true;
  soundControls.className = "song-video-sound-controls";
  soundControls.innerHTML = `<label><input type="checkbox" checked data-video-sound> Sound on</label><label>Volume <input type="range" min="0" max="1" step="0.05" value="1" aria-label="Video volume"></label>`;
  full.before(soundControls);
  const soundToggle = soundControls.querySelector("[data-video-sound]");
  const soundVolume = soundControls.querySelector("[type=range]");
  full.muted = true;
  const close = dialog.querySelector("[data-video-close]");
  const status = dialog.querySelector(".song-video-status");
  const loopAudio = videoLoopAudio(full, () => {
    full.pause();
    status.textContent = "The audio could not load. Press Play to try again.";
  }, () => { status.textContent = ""; });
  let timer, candidate, active, opener, songId, generation = 0;
  let choices = [], playbackGeneration = 0;
  let sound = false;
  function selectVersion(index) {
    const video = choices[index];
    if (!video) return;
    const token = ++playbackGeneration;
    full.pause();
    loopAudio.select(video.loopAudio);
    soundControls.hidden = !video.loopAudio;
    soundToggle.checked = true;
    soundVolume.value = String(full.volume);
    sound = Boolean(video.hasAudio || video.audio);
    full.dataset.sound = String(sound);
    play.hidden = !sound;
    if (sound) player.pause();
    status.textContent = "Loading video…";
    const duration = video.duration || 15;
    dialog.querySelector("[data-video-description]").textContent = video.hasAudio
      ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")} music video · Sing along`
      : video.audio
      ? `${video.duration || 15}-second video with chorus audio · Press Play to watch with sound`
      : `${video.duration || 15}-second silent video`;
    for (const button of versions.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.version) === index));
    }
    full.dataset.framing = video.framing;
    dialog.dataset.framing = video.framing;
    full.loop = !video.fullLength;
    full.muted = !sound;
    full.defaultMuted = !sound;
    full.preload = sound ? "auto" : "none";
    full.src = video.loopVideo || video.src;
    if (sound && !video.hasAudio) {
      full.load();
      status.textContent = "Press Play to watch with sound.";
      return;
    }
    full.play().catch(() => {
      if (dialog.open && token === playbackGeneration) status.textContent = full.error ? "The video could not load. Try another version or close and try again." : "Press play to watch the video.";
    });
  }
  scope.on(dialog, "pointerdown", () => loopAudio.prime());
  scope.on(dialog, "keydown", () => loopAudio.prime());
  scope.on(play, "click", async () => {
    const token = playbackGeneration;
    player.pause();
    // Keep play() in the click gesture; decoding the lossless sound can take
    // longer than browser autoplay permission lasts. Sound joins at video time.
    loopAudio.prime();
    status.textContent = "Starting video…";
    try {
      await full.play();
    } catch {
      if (dialog.open && token === playbackGeneration) status.textContent = "The video could not start. Press Play to try again.";
    }
  });
  // Native video controls also use the shared player, including its crossfade deck.
  scope.on(full, "play", () => { if (sound && !full.muted) player.pause(); });
  scope.on(full, "pause", () => { loopAudio.pause(); play.hidden = !sound; });
  scope.on(full, "seeked", () => loopAudio.seek());
  scope.on(full, "pointerup", () => loopAudio.seek(true));
  scope.on(full, "keyup", () => loopAudio.seek(true));
  scope.on(full, "volumechange", () => {
    loopAudio.volume();
    if (dialog.open && sound && !full.paused && !full.muted) player.pause();
    soundVolume.value = String(full.volume);
    soundToggle.checked = !full.muted;
  });
  scope.on(audio, "play", () => {
    if (dialog.open && sound && !full.muted) full.pause();
  });
  scope.on(soundToggle, "change", () => { full.muted = !soundToggle.checked; });
  scope.on(soundVolume, "input", () => { full.volume = Number(soundVolume.value); });
  scope.on(full, "ratechange", () => loopAudio.rate());
  scope.on(versions, "click", event => {
    const button = event.target.closest("[data-version]");
    if (button && button.getAttribute("aria-pressed") !== "true") selectVersion(Number(button.dataset.version));
  });
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
      preview.src = video.previewSrc || video.src;
      try {
        await preview.play();
        if (token === generation && active === art) art.classList.add("is-video-playing");
      } catch { if (token === generation) stop(); }
    }, 3000);
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
    full.dataset.songId = songId;
    dialog.querySelector("h2").textContent = button.closest(".track").querySelector("h3")?.textContent || "Song video";
    choices = videoVersions(songId);
    versions.replaceChildren(...choices.map((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.version = index;
      button.textContent = choice.label;
      button.classList.toggle("is-current-version", index === choices.length - 1);
      button.setAttribute("aria-label", `Version ${choice.label}${index === choices.length - 1 ? " (latest)" : ""}`);
      return button;
    }));
    versions.hidden = choices.length < 2;
    dialog.showModal();
    document.documentElement.classList.add("song-video-open");
    close.focus({ preventScroll: true });
    selectVersion(choices.length - 1);
  });
  scope.on(full, "playing", () => {
    if (sound && !full.muted) player.pause();
    status.textContent = loopAudio.pending ? "Loading sound…" : "";
    play.hidden = true;
    void loopAudio.play();
  });
  scope.on(full, "error", () => { status.textContent = "The video could not load. Close and try again."; });
  scope.on(close, "click", () => dialog.close());
  scope.on(dialog, "close", () => {
    if (dialog.open) return;
    playbackGeneration++;
    loopAudio.pause();
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
    playbackGeneration++;
    loopAudio.destroy();
    observer.disconnect();
    stop();
    release(full);
    dialog.close();
    dialog.remove();
    document.documentElement.classList.remove("song-video-open");
  });
}
