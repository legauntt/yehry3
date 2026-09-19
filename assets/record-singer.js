import { watchSong } from "./song-data.js";
import { lyricPassage, pickRecordSong, singableLines } from "./record-lyrics.js";
import { getRecordPreferences, watchRecordPreferences } from "./record-preferences.js";

const choose = (items, random) => items[Math.floor(random() * items.length)];

export function startRecordSinger(record, getSongs, { random = Math.random } = {}) {
  const sleeve = record?.closest(".sleeve");
  if (!record || !sleeve) return;

  const bubble = document.createElement("figure");
  bubble.className = "record-lyric";
  bubble.hidden = true;
  bubble.setAttribute("aria-hidden", "true");
  bubble.innerHTML = '<span class="record-lyric-notes">♪</span><blockquote></blockquote><figcaption></figcaption>';
  sleeve.append(bubble);

  let advanceTimer;
  let request = 0;
  let previous = "";
  let captionsEnabled = getRecordPreferences().captions;
  let lyricAudioEnabled = getRecordPreferences().lyricAudio;
  let utterance;
  const stopAudio = () => {
    if (!utterance) return;
    utterance = undefined;
    try { window.speechSynthesis?.cancel(); }
    catch { /* Speech generation is optional browser functionality. */ }
  };
  const speak = (line) => {
    if (!lyricAudioEnabled || !window.speechSynthesis || typeof SpeechSynthesisUtterance !== "function") return;
    try {
      stopAudio();
      const next = new SpeechSynthesisUtterance(line);
      next.rate = 0.92;
      next.pitch = 1.08;
      const clear = () => { if (utterance === next) utterance = undefined; };
      next.addEventListener("end", clear, { once: true });
      next.addEventListener("error", clear, { once: true });
      utterance = next;
      window.speechSynthesis.speak(next);
    }
    catch {
      utterance = undefined;
      /* Keep the caption working if speech synthesis is unavailable. */
    }
  };
  const hide = () => {
    request += 1;
    clearTimeout(advanceTimer);
    bubble.classList.remove("is-singing");
    bubble.hidden = true;
  };
  const detail = async (song) => {
    if (song.lyrics?.text) return song;
    let loaded;
    const watcher = watchSong(song.id, (value) => { loaded = value; }, (value) => Boolean(value?.lyrics?.text));
    await watcher.ready;
    return loaded;
  };
  const sing = async ({ withAudio = false } = {}) => {
    if ((!captionsEnabled && !(withAudio && lyricAudioEnabled)) || document.hidden) return;
    const song = pickRecordSong(getSongs?.() || [], random);
    if (!song) return;
    const token = ++request;
    const loaded = await detail(song);
    if (token !== request || document.hidden || !loaded) return;
    const lines = singableLines(loaded.lyrics?.text);
    if (!lines.length) return;
    const preferences = getRecordPreferences();
    const passage = lyricPassage(lines, random, { width: innerWidth, height: innerHeight, minLines: preferences.lyricMinLines, maxLines: preferences.lyricMaxLines });
    const alternatives = passage.length === 1
      ? lines.filter((line) => `${loaded.id}:${line}` !== previous)
      : passage;
    const selected = passage.length === 1
      ? [choose(alternatives.length ? alternatives : lines, random)]
      : alternatives;
    const text = selected.join("\n");
    previous = `${loaded.id}:${selected[0]}`;
    if (captionsEnabled) {
      bubble.dataset.lineCount = String(selected.length);
      bubble.style.setProperty("--record-lyric-font-size", String(preferences.lyricFontSize) + "px");
      const duration = 3000 + Math.round((Math.min(8, selected.length) - 1) * (2000 / 7));
      bubble.style.setProperty("--record-lyric-duration", String(duration) + "ms");
      bubble.querySelector("blockquote").textContent = `“${text}”`;
      bubble.querySelector("figcaption").textContent = `— ${loaded.title || song.title}`;
      bubble.hidden = false;
      bubble.classList.remove("is-singing");
      void bubble.offsetWidth;
      bubble.classList.add("is-singing");
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => { void sing({ withAudio }); }, duration);
    }
    if (withAudio) speak(selected.join(" "));
  };

  record.addEventListener("recordidle", () => sing());
  record.addEventListener("recordspin", () => sing({ withAudio: true }));
  watchRecordPreferences((preferences) => {
    captionsEnabled = preferences.captions;
    lyricAudioEnabled = preferences.lyricAudio;
    if (!captionsEnabled) hide();
    if (!lyricAudioEnabled) stopAudio();
  });
  const dismissForActivity = (event) => {
    if (event.type === "keydown" && event.target === record && ["Enter", " "].includes(event.key)) return;
    hide();
  };
  for (const event of ["pointerdown", "keydown", "scroll"])
    window.addEventListener(event, dismissForActivity, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    hide();
    stopAudio();
  });
  return { sing, hide, element: bubble };
}
