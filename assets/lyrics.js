import { songPlanLink } from "./song-plan.js";
import { authoredByLine } from "./authored-by.js";
import { api } from "./api.js";
import { qualityNotice } from "./quality.js";
import { mountFavorites } from "./favorites.js";

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

function mountKaraoke(main) {
  const audio = main.querySelector(".shared-song-player audio");
  const lines = [...main.querySelectorAll("button.lyric-line")];
  if (!audio || !lines.length) return;
  let active;
  let linked;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  function lineFromHash() {
    const match = /^#lyric-line-(\d+)$/.exec(location.hash);
    return match ? lines.find((line) => line.id === `lyric-line-${match[1]}`) : undefined;
  }
  function sync(follow = !audio.paused) {
    const time = audio.currentTime;
    let current;
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
    if (line === linked) return;
    linked?.classList.remove("is-linked");
    linked = line;
    linked?.classList.add("is-linked");
  }
  function selectLine(line, updateUrl = false) {
    if (!line) return;
    if (updateUrl) history.replaceState(history.state, "", `#${line.id}`);
    markLinked(line);
    const seek = () => {
      audio.currentTime = Number(line.dataset.start);
      sync(false);
    };
    if (audio.readyState) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });
  }
  for (const line of lines) line.addEventListener("click", () => selectLine(line, true));
  const linkedLine = lineFromHash();
  if (linkedLine) {
    linkedLine.scrollIntoView({ block: "center" });
    selectLine(linkedLine);
  }
  addEventListener("hashchange", () => {
    const line = lineFromHash();
    markLinked(line);
    if (!line) return;
    line.scrollIntoView({ block: "center" });
    selectLine(line);
  });
  audio.addEventListener("timeupdate", () => sync());
  audio.addEventListener("seeking", () => sync());
  audio.addEventListener("play", () => sync(true));
}

export async function lyricsPage(main, { escape, safeUrl }) {
  const id =
    new URLSearchParams(location.search).get("song") ||
    document.body.dataset.songId;
  let song;
  if (/^[a-z0-9-]{1,120}$/.test(id || "")) {
    try {
      song = (await api("/songs")).songs.find((item) => item.id === id);
    } catch {
      /* The static catalog includes the saved lyrics for offline API use. */
    }
    if (!song?.lyrics?.text || !song.lyrics.cues?.length) {
      try {
        const saved = (await (await fetch("/catalog.json")).json()).songs.find(
          (item) => item.id === id,
        );
        song = song
          ? {
              ...saved,
              ...song,
              lyrics: {
                ...saved?.lyrics,
                ...song.lyrics,
                cues: song.lyrics?.cues?.length
                  ? song.lyrics.cues
                  : saved?.lyrics?.cues,
              },
            }
          : saved;
      } catch {
        /* Show the unavailable state below. */
      }
    }
  }
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
  main.innerHTML = `<article class="lyrics-sheet"><p class="eyebrow">The lyric sheet</p><h1>${escape(song.title)}</h1>${authoredByLine(song.authoredBy, escape)}${qualityNotice(song.qualityIssues)}<p class="small">${note}</p><section class="shared-song-player" aria-label="Listen to ${escape(song.title)}"><p class="tiny-label">Listen here</p><audio controls preload="metadata" src="${audioUrl}" aria-label="Play ${escape(song.title)}">Your browser cannot play this recording. <a href="${audioUrl}">Open the audio file</a>.</audio></section>${hasCues ? '<p class="small karaoke-note">The current line follows the recording. Select any lyric to jump there.</p>' : ""}<div class="actions lyrics-actions"><a class="primary" href="${audioUrl}" target="_blank" rel="noopener">Open audio ↗</a><a class="quiet" id="download-lyrics">Download lyrics</a><button class="quiet" id="print-lyrics">Print</button>${songPlanLink(song, escape)}<a class="text-link" href="/">The collection →</a></div><div class="lyrics-text karaoke-lyrics">${lyricLines(song.lyrics, escape)}</div></article>`;
  mountKaraoke(main);
  const profilePanel = document.createElement("div");
  main.querySelector(".lyrics-actions").after(profilePanel);
  const favorites = mountFavorites(profilePanel);
  main.querySelector(".lyrics-actions").insertAdjacentHTML("afterbegin", favorites.button(song));
  const blob = new Blob([`${song.title}\n${song.authoredBy ? `Authored by ${song.authoredBy}\n` : ""}${note}\n\n${song.lyrics.text}\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const download = main.querySelector("#download-lyrics");
  download.href = url;
  download.download = `${song.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")}-lyrics.txt`;
  main.querySelector("#print-lyrics").onclick = () => print();
  addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) URL.revokeObjectURL(url);
    },
    { once: true },
  );
}
