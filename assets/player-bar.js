// The bar along the bottom: the site's one player made visible. It belongs to no page, so it stays
// where it is (and keeps playing) as the visitor moves around; each page starts songs on the player
// and the bar shows and controls whatever is loaded.
import { player } from "./player.js";
import { mountSides } from "./sides.js";
import { mountLoopToggle } from "./loop.js";
import { songBadges } from "./song-badges.js";
import { lyricsHref } from "./song-links.js";
import { showMessage } from "./message.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (value) => {
  try {
    const url = new URL(value, location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
};

let bar, recording = { id: null, html: "" };
// A page that knows the whole catalog can say how to tell this recording from its namesakes.
export function setRecordingLabel(songId, html) {
  recording = { id: songId, html: html || "" };
  if (bar && player.current?.id === songId) paint();
}

function paint() {
  const song = player.current;
  bar.hidden = !song;
  document.body.classList.toggle("has-player", Boolean(song));
  if (!song) return;
  const title = bar.querySelector("#now-title");
  const linked = song.lyrics?.text || song.hasLyrics;
  title.innerHTML = linked ? `<a href="${escape(lyricsHref(song))}" title="Open the lyric sheet">${escape(song.title)}</a>` : escape(song.title);
  const label = bar.querySelector("#now-recording");
  label.hidden = recording.id !== song.id || !recording.html;
  label.innerHTML = recording.id === song.id ? recording.html : "";
  const generator = bar.querySelector("#now-generator");
  generator.innerHTML = songBadges(song);
  generator.hidden = false;
  bar.querySelector("#download").href = safeUrl(song.url);
  const index = player.index, count = player.queue.length;
  bar.querySelector("#previous").disabled = index <= 0;
  bar.querySelector("#next").disabled = index < 0 || index >= count - 1;
  sync();
}
function sync() {
  if (!bar) return;
  const on = player.playing;
  bar.classList.toggle("is-playing", on);
  bar.querySelector(".player-status").textContent = on ? "Now playing" : "Paused";
}

async function share() {
  const song = player.current;
  if (!song) return;
  // The link is the song's own page, whose OpenGraph metadata gives chat previews a title and
  // description; it forwards to the home page and the same reveal a completion alert uses.
  const url = new URL(`/song/${encodeURIComponent(song.id)}/`, location.origin);
  // Phones get the native share sheet; desktop browsers copy, which is what a desktop visitor wants.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: song.title, text: `Listen to “${song.title}” on yehry3`, url: url.href });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url.href);
    showMessage(`Link to “${song.title}” copied.`);
  } catch {
    window.prompt("Copy this link to share the song", url.href);
  }
}

export function mountPlayerBar() {
  if (bar || !document.body) return bar;
  bar = document.createElement("aside");
  bar.className = "player";
  bar.id = "site-player";
  bar.setAttribute("aria-label", "Music player");
  bar.hidden = true;
  bar.innerHTML = '<div class="now-playing"><span class="eyebrow player-status">On the turntable</span><strong id="now-title"></strong><span id="now-recording" hidden></span><span id="now-generator" hidden></span><span id="now-sides" class="sides" role="group" aria-label="Same song, two pitch settings" hidden></span></div><button id="previous" class="quiet" aria-label="Previous song">←</button><button id="next" class="quiet" aria-label="Next song">→</button><button id="share-song" class="quiet" aria-label="Share this song">Share ↗</button><a id="download" class="text-link" target="_blank" rel="noopener">MP3 ↗</a>';
  bar.querySelector("#previous").after(player.audio);
  const sides = mountSides(bar.querySelector("#now-sides"), player.audio, {
    safeUrl,
    onSwitch: (side) => { bar.querySelector("#download").href = safeUrl(side.url); },
  });
  const loop = mountLoopToggle();
  loop.attach(player.audio);
  bar.querySelector("#next").after(loop.element);
  bar.querySelector("#previous").onclick = () => void player.step(-1);
  bar.querySelector("#next").onclick = () => void player.step(1);
  bar.querySelector("#share-song").onclick = share;
  let shown = null;
  player.on("change", ({ song, reason }) => {
    if (song && (reason === "play" || shown?.id !== song.id)) sides.show(song);
    shown = song;
    paint();
  });
  player.on("error", ({ kind }) => showMessage(kind === "blocked" ? "Press play in the player to start this song." : "This track could not load. Try another song or open its MP3 link.", kind === "load"));
  for (const event of ["play", "playing", "pause", "ended", "emptied", "error"]) player.audio.addEventListener(event, sync);
  document.body.append(bar);
  return bar;
}
