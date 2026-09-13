import { api } from "./api.js";

export async function originalPromptPage(main, { escape, safeUrl }) {
  const id = new URLSearchParams(location.search).get("song");
  let song;
  if (/^[a-z0-9-]{1,120}$/.test(id || "")) {
    try {
      song = (await api("/songs")).songs.find((item) => item.id === id);
    } catch {
      /* Use the published fallback below. */
    }
    if (!song?.originalPrompt) {
      try {
        song = (await (await fetch("/catalog.json")).json()).songs.find(
          (item) => item.id === id,
        );
      } catch {
        /* Show the unavailable state below. */
      }
    }
  }
  if (!song?.originalPrompt) {
    main.innerHTML =
      '<section class="lyrics-sheet"><p class="eyebrow">Original prompt</p><h1>This brief is not available yet.</h1><a class="text-link" href="/">The collection →</a></section>';
    return;
  }
  document.title = `${song.title} · Original prompt · yehry3`;
  const brief = song.originalPrompt;
  const fields = [
    ["The idea", brief.idea],
    ["Musical direction", brief.direction || "No extra direction supplied."],
    ["What mattered most", brief.keep || "No extra preferences supplied."],
    [
      "Basis songs",
      brief.basisSongs.length
        ? brief.basisSongs.join("\n")
        : "No basis songs selected.",
    ],
  ];
  main.innerHTML = `<article class="lyrics-sheet original-prompt"><p class="eyebrow">Original prompt</p><h1>${escape(song.title)}</h1><p class="small">The request and settings confirmed before this song went into the studio.</p><dl class="brief">${fields.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join("")}</dl><div class="actions"><a class="primary" href="${escape(safeUrl(song.url))}" target="_blank" rel="noopener">Hear the song ↗</a>${song.lyrics?.text ? `<a class="text-link" href="/lyrics/?song=${encodeURIComponent(song.id)}">Lyrics ↗</a>` : ""}<a class="text-link" href="/?collection=distonyc">Distonyc collection →</a></div></article>`;
}
