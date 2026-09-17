import { musicBackendBadge } from "./music-provenance.js";
import { watchSong } from "./song-data.js";
import { publicPromptBrief } from "./prompt-brief.js";
import { songPlanSection } from "./song-plan.js";
import { remixLink } from "./remix.js";

export async function originalPromptPage(main, { escape, safeUrl }) {
  const id = new URLSearchParams(location.search).get("song");
  let song;
  function render(next) {
    song = next;
    const previous = main.querySelector("article.original-prompt");
    const readingPosition = previous ? [scrollX, scrollY] : null;
    const opened = [...main.querySelectorAll("details[open]")].map((item) => item.querySelector("summary")?.textContent);
    const materialsUnavailable = /^distonyc-[a-f0-9]{24}$/.test(id || "") && !Object.hasOwn(song?.originalPrompt || {}, "references");
    if (!song?.originalPrompt && !song?.songPlan) {
      main.innerHTML =
        '<section class="lyrics-sheet"><p class="eyebrow">Original prompt</p><h1>This brief is not available yet.</h1><a class="text-link" href="/">The collection →</a></section>';
      return;
    }
    const title = song.title || song.songPlan?.title || song.idea;
    document.title = `${title} · Prompt & song plan · yehry3`;
    const unfinished = song.status && song.status !== "published";
    main.innerHTML = `<article class="lyrics-sheet original-prompt"><p class="eyebrow">From idea to song</p><h1>${escape(title)}</h1>${musicBackendBadge(song)}<section><h2>Original prompt</h2>${song.originalPrompt ? `<p class="small">The idea and refinements confirmed for this song.</p>${publicPromptBrief(song, escape, { materialsUnavailable })}` : '<p class="small">No original prompt was saved for this song.</p>'}</section>${songPlanSection(song, escape)}<div class="actions">${song.url ? `<a class="primary" href="${escape(safeUrl(song.url))}" target="_blank" rel="noopener">Hear the song ↗</a>` : ""}${song.lyrics?.text ? `<a class="text-link" href="/lyrics/?song=${encodeURIComponent(song.id)}">Lyrics ↗</a>` : ""}<a class="text-link" href="${unfinished ? `/queue/details/?request=${encodeURIComponent(song.id)}` : "/?collection=distonyc"}">${unfinished ? "Request status" : "Distonyc collection"} →</a></div></article>`;
    if (song.url) main.querySelector(".actions").insertAdjacentHTML("beforeend", remixLink(song, escape));
    for (const detail of main.querySelectorAll("details"))
      if (opened.includes(detail.querySelector("summary")?.textContent)) detail.open = true;
    if (readingPosition) scrollTo(...readingPosition);
    else if (location.hash === "#song-plan") main.querySelector("#song-plan").scrollIntoView();
  }
  const watcher = watchSong(id, render, (item) => Boolean(item?.originalPrompt || item?.songPlan));
  const refresh = () => {
    if (!document.hidden && ["queued", "processing"].includes(song?.status) && !song?.songPlan) watcher.refresh();
  };
  let timer = setInterval(refresh, 30000);
  addEventListener("pagehide", () => clearInterval(timer));
  addEventListener("pageshow", (event) => { if (event.persisted) { clearInterval(timer); timer = setInterval(refresh, 30000); refresh(); } });
  document.addEventListener("visibilitychange", refresh);
  await watcher.ready;
}
