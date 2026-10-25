// "9/11'd Again" badges sing a line from the song of the same name when clicked.
// Clips load only on the first click, so the badge costs nothing until someone presses it.
import { recoveryStatus } from "./recovery.js";
import { pickEggMoment, randomSongSlice } from "./egg-clips.js";
import { showCaption } from "./egg-caption.js";

const clips = ["/assets/sounds/one-loud-crash.mp3", "/assets/sounds/nine-elevend-again.mp3"];
const soundStatuses = new Set(["failed", "attention"]);
const announcedKey = "yehry3:announced-attention";
let next = 0;
let current = null;

export const hasBadgeSound = (status) => soundStatuses.has(status);

export function songPreviewButton(song, escape) {
  if (!song.url) return "";
  return `<button type="button" class="song-preview" data-song-preview="${escape(song.id)}" data-clip-url="${escape(song.url)}" data-clip-title="${escape(song.title)}" data-clip-duration="${Number(song.duration) || 0}" aria-label="Play a random clip from ${escape(song.title)}" title="Play a random clip"><svg aria-hidden="true" viewBox="0 0 24 28"><path d="M12 2C8 2 3 11 3 17a9 9 0 0 0 18 0c0-6-5-15-9-15Z"/><path class="song-preview-play" d="m10 11 6 4-6 4Z"/></svg></button>`;
}

export const badgeSoundIcon =
  '<svg class="badge-sound-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"></path><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"></path><path d="M18 7a7 7 0 0 1 0 10"></path></svg>';

// The page's own player is in the document; a sound made here never is.
function pauseOthers(except) {
  for (const media of document.querySelectorAll("audio, video")) if (media !== except && !media.paused) media.pause();
}

function stop() {
  if (!current) return;
  clearInterval(current.watch);
  clearTimeout(current.patience);
  current.settle(false);
  current.audio.pause();
  current.button?.classList.remove("is-playing");
  current = null;
}

// An announcement has no badge to light up, so the button is optional. Badges
// take turns with the clips; a caller that names one leaves that rotation alone. A clip
// can also be a moment of a song, { url, start, end }, which fades out at its end.
// Only one sound plays at a time: a new one replaces the last, pauses whatever media the page
// is playing once it starts, and gives way when the page starts playing something itself.
// A sound played `over` the page is the exception: it leaves the music alone and is heard on top
// of it, though it still gives way to a song that starts while it sings.
// The result says when the sound is really heard: heard resolves true once it starts (or has
// failed), false if something else took its place first or it never arrived within loadPatience.
// A moment only counts as started once the audio has reached it, so a slow seek never lets the
// picture and caption run ahead of the sound.
// length() is how long the sound lasts in ms, or NaN while that is unknown.
const volume = 0.85, fadeSeconds = 0.25, loadPatience = 15000, seekSlack = 0.1;
function play(button = null, clip = null, { over = false } = {}) {
  stop();
  const moment = clip && typeof clip === "object" ? clip : null;
  const audio = new Audio(moment ? moment.url : clip ?? clips[next]);
  if (!clip) next = (next + 1) % clips.length;
  audio.volume = volume;
  let settle;
  const heard = new Promise((resolve) => { settle = resolve; });
  const playing = (current = { audio, button, settle });
  button?.classList.add("is-playing");
  const done = () => {
    settle(true);
    if (current === playing) stop();
  };
  // A sound that never arrives is given up on, not faked, so nothing animates in silence.
  playing.patience = setTimeout(() => { if (current === playing) stop(); }, loadPatience);
  let started = false;
  let running = false;
  const begin = () => {
    if (started || !running || (moment && (!Number.isFinite(moment.start) || audio.currentTime < moment.start - seekSlack))) return;
    started = true;
    for (const event of ["playing", "timeupdate", "seeked"]) audio.removeEventListener(event, begin);
    settle(true);
    if (!over) pauseOthers(audio);
  };
  audio.addEventListener("playing", () => { running = true; begin(); });
  audio.addEventListener("timeupdate", begin);
  audio.addEventListener("seeked", begin);
  if (moment) {
    // Browsers differ on when a seek is honoured, so ask now and again once the length is known.
    const seek = () => {
      if (!Number.isFinite(moment.start)) Object.assign(moment, randomSongSlice({ ...moment, duration: audio.duration }));
      if (Number.isFinite(moment.start) && audio.currentTime < moment.start) audio.currentTime = moment.start;
    };
    seek();
    audio.addEventListener("loadedmetadata", seek);
    playing.watch = setInterval(() => {
      const left = moment.end - audio.currentTime;
      if (left <= 0) done();
      else if (left < fadeSeconds) audio.volume = volume * (left / fadeSeconds);
    }, 40);
  }
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  audio.play().catch(done);
  const length = () => (moment ? (moment.end - moment.start) * 1000 : audio.duration * 1000);
  return { heard, audio, length };
}

// Three quick clicks on a cover sample that song; the hero record samples a random song.
// Clip audio is started inside the click gesture, even when lyric cues haven't loaded yet.
// artShockMs is only for a sound whose length is unknown.
const artTaps = 3, artWindow = 1000, artShockMs = 3400, shockGrace = 2500;
const taps = new WeakMap();
const shocked = new WeakMap();

// The sung moments are built with the site and fetched once, as the first tap lands, so they
// are ready by the third. Without cues, take a random slice of the selected recording.
let moments = null;
let loading = false;
function loadMoments() {
  if (loading) return;
  loading = true;
  fetch("/egg-clips.json")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.statusText))))
    .then((data) => { moments = Array.isArray(data?.clips) ? data.clips : []; })
    .catch(() => { moments = []; });
}

// Exported for Œuful (/oeuful), which plays the egg back to back on a picture of its own.
export function shock(art, ms, audio, caption) {
  shocked.get(art)?.();
  art.classList.remove("egg-shock");
  void art.offsetWidth;
  art.style.setProperty("--egg-ms", ms + "ms");
  art.classList.add("egg-shock");
  const calm = art.getAttribute("src");
  let gasping = null;
  // The sound ending is what ends the shake; the timer is only a safety net, and a slow machine
  // that starts a moment late is given time to finish it.
  const live = audio && !audio.paused && !audio.ended;
  const timer = setTimeout(() => shocked.get(art)?.(), live ? ms + shockGrace : ms);
  // A spinning record's bounding rectangle grows and shrinks. Anchor its words
  // to the stationary sleeve so the caption stays still while the colors change.
  const record = art.matches(".record");
  const anchor = record ? art.closest(".sleeve") || art : art;
  const removeCaption = caption ? showCaption(anchor, { ...caption, steady: record }, audio) : null;
  // The shake follows the sound: while the audio is starved the picture holds still too.
  const stall = () => art.classList.add("egg-stalled");
  const resume = () => art.classList.remove("egg-stalled");
  audio?.addEventListener("waiting", stall);
  audio?.addEventListener("playing", resume);
  // A sound that is cut short takes its picture with it; an older sound never ends a newer shake.
  const soundOver = () => { if (shocked.get(art) === release) release(); };
  const release = () => {
    clearTimeout(timer);
    removeCaption?.();
    for (const event of ["pause", "ended"]) audio?.removeEventListener(event, soundOver);
    audio?.removeEventListener("waiting", stall);
    audio?.removeEventListener("playing", resume);
    shocked.delete(art);
    art.classList.remove("egg-shock", "egg-stalled");
    art.style.removeProperty("--egg-ms");
    if (gasping && art.getAttribute("src") === gasping) art.setAttribute("src", calm);
  };
  shocked.set(art, release);
  for (const event of ["pause", "ended"]) audio?.addEventListener(event, soundOver, { once: true });
  // The face is drawn in song-art.js, which the egg loads only when it is found.
  import("./song-art.js").then(({ shockedArtwork }) => {
    const src = shocked.has(art) && shockedArtwork(calm);
    if (src) art.setAttribute("src", (gasping = src));
  }).catch(() => {});
  // Œuful's records play on past their moment, so it ends the shake itself.
  return soundOver;
}
// The art pulses while the sound loads (the stylesheet holds that back if it is quick), then shakes.
const loadingArt = new WeakMap();
function whenHeard(art, { heard, audio, length }, caption = null) {
  const token = {};
  loadingArt.set(art, token);
  art.classList.add("egg-loading");
  heard.then((ok) => {
    if (loadingArt.get(art) !== token) return;
    loadingArt.delete(art);
    art.classList.remove("egg-loading");
    if (!ok) return;
    const ms = length();
    shock(art, ms > 0 && Number.isFinite(ms) ? ms : artShockMs, audio, caption);
  });
}
function tapArt(art, at, chooseSong) {
  const recent = [...(taps.get(art) || []).filter((tap) => at - tap < artWindow), at];
  taps.set(art, recent);
  loadMoments();
  if (recent.length < artTaps) return;
  taps.delete(art);
  sampleSong(art, chooseSong());
}
function sampleSong(art, song, button = null) {
  if (!song?.url) return;
  const moment = pickEggMoment(moments?.filter((clip) => clip.id === song.id)) || randomSongSlice(song);
  whenHeard(art, play(button, moment), { title: song.title, lines: moment.lines });
}

export function mountRecordSounds(record, getSongs) {
  if (!record) return;
  let previous = null;
  record.addEventListener("click", (event) => tapArt(record, event.timeStamp, () => {
    const songs = (getSongs?.() || []).filter((song) => song.url && !song.qualityIssues?.length);
    const alternatives = songs.filter((song) => song.id !== previous);
    const pool = alternatives.length ? alternatives : songs;
    const song = pool[Math.floor(Math.random() * pool.length)];
    previous = song?.id;
    return song;
  }));
}

let mounted = false;
export function mountBadgeSounds(root = document) {
  // Its listeners are on the document, which outlives the pages that swap in and out of it.
  if (mounted && root === document) return;
  if (root === document) mounted = true;
  // Media events do not bubble, but they can be caught on the way down.
  root.addEventListener("play", (event) => { if (event.target instanceof HTMLMediaElement) stop(); }, true);
  for (const event of ["pointerover", "focusin"]) root.addEventListener(event, ({ target }) => {
    if (target.closest?.("[data-song-preview]")) loadMoments();
  });
  root.addEventListener("click", (event) => {
    const preview = event.target.closest?.("[data-song-preview]");
    if (preview) {
      event.preventDefault();
      loadMoments();
      return sampleSong(preview.closest(".track")?.querySelector(".track-art") || preview, {
        id: preview.dataset.songPreview, url: preview.dataset.clipUrl,
        title: preview.dataset.clipTitle, duration: Number(preview.dataset.clipDuration),
      }, preview);
    }
    // Saved covers open the viewer; repeated opens must never start a sample.
    if (event.target.closest?.("[data-cover-open]")) return;
    // The click keeps its usual job, such as opening a pending row.
    const art = event.target.closest?.(".track-art");
    if (art) return tapArt(art, event.timeStamp, () => ({
      id: art.dataset.clipId, url: art.dataset.clipUrl,
      title: art.dataset.clipTitle, duration: Number(art.dataset.clipDuration),
    }));
    const button = event.target.closest?.(".badge-sound");
    if (!button) return;
    // Badges can sit inside a <summary>; a click here plays audio instead of toggling the row.
    event.preventDefault();
    if (current?.button === button) return stop();
    play(button);
  });
}

// Requests already 9/11'd when a page opens are old news; the history that keeps
// them quiet is shared across pages and tabs.
let announced = null;
function readAnnounced() {
  try {
    const saved = JSON.parse(localStorage.getItem(announcedKey));
    if (Array.isArray(saved) && saved.every((id) => typeof id === "string")) return new Set(saved);
  } catch { /* Keep this page's history if storage is unavailable. */ }
  return announced;
}
function remember(ids) {
  announced = new Set(ids);
  // Only the current list is kept, so a retried request that fails again is announced again.
  try { localStorage.setItem(announcedKey, JSON.stringify([...announced])); } catch { /* This page still avoids repeats. */ }
}

// Play the line once when requests turn up newly 9/11'd. Callers pass the
// requests they just loaded, and only a complete list, so a request missing
// from a partial page is not mistaken for a recovery.
export async function announceAttention(requests) {
  const ids = (Array.isArray(requests) ? requests : [])
    .filter((request) => request?.id && hasBadgeSound(recoveryStatus(request)))
    .map((request) => request.id);
  const announce = () => {
    const previous = readAnnounced();
    remember(ids);
    // The first list only establishes the baseline; browsers may also refuse
    // audio before the page has been clicked, and that attempt still counts.
    // The news is sung over whatever is playing: a failure is no reason to stop the music.
    if (previous && ids.some((id) => !previous.has(id))) play(null, null, { over: true });
  };
  // Serialize with other open tabs so one failure is announced once, not once per tab.
  if (navigator.locks?.request) {
    try {
      await navigator.locks.request(announcedKey, { ifAvailable: true }, (lock) => { if (lock) announce(); });
    } catch { announce(); }
  } else announce();
}
