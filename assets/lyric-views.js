import { lyricView } from "./pronunciation.js";
import { transcriptMethods, loadTranscriptIndex, loadTranscript, transcriptLyrics } from "./performance-lyrics.js";

const storageKey = "yehry3:lyric-view";
const views = {
  original: ["Original", "The words, as written."],
  ipa: ["Dictionary · IPA", "Dictionary pronunciation in approximate US English. This does not transcribe Tony’s delivery. Unknown words stay as written."],
  phonics: ["Dictionary · Readable", "Dictionary pronunciation; Tony’s delivery may differ. CAPS mark stress; dh is th in “this”, uu is oo in “book”. Unknown words stay as written."],
  ...Object.fromEntries(Object.entries(transcriptMethods).map(([key, method]) => [key, [method.label,
    "Machine transcription of Tony’s actual vocals, without a written lyric prompt. Words and timing may be wrong; no listener has checked this transcript. ? marks model uncertainty, not every possible error."]])),
};
const validView = value => Object.hasOwn(views, value) ? value : "original";
const shortLabels = { original: "Original", ipa: "IPA", phonics: "Phonics" };
for (const [key, method] of Object.entries(transcriptMethods)) shortLabels[key] = method.label;
let memoryView = "original";
function savedView() {
  try { memoryView = validView(localStorage.getItem(storageKey)); } catch { /* Keep this tab's choice. */ }
  return memoryView;
}
function linkedView() {
  const params = new URLSearchParams(location.search);
  return params.has("view") ? validView(params.get("view")) : savedView();
}
let pronunciations;
function loadPronunciations() {
  pronunciations ||= fetch("/assets/lyric-pronunciations.json", { signal: AbortSignal.timeout(8000) })
    .then(response => { if (!response.ok) throw new Error("Dictionary unavailable"); return response.json(); })
    .then(value => {
      if (!value || Array.isArray(value) || typeof value !== "object" || Object.values(value).some(phones => typeof phones !== "string")) throw new Error("Invalid dictionary");
      return value;
    })
    .catch(error => { pronunciations = null; throw error; });
  return pronunciations;
}

export function mountLyricViews(main, song, onChange) {
  const lyrics = song.lyrics;
  const pageUrl = new URL(location.href);
  const controller = new AbortController();
  const { signal } = controller;
  const panel = document.createElement("section");
  panel.className = "lyric-views";
  panel.setAttribute("aria-label", "Lyric view");
  panel.innerHTML = `<div class="lyric-view-controls"><label class="sr-only" for="lyric-view">Lyric view</label><select id="lyric-view" aria-describedby="lyric-view-note" title="Lyric view">${Object.entries(shortLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><details class="lyric-view-help"><summary class="sheet-icon sheet-info" aria-label="About this lyric view" title="About this lyric view">About this lyric view</summary><div class="sheet-popup"><p id="lyric-view-note" class="small" role="status"></p></div></details>`;
  const select = panel.querySelector("select"), note = panel.querySelector("p"), help = panel.querySelector("details");
  const sheet = main.querySelector(".lyrics-text");
  main.querySelector(".lyric-view-slot").append(panel);
  let revision = 0, current = "original", settled = false;
  const loaded = new Map();
  const originalNote = lyrics.kind === "transcribed"
    ? "Transcription of the source recording. Tony’s performed words may differ."
    : "Lyrics supplied for this recording. Tony’s performed words may differ.";
  function display(view, dictionary, transcript) {
    const selected = transcript ? transcriptLyrics(transcript) : { ...lyrics, text: lyricView(lyrics.text, view, dictionary) };
    const viewNote = view === "original" ? originalNote : `${views[view][1]}${transcript ? ` Model: ${transcript.model}.` : ""}`;
    current = view;
    select.value = view;
    sheet.dataset.lyricView = view;
    select.title = views[view][0];
    note.textContent = viewNote;
    main.querySelector(".lyric-print-note").textContent = view === "original" ? "" : `${views[view][0]}: ${viewNote}`;
    onChange({ text: selected.text, lyrics: selected, view, source: transcript ? view : "original",
      initial: !settled, label: views[view][0], note: viewNote });
    settled = true;
  }
  function updateUrl(view) {
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(history.state, "", url);
    dispatchEvent(new Event("yehry3:lyric-view"));
  }
  async function choose(view, remember = false) {
    const request = ++revision;
    select.value = view;
    let dictionary, transcript;
    if (Object.hasOwn(transcriptMethods, view)) {
      panel.setAttribute("aria-busy", "true");
      note.textContent = "Loading the audio transcription…";
      try {
        transcript = loaded.get(view) || await loadTranscript(song, view, signal);
        if (!transcript) throw new Error("not-generated");
        loaded.set(view, transcript);
      } catch (error) {
        if (signal.aborted || request !== revision) return;
        // A transcript line number cannot point into the written sheet.
        if (!settled) {
          const url = new URL(location.href);
          if (/^#lyric-line-\d+$/.test(url.hash)) { url.hash = ""; history.replaceState(history.state, "", url); }
          display("original");
        }
        select.value = current;
        updateUrl(current);
        panel.removeAttribute("aria-busy");
        note.textContent = error.message === "not-generated"
          ? `There is no ${transcriptMethods[view].label.replace(/^Lyrics \((.+)\)$/, "$1")} transcription for this recording yet. Your current view is still available.`
          : "The audio transcription could not be loaded for this recording. Try that view again.";
        help.open = true;
        return;
      }
    }
    if (view === "ipa" || view === "phonics") {
      panel.setAttribute("aria-busy", "true");
      note.textContent = "Warming up the pronunciation coach…";
      try { dictionary = await loadPronunciations(); }
      catch {
        if (signal.aborted || request !== revision) return;
        if (!settled) { display("original"); updateUrl("original"); }
        select.value = current;
        panel.removeAttribute("aria-busy");
        note.textContent = "The pronunciation coach missed rehearsal. Try that view again.";
        help.open = true;
        return;
      }
    }
    if (signal.aborted || request !== revision) return;
    panel.removeAttribute("aria-busy");
    display(view, dictionary, transcript);
    // Every shared format is explicit, including Original, so the recipient's
    // saved preference cannot change it. Keep the song, timestamp and line hash.
    updateUrl(view);
    if (remember) {
      memoryView = view;
      try { localStorage.setItem(storageKey, view); } catch { /* Still works without storage. */ }
    }
  }
  const initial = linkedView();
  void choose(initial);
  // Availability is tied to this recording, independent of API/catalog refreshes.
  void loadTranscriptIndex().then(index => {
    if (signal.aborted) return;
    for (const [method, config] of Object.entries(transcriptMethods)) {
      const option = select.querySelector(`option[value="${method}"]`);
      const available = index[song.id]?.audioUrl === song.url && index[song.id]?.methods?.includes(method);
      option.disabled = !available;
      option.textContent = available ? config.label : `${config.label} — not yet`;
    }
  }).catch(() => { /* Choosing the view offers an explicit retry. */ });
  select.addEventListener("change", () => void choose(validView(select.value), true), { signal });
  addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) void choose(savedView());
  }, { signal });
  addEventListener("popstate", () => {
    const url = new URL(location.href);
    if (url.pathname === pageUrl.pathname && url.searchParams.get("song") === pageUrl.searchParams.get("song")) void choose(linkedView());
  }, { signal });
  return () => controller.abort();
}
