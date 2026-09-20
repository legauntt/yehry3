// "9/11'd Again" badges sing a line from the song of the same name when clicked.
// Clips load only on the first click, so the badge costs nothing until someone presses it.
import { recoveryStatus } from "./recovery.js";

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
  current.audio.pause();
  current.button?.classList.remove("is-playing");
  current = null;
}

// An announcement has no badge to light up, so the button is optional.
function play(button = null) {
  stop();
  const audio = new Audio(clips[next]);
  next = (next + 1) % clips.length;
  audio.volume = 0.85;
  const playing = (current = { audio, button });
  button?.classList.add("is-playing");
  const done = () => {
    if (current === playing) stop();
  };
  audio.addEventListener("ended", done);
  audio.addEventListener("error", done);
  audio.play().catch(done);
}

export function mountBadgeSounds(root = document) {
  root.addEventListener("click", (event) => {
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
