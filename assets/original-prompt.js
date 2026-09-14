import { api } from "./api.js";
import { publicPromptBrief } from "./prompt-brief.js";
import { songPlanSection } from "./song-plan.js";

export async function originalPromptPage(main, { escape, safeUrl }) {
  const id = new URLSearchParams(location.search).get("song");
  let song;
  let materialsUnavailable = false;
  const merge = (candidate) => {
    if (!candidate) return;
    song = { ...candidate, ...song,
      originalPrompt: song?.originalPrompt || candidate.originalPrompt,
      songPlan: song?.songPlan || candidate.songPlan };
  };
  if (/^[a-z0-9-]{1,120}$/.test(id || "")) {
    try {
      song = (await api("/songs")).songs.find((item) => item.id === id);
    } catch {
      /* Use the published fallback below. */
    }
    if (/^distonyc-[a-f0-9]{24}$/.test(id)) {
      try {
        // Published catalog entries can predate public request materials. Always
        // read the confirmed request so its saved lyrics/references are available.
        const request = await api(`/queue/${encodeURIComponent(id)}`);
        merge(request);
        song.originalPrompt = request.originalPrompt || song.originalPrompt;
      } catch {
        /* Use the published fallback below. */
      }
    }
    if (!song?.originalPrompt || !song?.songPlan) {
      try {
        merge((await (await fetch("/catalog.json")).json()).songs.find(
          (item) => item.id === id,
        ));
      } catch {
        /* Show the unavailable state below. */
      }
    }
    materialsUnavailable = /^distonyc-[a-f0-9]{24}$/.test(id) && !Object.hasOwn(song?.originalPrompt || {}, "references");
  }
  if (!song?.originalPrompt && !song?.songPlan) {
    main.innerHTML =
      '<section class="lyrics-sheet"><p class="eyebrow">Original prompt</p><h1>This brief is not available yet.</h1><a class="text-link" href="/">The collection →</a></section>';
    return;
  }
  const title = song.title || song.songPlan?.title || song.idea;
  document.title = `${title} · Prompt & song plan · yehry3`;
  const unfinished = song.status && song.status !== "published";
  main.innerHTML = `<article class="lyrics-sheet original-prompt"><p class="eyebrow">From idea to song</p><h1>${escape(title)}</h1><section><h2>Original prompt</h2>${song.originalPrompt ? `<p class="small">The idea and refinements confirmed for this song.</p>${publicPromptBrief(song, escape, { materialsUnavailable })}` : '<p class="small">No original prompt was saved for this song.</p>'}</section>${songPlanSection(song, escape)}<div class="actions">${song.url ? `<a class="primary" href="${escape(safeUrl(song.url))}" target="_blank" rel="noopener">Hear the song ↗</a>` : ""}${song.lyrics?.text ? `<a class="text-link" href="/lyrics/?song=${encodeURIComponent(song.id)}">Lyrics ↗</a>` : ""}<a class="text-link" href="${unfinished ? `/queue/details/?request=${encodeURIComponent(song.id)}` : "/?collection=distonyc"}">${unfinished ? "Request status" : "Distonyc collection"} →</a></div></article>`;
  if (location.hash === "#song-plan") main.querySelector("#song-plan").scrollIntoView();
  if (unfinished && !song.songPlan) {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const latest = await api(`/queue/${encodeURIComponent(id)}`);
        if (latest.songPlan) {
          main.querySelector("#song-plan").outerHTML = songPlanSection(latest, escape);
          clearInterval(timer);
        } else if (!["queued", "processing"].includes(latest.status)) clearInterval(timer);
      } catch { /* Keep the saved brief visible during an outage. */ }
    }, 30000);
    addEventListener("pagehide", () => clearInterval(timer), { once: true });
  }
}
