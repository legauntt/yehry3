// One song, several singers: every version is the same length, so switching keeps the place in the song.
const $ = (selector) => document.querySelector(selector);
const orderKey = "yehry3:v9-epochs-order-v1", revealKey = "yehry3:v9-epochs-reveal-v1";
const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* The page works without it. */ } };
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const status = (text) => { $("#player-status").textContent = text; };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// The blind order is shuffled once per browser, so a letter means the same singer after a reload.
function blindOrder(ids) {
  try {
    const saved = JSON.parse(recall(orderKey) || "null");
    if (Array.isArray(saved) && saved.length === ids.length && ids.every((id) => saved.includes(id))) return saved;
  } catch { /* Shuffle again. */ }
  const order = [...ids];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  keep(orderKey, JSON.stringify(order));
  return order;
}

try {
  const response = await fetch("/v9/epochs/versions.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Versions unavailable");
  const { song, cues, versions } = await response.json();
  if (!Array.isArray(versions) || versions.length < 2) throw new Error("Invalid version list");
  for (const version of versions) {
    const url = new URL(version.url);
    if (url.protocol !== "https:" || url.hostname !== "github.com" ||
        !url.pathname.startsWith("/legauntt/yehry3/releases/download/v9-epochs-")) throw new Error("Invalid audio URL");
  }
  const letters = new Map(blindOrder(versions.map((version) => version.id)).map((id, index) => [id, String.fromCharCode(65 + index)]));
  const audios = new Map(versions.map((version) => {
    const audio = new Audio();
    audio.preload = "none";
    audio.src = version.url;
    return [version.id, audio];
  }));
  let current = versions.find((version) => letters.get(version.id) === "A").id;
  let revealed = recall(revealKey) === "yes";
  let scrubbing = false;
  const playing = () => !audios.get(current).paused;
  const shown = () => revealed ? versions : [...versions].sort((a, b) => letters.get(a.id).localeCompare(letters.get(b.id)));

  // play() has to be called inside the click that asked for it, so a version that has not loaded yet
  // starts silent, jumps to the shared position once it knows its length, and only then is heard.
  const wanted = new Map();
  function start(audio, at, andPlay) {
    if (audio.readyState >= 1) {
      if (Math.abs(audio.currentTime - at) > 0.05) audio.currentTime = at;
    } else {
      wanted.set(audio, at);
      audio.muted = at > 0.05;
      if (!andPlay) audio.preload = "metadata";
    }
    if (andPlay) audio.play().catch(() => status("This version could not play. Try another one, or reload the page."));
  }

  function choose(id) {
    if (id === current || !audios.has(id)) return;
    const from = audios.get(current), wasPlaying = playing();
    const at = from.readyState >= 1 ? from.currentTime : Number($("#seek").value);
    from.pause();
    current = id;
    $("#pick-text").textContent = "";
    start(audios.get(current), at, wasPlaying);
    draw();
  }

  function draw() {
    const list = shown().map((version, index) => {
      const button = element("button", "version");
      button.type = "button";
      button.dataset.version = version.id;
      button.setAttribute("aria-pressed", String(version.id === current));
      button.append(element("span", "version-letter", letters.get(version.id)));
      if (revealed) {
        const words = element("span", "version-words");
        words.append(element("strong", "", version.name), element("span", "version-detail", version.detail));
        button.append(words);
      } else button.setAttribute("aria-label", `Singer ${letters.get(version.id)}`);
      button.title = `Key ${index + 1}`;
      return button;
    });
    $("#versions").replaceChildren(...list);
    $("#versions").classList.toggle("revealed", revealed);
    $("#reveal").checked = revealed;
    $("#reveal-note").hidden = revealed;
    $("#play").textContent = playing() ? "Pause" : "Play";
  }

  $("#song-title").textContent = song.title;
  $("#lyrics-link").href = song.lyrics;
  $("#seek").max = song.duration;
  $("#total").textContent = clock(song.duration);
  $("#cues").replaceChildren(...cues.map((cue) => {
    const button = element("button", "cue", `${cue.label} · ${clock(cue.at)}`);
    button.type = "button";
    button.dataset.at = cue.at;
    return button;
  }));

  for (const [id, audio] of audios) {
    audio.addEventListener("loadedmetadata", () => {
      if (!audio.muted) return;
      audio.addEventListener("seeked", () => { audio.muted = false; }, { once: true });
      audio.currentTime = wanted.get(audio) || 0;
    });
    audio.addEventListener("timeupdate", () => {
      if (id !== current || scrubbing || audio.muted) return;
      $("#seek").value = audio.currentTime;
      $("#elapsed").textContent = clock(audio.currentTime);
    });
    audio.addEventListener("waiting", () => { if (id === current) status("Loading…"); });
    audio.addEventListener("playing", () => {
      if (id !== current) return;
      status("");
      // Once someone is listening, fetch the other versions' lengths so switching is quick.
      for (const other of audios.values()) if (other.preload === "none") other.preload = "metadata";
    });
    for (const name of ["play", "pause", "ended"]) audio.addEventListener(name, () => { if (id === current) $("#play").textContent = playing() ? "Pause" : "Play"; });
    audio.addEventListener("error", () => { if (id === current) status("This version could not load. Try another one, or reload the page."); });
  }

  $("#play").onclick = () => {
    const audio = audios.get(current);
    if (playing()) audio.pause();
    else start(audio, audio.ended ? 0 : Number($("#seek").value), true);
    $("#play").textContent = playing() ? "Pause" : "Play";
  };
  $("#seek").oninput = () => { scrubbing = true; $("#elapsed").textContent = clock(Number($("#seek").value)); };
  $("#seek").onchange = () => { scrubbing = false; start(audios.get(current), Number($("#seek").value), playing()); };
  $("#cues").onclick = (event) => {
    const cue = event.target.closest("[data-at]");
    if (!cue) return;
    $("#seek").value = cue.dataset.at;
    $("#elapsed").textContent = clock(Number(cue.dataset.at));
    start(audios.get(current), Number(cue.dataset.at), true);
  };
  $("#versions").onclick = (event) => {
    const button = event.target.closest("[data-version]");
    if (!button) return;
    choose(button.dataset.version);
    $(`[data-version="${current}"]`)?.focus();
  };
  $("#reveal").onchange = () => { revealed = $("#reveal").checked; keep(revealKey, revealed ? "yes" : "no"); draw(); };
  $("#copy-pick").onclick = async () => {
    const version = versions.find((item) => item.id === current);
    const text = `My Tony pick: ${letters.get(current)} (${version.name}). yehry3.app/v9/epochs/`;
    // Shown either way, so it can be copied by hand where the clipboard is off limits.
    $("#pick-text").textContent = `Copy this: “${text}”`;
    try { await navigator.clipboard.writeText(text); $("#pick-text").textContent = `Copied: “${text}”`; } catch { /* Already shown. */ }
  };
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, select, textarea")) return;
    // On a button or link, space already belongs to that control.
    if (event.key === " " && !event.target.closest("button, a")) { event.preventDefault(); $("#play").click(); }
    const version = /^[1-9]$/.test(event.key) && shown()[Number(event.key) - 1];
    if (version) choose(version.id);
  });
  for (const control of [$("#play"), $("#seek"), $("#copy-pick")]) control.disabled = false;
  draw();
} catch {
  $("#song-title").textContent = "The listening test could not load.";
  status("Please reload the page.");
}
