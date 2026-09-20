// "9/11'd Again" badges sing a line from the song of the same name when clicked.
// Clips load only on the first click, so the badge costs nothing until someone presses it.
import { recoveryStatus } from "./recovery.js";
import { pickEggMoment } from "./egg-clips.js";

const clips = ["/assets/sounds/one-loud-crash.mp3", "/assets/sounds/nine-elevend-again.mp3"];
const soundStatuses = new Set(["failed", "attention"]);
const announcedKey = "yehry3:announced-attention";
let next = 0;
let current = null;

export const hasBadgeSound = (status) => soundStatuses.has(status);

export const badgeSoundIcon =
  '<svg class="badge-sound-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"></path><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"></path><path d="M18 7a7 7 0 0 1 0 10"></path></svg>';

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
// The result says when the sound is really heard: heard resolves true once it starts (or has
// failed, or has taken longer than loadPatience), false if something else took its place first.
// length() is how long the sound lasts in ms, or NaN while that is unknown.
const volume = 0.85, fadeSeconds = 0.25, loadPatience = 4000;
function play(button = null, clip = null) {
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
  playing.patience = setTimeout(() => settle(true), loadPatience);
  audio.addEventListener("playing", () => settle(true), { once: true });
  if (moment) {
    // Browsers differ on when a seek is honoured, so ask now and again once the length is known.
    const seek = () => { if (audio.currentTime < moment.start) audio.currentTime = moment.start; };
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

// Easter egg: hammering any cover art three times inside a second sings every clip in turn,
// the title line first. It keeps its own place so it never disturbs the badges' rotation.
// The picture shakes, flashes and gasps for exactly as long as the sound plays. The first
// hammering sings the title line; after that most sing a random moment from a recording,
// and one in five sings the fixed clips again.
// artShockMs is only for a sound whose length is unknown.
const artTaps = 3, artWindow = 1000, artShockMs = 3400, artFixedOdds = 0.2;
let taps = [];
let artNext = 1;
let artHeard = false;
let artSong = null;
const shocked = new WeakMap();

// The sung moments are built with the site and fetched once, as the first tap lands, so they
// are ready by the third. If they never arrive, the egg keeps singing the fixed clips.
let moments = null;
let loading = null;
function loadMoments() {
  loading ??= fetch("/egg-clips.json")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.statusText))))
    .then((data) => { moments = Array.isArray(data?.clips) ? data.clips : []; })
    .catch(() => { moments = []; });
}

function shock(art, ms, audio) {
  shocked.get(art)?.();
  art.classList.remove("egg-shock");
  void art.offsetWidth;
  art.style.setProperty("--egg-ms", ms + "ms");
  art.classList.add("egg-shock");
  const calm = art.getAttribute("src");
  let gasping = null;
  const timer = setTimeout(() => calm && shocked.get(art)?.(), ms);
  // A sound that is cut short takes its picture with it; an older sound never ends a newer shake.
  const soundOver = () => { if (shocked.get(art) === release) release(); };
  const release = () => {
    clearTimeout(timer);
    for (const event of ["pause", "ended"]) audio?.removeEventListener(event, soundOver);
    shocked.delete(art);
    art.classList.remove("egg-shock");
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
}
// The art pulses while the sound loads (the stylesheet holds that back if it is quick), then shakes.
const loadingArt = new WeakMap();
function whenHeard(art, { heard, audio, length }) {
  const token = {};
  loadingArt.set(art, token);
  art.classList.add("egg-loading");
  heard.then((ok) => {
    if (loadingArt.get(art) !== token) return;
    loadingArt.delete(art);
    art.classList.remove("egg-loading");
    if (!ok) return;
    const ms = length();
    shock(art, ms > 0 && Number.isFinite(ms) ? ms : artShockMs, audio);
  });
}
function tapArt(art, at) {
  taps = [...taps.filter((tap) => at - tap < artWindow), at];
  loadMoments();
  if (taps.length < artTaps) return;
  taps = [];
  const moment = artHeard && moments?.length && Math.random() >= artFixedOdds ? pickEggMoment(moments, Math.random, artSong) : null;
  artHeard = true;
  if (moment) {
    artSong = moment.id;
    // The picture waits for the sound, which may need a moment to load.
    whenHeard(art, play(null, moment));
    return;
  }
  whenHeard(art, play(null, clips[artNext]));
  artNext = (artNext + 1) % clips.length;
}

export function mountBadgeSounds(root = document) {
  root.addEventListener("click", (event) => {
    // The click keeps its usual job, such as opening a pending row.
    const art = event.target.closest?.(".track-art");
    if (art) return tapArt(art, event.timeStamp);
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
    if (previous && ids.some((id) => !previous.has(id))) play();
  };
  // Serialize with other open tabs so one failure is announced once, not once per tab.
  if (navigator.locks?.request) {
    try {
      await navigator.locks.request(announcedKey, { ifAvailable: true }, (lock) => { if (lock) announce(); });
    } catch { announce(); }
  } else announce();
}
