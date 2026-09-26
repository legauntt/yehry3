import { lyricView } from "./pronunciation.js";

const storageKey = "yehry3:lyric-view";
const views = {
  original: ["Original", "The words, as written."],
  ipa: ["Dictionary · IPA", "Dictionary pronunciation in approximate US English. This does not transcribe Tony’s delivery. Unknown words stay as written."],
  phonics: ["Dictionary · Readable", "Dictionary pronunciation; Tony’s delivery may differ. CAPS mark stress; dh is th in “this”, uu is oo in “book”. Unknown words stay as written."],
};
const validView = value => Object.hasOwn(views, value) ? value : "original";
const shortLabels = { original: "Original", ipa: "IPA", phonics: "Phonics" };
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

export function mountLyricViews(main, lyrics, onChange) {
  const pageUrl = new URL(location.href);
  const controller = new AbortController();
  const { signal } = controller;
  const panel = document.createElement("section");
  panel.className = "lyric-views";
  panel.setAttribute("aria-label", "Lyric view");
  panel.innerHTML = `<div class="lyric-view-controls"><label class="sr-only" for="lyric-view">Lyric view</label><select id="lyric-view" aria-describedby="lyric-view-note" title="Lyric view">${Object.entries(shortLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><details class="lyric-view-help"><summary class="sheet-icon sheet-info" aria-label="About this lyric view" title="About this lyric view">About this lyric view</summary><div class="sheet-popup"><p id="lyric-view-note" class="small" role="status"></p></div></details>`;
  const select = panel.querySelector("select"), note = panel.querySelector("p"), help = panel.querySelector("details");
  const sheet = main.querySelector(".lyrics-text");
  const lines = [...sheet.querySelectorAll("[data-lyric-text]")];
  main.querySelector(".lyric-view-slot").append(panel);
  let revision = 0, current = "original";
  const originalNote = lyrics.kind === "transcribed"
    ? "Transcription of the source recording. Tony’s performed words may differ."
    : "Lyrics supplied for this recording. Tony’s performed words may differ.";
  function display(view, dictionary) {
    const text = lyricView(lyrics.text, view, dictionary), translated = text.split("\n");
    for (const line of lines) line.textContent = translated[Number(line.dataset.lyricText)];
    current = view;
    select.value = view;
    sheet.dataset.lyricView = view;
    note.textContent = view === "original" ? originalNote : views[view][1];
    main.querySelector(".lyric-print-note").textContent = view === "original" ? "" : `${views[view][0]}: ${views[view][1]}`;
    onChange({ text, view, label: views[view][0], note: views[view][1] });
  }
  async function choose(view, remember = false) {
    const request = ++revision;
    select.value = view;
    let dictionary;
    if (view === "ipa" || view === "phonics") {
      panel.setAttribute("aria-busy", "true");
      note.textContent = "Warming up the pronunciation coach…";
      try { dictionary = await loadPronunciations(); }
      catch {
        if (signal.aborted || request !== revision) return;
        select.value = current;
        panel.removeAttribute("aria-busy");
        note.textContent = "The pronunciation coach missed rehearsal. Try that view again.";
        help.open = true;
        return;
      }
    }
    if (signal.aborted || request !== revision) return;
    panel.removeAttribute("aria-busy");
    display(view, dictionary);
    // Every shared format is explicit, including Original, so the recipient's
    // saved preference cannot change it. Keep the song, timestamp and line hash.
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    history.replaceState(history.state, "", url);
    dispatchEvent(new Event("yehry3:lyric-view"));
    if (remember) {
      memoryView = view;
      try { localStorage.setItem(storageKey, view); } catch { /* Still works without storage. */ }
    }
  }
  const initial = linkedView();
  display("original");
  void choose(initial);
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
