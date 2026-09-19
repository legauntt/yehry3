import { watchSong } from "./song-data.js";
import { singableLines } from "./record-lyrics.js";
import { getRecordPreferences, watchRecordPreferences } from "./record-preferences.js";

const choose = (items, random) => items[Math.floor(random() * items.length)];

export function startRecordSinger(record, getSongs, { random = Math.random, duration = 6500 } = {}) {
  const sleeve = record?.closest(".sleeve");
  if (!record || !sleeve) return;

  const bubble = document.createElement("figure");
  bubble.className = "record-lyric";
  bubble.hidden = true;
  bubble.setAttribute("aria-hidden", "true");
  bubble.innerHTML = '<span class="record-lyric-notes">♪</span><blockquote></blockquote><figcaption></figcaption>';
  sleeve.append(bubble);

  let hideTimer;
  let request = 0;
  let previous = "";
  let captionsEnabled = getRecordPreferences().captions;
  let lyricAudioEnabled = getRecordPreferences().lyricAudio;
  const stopAudio = () => {
    try { window.speechSynthesis?.cancel(); }
    catch { /* Speech generation is optional browser functionality. */ }
  };
  const speak = (line) => {
    if (!lyricAudioEnabled || !window.speechSynthesis || typeof SpeechSynthesisUtterance !== "function") return;
    try {
      stopAudio();
      const utterance = new SpeechSynthesisUtterance(line);
      utterance.rate = 0.92;
      utterance.pitch = 1.08;
      window.speechSynthesis.speak(utterance);
    }
    catch { /* Keep the caption working if speech synthesis is unavailable. */ }
  };
  const hide = () => {
    request += 1;
    clearTimeout(hideTimer);
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
    const songs = (getSongs?.() || []).filter((song) => song?.id && (song.hasLyrics || song.lyrics?.text));
    if (!songs.length) return;
    const token = ++request;
    const song = choose(songs, random);
    const loaded = await detail(song);
    if (token !== request || document.hidden || !loaded) return;
    const lines = singableLines(loaded.lyrics?.text);
    if (!lines.length) return;
    const alternatives = lines.filter((line) => `${loaded.id}:${line}` !== previous);
    const line = choose(alternatives.length ? alternatives : lines, random);
    previous = `${loaded.id}:${line}`;
    if (captionsEnabled) {
      bubble.querySelector("blockquote").textContent = `“${line}”`;
      bubble.querySelector("figcaption").textContent = `— ${loaded.title || song.title}`;
      bubble.hidden = false;
      bubble.classList.remove("is-singing");
      void bubble.offsetWidth;
      bubble.classList.add("is-singing");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, duration);
    }
    if (withAudio) speak(line);
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
