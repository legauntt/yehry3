import { watchSong } from "./song-data.js";
import { singableLines } from "./record-lyrics.js";

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
  const sing = async () => {
    if (document.hidden) return;
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
    bubble.querySelector("blockquote").textContent = `“${line}”`;
    bubble.querySelector("figcaption").textContent = `— ${loaded.title || song.title}`;
    bubble.hidden = false;
    bubble.classList.remove("is-singing");
    void bubble.offsetWidth;
    bubble.classList.add("is-singing");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, duration);
  };

  record.addEventListener("recordidle", sing);
  for (const event of ["pointerdown", "keydown", "scroll"])
    window.addEventListener(event, hide, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) hide(); });
  return { sing, hide, element: bubble };
}
