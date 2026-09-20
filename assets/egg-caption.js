// The cover art easter egg's comic caption: a speech bubble under the picture (or above it, near
// the bottom of the screen) with the song's title on top and the line being sung below it.
// It follows the audio's own clock, so the words change as the lines are sung.
const width = 340, margin = 12, room = 190, lead = 0.2, tick = 60;
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

// title is the song being played; lines are { start, end, words } in the song's own seconds.
// Returns a function that takes the caption away.
export function showCaption(art, { title, lines = [] }, audio) {
  const box = document.createElement("div");
  box.className = "egg-caption";
  box.setAttribute("aria-hidden", "true");
  const heading = document.createElement("strong");
  heading.className = "egg-caption-title";
  heading.textContent = "♪ " + title;
  box.append(heading);
  let words = null;
  if (lines.length) {
    words = document.createElement("p");
    words.className = "egg-caption-words";
    box.append(words);
  }
  // A slow page can re-lay itself out (the list refreshing, the window resizing) mid-sound, so the
  // bubble is placed again whenever the picture has moved, and stays put if the picture is gone.
  let placed = "";
  const place = () => {
    if (!art.isConnected) return;
    const rect = art.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    const key = [rect.left, rect.top, rect.width, rect.height, view, window.innerHeight, window.scrollX, window.scrollY].join();
    if (key === placed) return;
    placed = key;
    const size = Math.min(width, view - margin * 2);
    const left = clamp(rect.left + rect.width / 2 - size / 2, margin, view - size - margin);
    const below = rect.bottom + room <= window.innerHeight || rect.top < room;
    box.style.width = size + "px";
    box.style.left = left + window.scrollX + "px";
    box.style.top = (below ? rect.bottom + 8 : rect.top - 8) + window.scrollY + "px";
    box.style.setProperty("--egg-tail", clamp(rect.left + rect.width / 2 - left, 22, size - 22) + "px");
    box.classList.toggle("egg-caption-above", !below);
  };
  place();
  document.body.append(box);

  let shown = -1;
  const follow = () => {
    place();
    if (!words) return;
    const time = audio?.currentTime ?? 0;
    let index = 0;
    while (index + 1 < lines.length && time >= lines[index + 1].start - lead) index += 1;
    if (index === shown) return;
    words.textContent = lines[(shown = index)].words;
    words.classList.remove("egg-caption-pop");
    void words.offsetWidth;
    words.classList.add("egg-caption-pop");
  };
  follow();
  // The audio's own events catch the words up at once when a busy page has made the timer late.
  const events = ["timeupdate", "seeked", "playing"];
  for (const event of events) audio?.addEventListener(event, follow);
  const timer = setInterval(follow, tick);
  return () => {
    clearInterval(timer);
    for (const event of events) audio?.removeEventListener(event, follow);
    box.remove();
  };
}
