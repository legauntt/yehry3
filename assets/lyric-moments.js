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
  const passage = document.createElement("div");
  passage.className = "lyric-share-passage";
  passage.hidden = true;
  passage.innerHTML = '<p class="small">Share these lyrics</p><blockquote></blockquote><div class="lyric-share-actions"><button type="button" class="quiet" data-add-line>Add next line</button><button type="button" data-copy-lyrics>Copy link</button><button type="button" class="quiet" data-close-share aria-label="Close lyric sharing">Close</button></div><p class="small" role="status"></p><input type="text" readonly aria-label="Link to selected lyrics" hidden>';
  let selectedLines = [];
  const addLine = passage.querySelector("[data-add-line]");
  const passageStatus = passage.querySelector('[role="status"]');
  const passageInput = passage.querySelector("input");
  function nextLine() {
    let next = selectedLines.at(-1)?.nextElementSibling;
    if (next === passage) next = next.nextElementSibling;
    return next?.matches("button.lyric-line") ? next : null;
  }
  function preview() {
    passage.querySelector("blockquote").textContent = selectedLines.map(line => line.querySelector("[data-lyric-text]").textContent).join("\n");
    addLine.hidden = !nextLine();
    passageStatus.textContent = "";
    passageInput.hidden = true;
    for (const line of main.querySelectorAll("button.lyric-line")) {
      line.classList.toggle("is-linked", selectedLines.includes(line));
      line.querySelector(".lyric-link-marker").textContent = "Selected";
    }
  }
  addLine.addEventListener("click", () => {
    const next = nextLine();
    if (!next) return;
    selectedLines.push(next);
    next.after(passage);
    preview();
    passage.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, { signal });
  passage.querySelector("[data-close-share]").addEventListener("click", () => {
    passage.hidden = true;
    selectedLines[0]?.focus({ preventScroll: true });
  }, { signal });
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
  main.addEventListener("click", event => {
    const line = event.target.closest?.("button.lyric-line");
    if (!line || !main.contains(line)) return;
    selectedLines = [line];
    line.after(passage);
    passage.hidden = false;
    preview();
    passage.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, { signal });
  const timestamp = sharedTimestamp();
  if (timestamp !== null && !restored.has(sheet)) {
    restored.add(sheet);
    sheet.seek(timestamp);
    status.textContent = `Starts at ${timeLabel(timestamp)}. Press play when you’re ready.`;
    rest.hidden = false;
  }
  async function share(selected = null) {
    // Never round a selected cue backward into the preceding lyric. Bound interpolated
    // starts to the millisecond precision accepted by sharedTimestamp.
    const start = selected?.dataset.start;
    const seconds = Math.max(0, start ? (/^\d+(?:\.\d{1,3})?$/.test(start) ? Number(start) : Math.ceil(Number(start) * 1000) / 1000) : Math.round(sheet.position() * 10) / 10);
    const url = new URL(location.href);
    url.searchParams.set("t", String(seconds));
    const lines = [...main.querySelectorAll("button.lyric-line")];
    const line = selected || lines.filter(item => Number(item.dataset.start) <= seconds).at(-1);
    const following = selected && selectedLines.length > 1 ? selectedLines.at(-1) : null;
    url.hash = line?.id || "";
    if (following) url.searchParams.set("through", following.id.slice("lyric-line-".length));
    else url.searchParams.delete("through");
    history.replaceState(history.state, "", url);
    main.querySelectorAll(".lyric-line.is-linked").forEach(item => item.classList.remove("is-linked"));
    line?.classList.add("is-linked");
    if (selected) selectedLines.forEach(item => item.classList.add("is-linked"));
    const input = selected ? passageInput : rest.querySelector("#moment-link");
    const feedback = selected ? passageStatus : status;
    if (!selected) rest.hidden = false;
    input.value = url.href;
    if (!selected) rest.querySelector("#moment-link-field").hidden = false;
    try { await navigator.clipboard.writeText(url.href); feedback.textContent = selected ? "Link copied. It opens at these lyrics." : `Link copied at ${timeLabel(seconds)}.`; }
    catch {
      input.hidden = false; input.focus(); input.select(); feedback.textContent = "Copy this link to share.";
      if (selected) passage.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    for (const item of main.querySelectorAll(".lyric-link-marker")) item.textContent = "Shared line";
  }
  button.addEventListener("click", () => share(), { signal });
  passage.querySelector("[data-copy-lyrics]").addEventListener("click", () => share(selectedLines[0]), { signal });
  sheet.audio.addEventListener("timeupdate", update, { signal });
  // A link already revealed for copying follows subsequent format selections.
  addEventListener("yehry3:lyric-view", () => {
    selectedLines = [];
    passage.remove();
    update();
    const input = rest.querySelector("#moment-link");
    if (!input.value) return;
    const link = new URL(input.value);
    const view = new URL(location.href).searchParams.get("view");
    if (link.searchParams.get("view") === view) return;
    link.searchParams.set("view", view);
    // The saved timestamp remains meaningful across transcripts; line numbers do not.
    const line = [...main.querySelectorAll("button.lyric-line")].filter(item => Number(item.dataset.start) <= Number(link.searchParams.get("t"))).at(-1);
    link.hash = line?.id || "";
    link.searchParams.delete("through");
    input.value = link.href;
    status.textContent = "Link updated for this lyric view. Select Share to copy it again.";
  }, { signal });
  sheet.audio.addEventListener("seeking", update, { signal });
  player.on("change", update, signal);
  sheet.watchers.add(update);
  signal.addEventListener("abort", () => sheet.watchers.delete(update), { once: true });
  signal.addEventListener("abort", () => passage.remove(), { once: true });
  update();
  return () => controller.abort();
}
