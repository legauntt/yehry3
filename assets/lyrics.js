import { songBadges } from "./song-badges.js";
import { mountLoopToggle } from "./loop.js";
import { songPlanLink } from "./song-plan.js";
import { authoredByLine } from "./authored-by.js";
import { resolveLyricsSongId, watchSong } from "./song-data.js";
import { qualityNotice } from "./quality.js";
import { mountFavorites } from "./favorites.js";
import { listeningLabel } from "./listening.js";
import { player } from "./player.js";
import { currentScope } from "./page-scope.js";
import { remixLink } from "./remix.js";
import { mountRemixComparison } from "./remix-comparison.js";
import { mountMomentSharing, sharedTimestamp } from "./lyric-moments.js";
import { clock } from "./song-time.js";

function cueMap(lyrics) {
  const lines = lyrics.text.split("\n");
  return new Map(
    (lyrics.cues || [])
      .filter(
        (cue) =>
          Number.isInteger(cue.line) &&
          cue.line >= 0 &&
          cue.line < lines.length &&
          Number.isFinite(cue.start) &&
          Number.isFinite(cue.end) &&
          cue.start >= 0 &&
          cue.end > cue.start,
      )
      .map((cue) => [cue.line, cue]),
  );
}

function lyricLines(lyrics, escape) {
  const cues = cueMap(lyrics);
  return lyrics.text
    .split("\n")
    .map((line, index) => {
      if (!line.trim()) return '<span class="lyric-break" aria-hidden="true"></span>';
      if (/^\s*\[[^\]]+]\s*$/.test(line))
        return `<span class="lyric-heading">${escape(line)}</span>`;
      const cue = cues.get(index);
      return cue
        ? `<button type="button" class="lyric-line" id="lyric-line-${index + 1}" data-start="${cue.start}" data-end="${cue.end}" title="Jump to this line"><span>${escape(line)}</span><span class="lyric-link-marker">Shared line</span></button>`
        : `<span class="lyric-line">${escape(line)}</span>`;
    })
    .join("");
}

// What a lyric sheet knows about the site's one player: whether its song is the one loaded, and where
// it will start if it is not. Pressing play on a sheet loads the song into the player, so it goes on
// playing (and shows in the bottom bar) when the visitor moves to another page. A sheet never takes
// the player over by itself: choosing a line or opening a shared moment only remembers the place.
export function sheetFor(song) {
  const audio = player.audio;
  const sheet = {
    song,
    audio,
    pendingAt: null,
    // What draws the sheet asks to hear when the place it will start from changes.
    watchers: new Set(),
    isCurrent: () => player.current?.id === sheet.song.id,
    // Where the song is, or will be when it is played.
    position: () => (sheet.isCurrent() ? audio.currentTime || 0 : sheet.pendingAt ?? 0),
    seek(seconds) {
      if (!sheet.isCurrent()) {
        // An idle player is readied at the place, paused; one that is busy with something else is left alone.
        if (!player.current) { sheet.pendingAt = null; void player.load(sheet.song, [sheet.song], { source: "lyrics", at: seconds }); return; }
        sheet.pendingAt = seconds; sheet.watchers.forEach((watcher) => watcher()); return;
      }
      const to = () => { audio.currentTime = seconds; };
      if (audio.readyState) to();
      else audio.addEventListener("loadedmetadata", to, { once: true });
    },
    async start() {
      const at = sheet.pendingAt;
      sheet.pendingAt = null;
      return player.play(sheet.song, [sheet.song], { source: "lyrics", at });
    },
    async toggle() {
      return sheet.isCurrent() ? player.toggle(sheet.song, undefined, { source: "lyrics" }) : sheet.start();
    },
  };
  return sheet;
}

function mountKaraoke(main, sheet) {
  const audio = sheet.audio;
  const lines = [...main.querySelectorAll("button.lyric-line")];
  if (!lines.length) return () => {};
  const controller = new AbortController();
  const { signal } = controller;
  let active;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  function lineFromHash() {
    const match = /^#lyric-line-(\d+)$/.exec(location.hash);
    return match ? lines.find((line) => line.id === `lyric-line-${match[1]}`) : undefined;
  }
  function sync(follow = sheet.isCurrent() && !audio.paused) {
    // A song that is not loaded has no line playing, though a place chosen on the sheet shows.
    const time = sheet.isCurrent() ? audio.currentTime : sheet.pendingAt ?? -1;
    let current;
    if (time >= 0)
      for (const line of lines) {
        if (Number(line.dataset.start) > time) break;
        current = line;
      }
    if (current === active) return;
    active?.classList.remove("is-active");
    active?.removeAttribute("aria-current");
    active = current;
    active?.classList.add("is-active");
    active?.setAttribute("aria-current", "true");
    if (active && follow) {
      const box = active.getBoundingClientRect();
      if (box.top < innerHeight * 0.3 || box.bottom > innerHeight * 0.72)
        active.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
    }
  }
  function markLinked(line) {
    for (const candidate of lines) candidate.classList.toggle("is-linked", candidate === line);
  }
  function selectLine(line, updateUrl = false) {
    if (!line) return;
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.delete("t"); url.hash = line.id;
      history.replaceState(history.state, "", url);
    }
    markLinked(line);
    sheet.seek(Number(line.dataset.start));
    sync(false);
  }
  for (const line of lines) line.addEventListener("click", () => selectLine(line, true));
  const linkedLine = lineFromHash();
  if (linkedLine && !(sheet.isCurrent() && (audio.currentTime || !audio.paused))) {
    linkedLine.scrollIntoView({ block: "center" });
    if (sharedTimestamp() === null) selectLine(linkedLine);
    else markLinked(linkedLine);
  }
  addEventListener("hashchange", () => {
    const line = lineFromHash();
    markLinked(line);
    if (!line) return;
    line.scrollIntoView({ block: "center" });
    selectLine(line);
  }, { signal });
  audio.addEventListener("timeupdate", () => sync(), { signal });
  audio.addEventListener("seeking", () => sync(), { signal });
  audio.addEventListener("play", () => sync(true), { signal });
  player.on("change", () => sync(false), signal);
  sync(false);
  return () => controller.abort();
}

// The play button, clock and scrubber on the sheet: the player's own state, drawn for this song.
function mountSheetControls(main, sheet) {
  const controller = new AbortController(), { signal } = controller;
  const button = main.querySelector("#sheet-play"), time = main.querySelector("#sheet-time"), seek = main.querySelector("#sheet-seek");
  if (!button) return () => {};
  const audio = sheet.audio;
  function sync() {
    const current = sheet.isCurrent(), playing = current && player.playing;
    button.textContent = playing ? "Pause" : current && audio.currentTime > 0 && !audio.ended ? "Resume" : "Play";
    button.setAttribute("aria-pressed", String(playing));
    const seekable = current && Number.isFinite(audio.duration) && audio.duration > 0;
    seek.disabled = !seekable;
    seek.max = seekable ? audio.duration : 100;
    if (document.activeElement !== seek) seek.value = seekable ? audio.currentTime : 0;
    time.textContent = seekable ? `${clock(audio.currentTime)} / ${clock(audio.duration)}` : current ? clock(audio.currentTime) : sheet.pendingAt ? `Starts at ${clock(sheet.pendingAt)}` : "";
    seek.setAttribute("aria-valuetext", time.textContent || "Not playing");
  }
  button.addEventListener("click", async () => {
    const started = await sheet.toggle();
    main.querySelector("#sheet-status").textContent = started === false ? "Press play in the player to start this song." : "";
    sync();
  }, { signal });
  seek.addEventListener("input", () => { if (sheet.isCurrent()) audio.currentTime = Number(seek.value); sync(); }, { signal });
  for (const event of ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange", "emptied", "seeking"])
    audio.addEventListener(event, sync, { signal });
  player.on("change", sync, signal);
  sheet.watchers.add(sync);
  signal.addEventListener("abort", () => sheet.watchers.delete(sync), { once: true });
  sync();
  return () => controller.abort();
}

export async function lyricsPage(main, { escape, safeUrl }) {
  const scope = currentScope();
  const id =
    new URLSearchParams(location.search).get("song") ||
    document.body.dataset.songId ||
    await resolveLyricsSongId(location.pathname);
  let cleanupKaraoke = () => {}, cleanupMoments = () => {}, cleanupControls = () => {}, downloadUrl, favorites, profilePanel, comparison, loop, sheet;
  function render(song) {
    const previousPosition = main.querySelector(".lyrics-sheet") ? [scrollX, scrollY] : null;
    if (!song?.lyrics?.text) {
      main.innerHTML =
        '<section class="lyrics-sheet"><p class="eyebrow">Lyrics</p><h1>This sheet is not available yet.</h1><a class="text-link" href="/">Back to the collection →</a></section>';
      return;
    }
    document.title = `${song.title} · Lyrics · yehry3`;
    const note =
      song.lyrics.kind === "transcribed"
        ? "Source transcription; some words may be inaccurate."
        : "Lyrics supplied for this recording. The performance may vary.";
    const audioUrl = escape(safeUrl(song.url));
    const hasCues = cueMap(song.lyrics).size > 0;
    main.innerHTML = `<article class="lyrics-sheet"><p class="eyebrow">The lyric sheet</p><h1>${escape(song.title)}</h1>${authoredByLine(song.authoredBy, escape)}${songBadges(song)}${qualityNotice(song.qualityIssues, song.reviewState, song.validationFailures)}<p class="small">${note}</p><section class="shared-song-player" aria-label="Listen to ${escape(song.title)}"><p class="tiny-label">Listen here</p><div class="sheet-controls"><button type="button" class="primary" id="sheet-play" aria-pressed="false" aria-label="Play ${escape(song.title)}">Play</button><span class="small sheet-time" id="sheet-time"></span><label class="sr-only" for="sheet-seek">Seek in ${escape(song.title)}</label><input id="sheet-seek" type="range" min="0" max="100" step="0.1" value="0" disabled></div><p class="small" id="sheet-status" role="status"></p><p class="small sheet-keeps">It keeps playing, in the bar below, as you look around the site.</p></section>${hasCues ? '<p class="small karaoke-note">The current line follows the recording. Select any lyric to jump there.</p>' : ""}<div class="actions lyrics-actions"><a class="primary" href="${audioUrl}" target="_blank" rel="noopener">Open audio ↗</a><a class="quiet" id="download-lyrics">Download lyrics</a><button class="quiet" id="print-lyrics">Print</button>${songPlanLink(song, escape)}${song.originalPrompt || song.hasOriginalPrompt ? `<a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}">Original prompt ↗</a>` : ""}<a class="text-link" href="/">The collection →</a></div><div class="lyrics-text karaoke-lyrics">${lyricLines(song.lyrics, escape)}</div></article>`;
    cleanupKaraoke();
    cleanupMoments();
    cleanupControls();
    // A refresh of the same song keeps the place a visitor chose; a different song starts clean.
    if (sheet?.song.id === song.id) sheet.song = song;
    else sheet = sheetFor(song);
    if (comparison && comparison.key !== JSON.stringify(song.remixOf)) {
      comparison.stop(); comparison = null;
    }
    comparison ||= mountRemixComparison(song, sheet, { escape, safeUrl, scope });
    if (comparison) main.querySelector(".shared-song-player").after(comparison.element);
    loop ||= mountLoopToggle();
    loop.attach(sheet.audio);
    main.querySelector(".shared-song-player").append(loop.element);
    const listeningStats = document.createElement("p");
    listeningStats.className = "small";
    listeningStats.dataset.listeningStats = "";
    listeningStats.textContent = listeningLabel(song);
    main.querySelector(".shared-song-player").append(listeningStats);
    cleanupControls = mountSheetControls(main, sheet);
    cleanupKaraoke = mountKaraoke(main, sheet);
    cleanupMoments = mountMomentSharing(main, sheet);
    profilePanel ||= document.createElement("div");
    main.querySelector(".lyrics-actions").after(profilePanel);
    favorites ||= mountFavorites(profilePanel, { scope });
    main.querySelector(".lyrics-actions").insertAdjacentHTML("afterbegin", favorites.button(song));
    main.querySelector(".lyrics-actions").insertAdjacentHTML("beforeend", remixLink(song, escape));
    const blob = new Blob([`${song.title}\n${song.authoredBy ? `Authored by ${song.authoredBy}\n` : ""}${note}\n\n${song.lyrics.text}\n`], {
      type: "text/plain;charset=utf-8",
    });
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    const url = downloadUrl = URL.createObjectURL(blob);
    const download = main.querySelector("#download-lyrics");
    download.href = url;
    download.download = `${song.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")}-lyrics.txt`;
    main.querySelector("#print-lyrics").onclick = () => print();
    if (previousPosition) scrollTo(...previousPosition);
  }
  // What the player reports for this song lands on the sheet's own line.
  player.on("recorded", ({ id: listened, stats }) => {
    const label = main.querySelector("[data-listening-stats]");
    if (label && listened === sheet?.song.id) label.textContent = listeningLabel(stats);
  }, scope.signal);
  const watcher = watchSong(id, render, (song) => Boolean(song?.lyrics?.text));
  scope.onLeave(() => {
    watcher.dispose();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    cleanupKaraoke(); cleanupMoments(); cleanupControls();
    comparison?.stop();
    loop?.destroy();
  });
  await watcher.ready;
}
