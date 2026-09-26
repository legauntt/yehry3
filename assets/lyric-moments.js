import { player } from "./player.js";

export function sharedTimestamp(url = new URL(location.href)) {
  const value = url.searchParams.get("t");
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(value || "")) return null;
  const seconds = Number(value);
  return seconds <= 86400 ? seconds : null;
}

const timeLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
// A moment link is opened once per song per page visit, however often the sheet redraws.
const restored = new WeakSet();

// `sheet` is the lyric sheet's view of the site's player (see lyrics.js): the moment is read from
// the recording when the sheet's song is the one playing, and otherwise from the place chosen on it.
export function mountMomentSharing(main, sheet) {
  const holder = main.querySelector(".shared-song-player");
  if (!holder) return () => {};
  const controls = holder.querySelector(".sheet-controls") || holder;
  const controller = new AbortController(), { signal } = controller;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiet sheet-icon sheet-share";
  button.id = "share-moment";
  controls.append(button);
  const rest = document.createElement("div");
  rest.className = "lyric-moment";
  rest.hidden = true;
  rest.innerHTML = '<p class="small" id="moment-status" role="status"></p><div id="moment-link-field" hidden><label for="moment-link">Link to this moment</label><input id="moment-link" type="text" readonly></div>';
  holder.append(rest);
  const status = rest.querySelector("#moment-status");
  const update = () => {
    button.textContent = `Share this moment · ${timeLabel(sheet.position())}`;
    button.title = button.textContent;
  };
  const timestamp = sharedTimestamp();
  if (timestamp !== null && !restored.has(sheet)) {
    restored.add(sheet);
    sheet.seek(timestamp);
    status.textContent = `Starts at ${timeLabel(timestamp)}. Press play when you’re ready.`;
    rest.hidden = false;
  }
  button.addEventListener("click", async () => {
    const seconds = Math.max(0, Math.round(sheet.position() * 10) / 10);
    const url = new URL(location.href);
    url.searchParams.set("t", String(seconds));
    const lines = [...main.querySelectorAll("button.lyric-line")];
    const line = lines.filter(item => Number(item.dataset.start) <= seconds).at(-1);
    url.hash = line?.id || "";
    history.replaceState(history.state, "", url);
    main.querySelectorAll(".lyric-line.is-linked").forEach(item => item.classList.remove("is-linked"));
    line?.classList.add("is-linked");
    const input = rest.querySelector("#moment-link");
    rest.hidden = false;
    input.value = url.href;
    rest.querySelector("#moment-link-field").hidden = false;
    try { await navigator.clipboard.writeText(url.href); status.textContent = `Link copied at ${timeLabel(seconds)}.`; }
    catch { input.focus(); input.select(); status.textContent = `Copy this link to share the song at ${timeLabel(seconds)}.`; }
  }, { signal });
  sheet.audio.addEventListener("timeupdate", update, { signal });
  // A link already revealed for copying follows subsequent format selections.
  addEventListener("yehry3:lyric-view", () => {
    const input = rest.querySelector("#moment-link");
    if (!input.value) return;
    const link = new URL(input.value);
    const view = new URL(location.href).searchParams.get("view");
    if (link.searchParams.get("view") === view) return;
    link.searchParams.set("view", view);
    // The saved timestamp remains meaningful across transcripts; line numbers do not.
    const line = [...main.querySelectorAll("button.lyric-line")].filter(item => Number(item.dataset.start) <= Number(link.searchParams.get("t"))).at(-1);
    link.hash = line?.id || "";
    input.value = link.href;
    status.textContent = "Link updated for this lyric view. Select Share to copy it again.";
  }, { signal });
  sheet.audio.addEventListener("seeking", update, { signal });
  player.on("change", update, signal);
  sheet.watchers.add(update);
  signal.addEventListener("abort", () => sheet.watchers.delete(update), { once: true });
  update();
  return () => controller.abort();
}
