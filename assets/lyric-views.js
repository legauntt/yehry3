import { lyricView } from "./pronunciation.js";

const storageKey = "yehry3:lyric-view";
const views = {
  original: ["Original", "The words, as written."],
  ipa: ["Phonetic · IPA", "Approximate US English, dressed for a linguistics conference. Unknown words stay as written."],
  phonics: ["Phonetic · Readable", "Sound it out. CAPS mark stress; dh is th in “this”, uu is oo in “book”. Approximate US English; unknown words stay as written."],
  diacritics: ["Diacritics · Extra fancy", "All the vowels brought hats. Decorative only; absolutely no extra qualifications."],
};
const validView = value => Object.hasOwn(views, value) ? value : "original";
let memoryView = "original";
function savedView() {
  try { memoryView = validView(localStorage.getItem(storageKey)); } catch { /* Keep this tab's choice. */ }
  return memoryView;
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
  const controller = new AbortController();
  const { signal } = controller;
  const panel = document.createElement("section");
  panel.className = "lyric-views";
  panel.setAttribute("aria-label", "Lyric view");
  panel.innerHTML = `<div class="lyric-view-controls"><label for="lyric-view">Lyric view</label><select id="lyric-view" aria-describedby="lyric-view-note">${Object.entries(views).map(([value, [label]]) => `<option value="${value}">${label}</option>`).join("")}</select></div><p id="lyric-view-note" class="small" role="status"></p>`;
  const select = panel.querySelector("select"), note = panel.querySelector("p");
  const sheet = main.querySelector(".lyrics-text");
  const lines = [...sheet.querySelectorAll("[data-lyric-text]")];
  sheet.before(panel);
  let revision = 0, current = "original";
  function display(view, dictionary) {
    const text = lyricView(lyrics.text, view, dictionary), translated = text.split("\n");
    for (const line of lines) line.textContent = translated[Number(line.dataset.lyricText)];
    current = view;
    select.value = view;
    sheet.dataset.lyricView = view;
    note.textContent = views[view][1];
    onChange({ text, view, label: views[view][0], note: views[view][1] });
  }
  async function choose(view, remember = false) {
    const request = ++revision;
    select.value = view;
    let dictionary;
    if (view === "ipa" || view === "phonics") {
      note.textContent = "Warming up the pronunciation coach…";
      try { dictionary = await loadPronunciations(); }
      catch {
        if (signal.aborted || request !== revision) return;
        select.value = current;
        note.textContent = "The pronunciation coach missed rehearsal. Try that view again.";
        return;
      }
    }
    if (signal.aborted || request !== revision) return;
    display(view, dictionary);
    if (remember) {
      memoryView = view;
      try { localStorage.setItem(storageKey, view); } catch { /* Still works without storage. */ }
    }
  }
  display("original");
  void choose(savedView());
  select.addEventListener("change", () => void choose(validView(select.value), true), { signal });
  addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) void choose(savedView());
  }, { signal });
  return () => controller.abort();
}
