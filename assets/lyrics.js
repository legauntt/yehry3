import { authoredByLine } from "./authored-by.js";
import { api } from "./api.js";
import { qualityNotice } from "./quality.js";

export async function lyricsPage(main, { escape, safeUrl }) {
  const id = new URLSearchParams(location.search).get("song");
  let song;
  if (/^[a-z0-9-]{1,120}$/.test(id || "")) {
    try {
      song = (await api("/songs")).songs.find((item) => item.id === id);
    } catch {
      /* The static catalog includes the saved lyrics for offline API use. */
    }
    if (!song?.lyrics) {
      try {
        song = (await (await fetch("/catalog.json")).json()).songs.find(
          (item) => item.id === id,
        );
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
  main.innerHTML = `<article class="lyrics-sheet"><p class="eyebrow">The lyric sheet</p><h1>${escape(song.title)}</h1>${authoredByLine(song.authoredBy, escape)}${qualityNotice(song.qualityIssues)}<p class="small">${note}</p><section class="shared-song-player" aria-label="Listen to ${escape(song.title)}"><p class="tiny-label">Listen here</p><audio controls preload="metadata" src="${audioUrl}" aria-label="Play ${escape(song.title)}">Your browser cannot play this recording. <a href="${audioUrl}">Open the audio file</a>.</audio></section><div class="actions lyrics-actions"><a class="primary" href="${audioUrl}" target="_blank" rel="noopener">Open audio ↗</a><a class="quiet" id="download-lyrics">Download lyrics</a><button class="quiet" id="print-lyrics">Print</button><a class="text-link" href="/">The collection →</a></div><pre class="lyrics-text">${escape(song.lyrics.text)}</pre></article>`;
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
