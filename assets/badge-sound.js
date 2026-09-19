// "9/11'd Again" badges sing a line from the song of the same name when clicked.
// Clips load only on the first click, so the badge costs nothing until someone presses it.
const clips = ["/assets/sounds/one-loud-crash.mp3", "/assets/sounds/nine-elevend-again.mp3"];
const soundStatuses = new Set(["failed", "attention"]);
let next = 0;
let current = null;

export const hasBadgeSound = (status) => soundStatuses.has(status);

export const badgeSoundIcon =
  '<svg class="badge-sound-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"></path><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"></path><path d="M18 7a7 7 0 0 1 0 10"></path></svg>';

function stop() {
  if (!current) return;
  current.audio.pause();
  current.button.classList.remove("is-playing");
  current = null;
}

export function mountBadgeSounds(root = document) {
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.(".badge-sound");
    if (!button) return;
    // Badges can sit inside a <summary>; a click here plays audio instead of toggling the row.
    event.preventDefault();
    if (current?.button === button) return stop();
    stop();
    const audio = new Audio(clips[next]);
    next = (next + 1) % clips.length;
    audio.volume = 0.85;
    const playing = (current = { audio, button });
    button.classList.add("is-playing");
    const done = () => {
      if (current === playing) stop();
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", done);
    audio.play().catch(done);
  });
}
