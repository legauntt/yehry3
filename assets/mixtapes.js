import { musicBackendBadge } from "./music-provenance.js";
import { api, publicApi } from "./api.js";
import { watchCompletions } from "./notifications.js";
import { qualityNotice } from "./quality.js";
import { lyricsHref } from "./song-links.js";
import { tapeKey, tapeColors, emptyTape, validateTape, decodeTape, tapeDuration, tapeIdPattern, tapeHref } from "./mixtape-data.js";
import { drawInk, mountHandwriting } from "./tape-handwriting.js";

const main = document.querySelector("#main");
watchCompletions();
addEventListener("hashchange", event => {
  const payload = url => new URLSearchParams(new URL(url).hash.slice(1)).get("tape");
  if (payload(event.oldURL) !== payload(event.newURL)) location.reload();
});
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeAudio = song => {
  try { const url = new URL(song?.url, location.origin); return ["https:", "http:"].includes(url.protocol) && song?.url ? url.href : ""; }
  catch { return ""; }
};
const clock = seconds => Number.isFinite(seconds) && seconds >= 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "—:—";
const pathId = location.pathname.replace(/^\/mixtapes\/?/, "").replace(/\/$/, "");
let sharedId = pathId && pathId !== "index.html" ? pathId : null;
let tape = emptyTape(), shared = Boolean(sharedId) || new URLSearchParams(location.hash.slice(1)).has("tape"), invalid = false, catalog = new Map();
let lastShare = null;
// Separate entry identities keep repeated songs and the playing recording stable during edits.
let serial = 0, slots, currentKey = null, activeSide = "a";
const newSlot = id => ({ id, key: ++serial });
try {
  if (sharedId) {
    if (!tapeIdPattern.test(sharedId)) throw new Error("This mixtape could not be found. Check the link and try again.");
    const saved = await publicApi(`/mixtapes/${sharedId}`);
    tape = validateTape(saved.tape);
    lastShare = { snapshot: JSON.stringify(tape), id: sharedId };
  }
  else if (shared) tape = decodeTape(new URLSearchParams(location.hash.slice(1)).get("tape"));
  else {
    const saved = localStorage.getItem(tapeKey);
    if (saved) tape = validateTape(JSON.parse(saved));
  }
} catch (error) {
  if (shared) {
    main.innerHTML = `<section class="empty"><h1>This mixtape could not open.</h1><p>${escape(error.message)}</p><div class="actions"><button class="primary" id="retry-tape">Try again</button><a class="text-link" href="/mixtapes/">Make a mixtape</a></div></section>`;
    main.querySelector("#retry-tape").onclick = () => location.reload();
    invalid = true;
  }
}
slots = { a: tape.a.map(newSlot), b: tape.b.map(newSlot) };
if (!invalid) mount();

async function mount() {
  main.innerHTML = `<section class="tape-hero">
      <div class="tape-intro"><p class="eyebrow">The listening room / Mixtapes</p><h1>A little more<br><em>personal.</em></h1><p class="lede">An opener. A change of pace. One last song.<br>Make someone a tape worth turning over.</p>
        <p class="tape-how"><span>01 &nbsp; Pick your songs</span><span>02 &nbsp; Make it yours</span><span>03 &nbsp; Pass it on</span></p>
        <div class="actions tape-actions"><button class="primary" id="share-tape" disabled>Copy mixtape link</button>${shared ? '<button class="quiet" id="edit-tape">Make your own version</button>' : '<a class="text-link" href="#tape-picker">Find your first track ↓</a>'}</div>
        <p class="small" id="tape-status" role="status">${shared ? "A tape made to be passed around. Press play, or make your own version." : "Your draft saves in this browser. Shared links keep a snapshot of your tape."}</p>
        <div id="tape-share" hidden><label for="tape-link">Mixtape link</label><input id="tape-link" readonly></div>
      </div>
      <section class="tape-deck" id="tape-deck" aria-label="Mixtape player" data-playing="false">
        <div class="deck-brand"><span>YEHRY3 <b>/ TAPE DECK</b></span><span class="deck-indicator">STEREO</span></div>
        <div class="deck-bay"><section class="tape-sleeve" aria-label="Mixtape sleeve">
          <i class="tape-screw screw-tl" aria-hidden="true"></i><i class="tape-screw screw-tr" aria-hidden="true"></i><i class="tape-screw screw-bl" aria-hidden="true"></i><i class="tape-screw screw-br" aria-hidden="true"></i>
          <div class="cassette-label"><div class="cassette-label-top"><span class="tiny-label" id="tape-collection-name">A PERSONAL SELECTION</span><span id="cassette-side">SIDE A</span></div><h2 id="tape-title"></h2><canvas class="cassette-ink" id="tape-label-ink" role="img" hidden></canvas><p id="tape-total"></p></div>
          <div class="tape-window" aria-hidden="true"><span class="tape-spool"><i class="tape-reel"></i></span><span class="tape-bridge"><i></i></span><span class="tape-spool"><i class="tape-reel"></i></span></div>
          <div class="cassette-bottom" aria-hidden="true"><span>TONY C</span><span class="cassette-head"><i></i><i></i><i></i></span><span>HI-FI</span></div>
        </section></div>
        <div class="deck-display" role="status"><span id="tape-mode">READY · SIDE A</span><strong id="tape-now">A blank tape. A world of possibilities.</strong><span id="tape-counter">Choose a few songs below.</span></div>
        <div class="deck-timeline"><span id="tape-elapsed">0:00</span><label class="sr-only" for="tape-seek">Seek in song</label><input id="tape-seek" type="range" min="0" max="100" step="0.1" value="0" disabled><span id="tape-duration">0:00</span></div>
        <div class="deck-transport"><button id="tape-prev" aria-label="Previous song" disabled><span aria-hidden="true">|◀</span><small>PREV</small></button><button id="play-tape" aria-label="Play the mixtape" disabled><span id="tape-play-icon" aria-hidden="true">▶</span><small id="tape-play-label">PLAY</small></button><button id="tape-stop" aria-label="Stop playback" disabled><span aria-hidden="true">■</span><small>STOP</small></button><button id="tape-next" aria-label="Next song" disabled><span aria-hidden="true">▶|</span><small>NEXT</small></button><button id="flip-tape" aria-label="Flip to side B"><span aria-hidden="true">⇄</span><small>FLIP</small></button></div>
        <div class="deck-bottom"><div class="deck-sides" role="group" aria-label="Cassette side"><button data-load-side="a" aria-pressed="true">Side A</button><button data-load-side="b" aria-pressed="false">Side B</button></div><label class="deck-volume" for="tape-volume">VOL<input id="tape-volume" aria-label="Volume" type="range" min="0" max="1" step="0.01" value="1"></label><span>AUTO REVERSE</span></div>
        <audio preload="metadata" hidden></audio>
      </section>
    </section>
    <section class="tape-edit" aria-label="Personalize your tape" ${shared ? "hidden" : ""}><div><label for="tape-name">Mixtape name</label><input id="tape-name" maxlength="80"></div><div><label for="tape-color">Sleeve color</label><select id="tape-color">${tapeColors.map(color => `<option value="${color}">${color[0].toUpperCase() + color.slice(1)}</option>`).join("")}</select></div><p class="small">Two sides. Two stories.<br>Give each one its own label.</p>
      <div class="tape-label-editors">${["a", "b"].map(side => `<div class="tape-label-editor"><label for="label-${side}">Side ${side.toUpperCase()} label</label><input id="label-${side}" data-label-text="${side}" maxlength="80" placeholder="${side === "a" ? "The long way home" : "After midnight"}"><details data-label-editor="${side}"><summary>Handwrite side ${side.toUpperCase()}</summary><p class="small">Write with a mouse, finger, or pen. The typed label stays available for readers and screen readers.</p><canvas class="handwriting-pad" aria-label="Draw a handwritten label for side ${side.toUpperCase()}" role="img"></canvas><div class="actions"><button class="quiet" data-ink-undo>Undo stroke</button><button class="quiet" data-ink-clear>Use typed label</button></div><p class="small" data-ink-status role="status"></p></details></div>`).join("")}</div></section>
    <div class="tape-workspace"><section class="tape-tracklist" aria-label="Your tracklist"><div class="section-heading"><h2>The running order.</h2><span class="small" id="tape-count"></span></div><p class="small">${shared ? "Pick a track to start there. Side B follows Side A automatically." : "Click a title to listen. Drag to reorder, or use the arrow buttons."}</p><div class="tape-sides" id="tape-sides"></div></section>
      <section class="tape-picker" id="tape-picker" ${shared ? "hidden" : ""}><p class="eyebrow">The record shelf</p><h2>Find your next track.</h2><div class="tape-starter"><span class="small">Need a starting point?</span><button class="quiet" id="tape-surprise" disabled>Add a surprise mix ↗</button></div><label class="sr-only" for="tape-search">Find a song</label><input type="search" id="tape-search" placeholder="Search the collection…"><p class="small" id="tape-results" role="status"></p><div id="tape-catalog"><p>Getting the records out…</p></div></section>
    </div><aside class="tape-dock" aria-label="Quick playback controls" hidden><div><span class="eyebrow">On the tape</span><strong id="tape-mini-now"></strong></div><button class="quiet" id="tape-mini-toggle" aria-label="Pause from mini player">Ⅱ</button><a class="text-link" href="#tape-deck">Player ↑</a></aside>`;
  const $ = selector => main.querySelector(selector);
  const status = text => { $("#tape-status").textContent = text; };
  const audio = $("audio");
  const entries = () => ["a", "b"].flatMap(side => slots[side].map(entry => ({ ...entry, side, song: catalog.get(entry.id) })));
  const playable = () => entries().filter(entry => safeAudio(entry.song));
  const current = () => entries().find(entry => entry.key === currentKey);
  let loadedKey = null, playRequest = 0, deckVisible = true, shareBusy = false;

  function renderLabel() {
    const label = tape.labels[activeSide], title = label.text || tape.name || "My Tony C mixtape";
    $("#tape-title").textContent = title;
    $("#tape-title").classList.toggle("sr-only", Boolean(label.ink.length));
    $("#tape-collection-name").textContent = tape.name || "A PERSONAL SELECTION";
    $("#tape-label-ink").hidden = !label.ink.length;
    $("#tape-label-ink").setAttribute("aria-label", `Handwritten side ${activeSide.toUpperCase()} label: ${title}`);
    if (label.ink.length) drawInk($("#tape-label-ink"), label.ink);
    const count = slots[activeSide].length;
    $("#tape-total").textContent = `SIDE ${activeSide.toUpperCase()} · ${count} ${count === 1 ? "track" : "tracks"} / ${tapeDuration(slots[activeSide].map(entry => entry.id), catalog)}`;
  }

  function save() {
    if (shared) return;
    tape.a = slots.a.map(entry => entry.id);
    tape.b = slots.b.map(entry => entry.id);
    try { localStorage.setItem(tapeKey, JSON.stringify(tape)); status("Draft saved in this browser. Copy a link to share this version."); }
    catch { status("Browser storage is unavailable. Copy a mixtape link to keep your selection."); }
    $("#tape-share").hidden = true;
  }

  function syncPlayer() {
    const entry = current(), queue = playable(), index = queue.findIndex(item => item.key === currentKey);
    const playing = !audio.paused && !audio.ended;
    if (entry) activeSide = entry.side;
    $(".tape-deck").dataset.playing = String(playing);
    $("#cassette-side").textContent = `SIDE ${activeSide.toUpperCase()}`;
    renderLabel();
    $("#tape-mode").textContent = `${playing ? "PLAYING" : audio.ended ? "TAPE FINISHED" : loadedKey ? "PAUSED" : "READY"} · SIDE ${activeSide.toUpperCase()}`;
    $("#tape-now").textContent = entry?.song?.title || (slots[activeSide].length ? "Your selection is ready." : `Side ${activeSide.toUpperCase()} is a blank canvas.`);
    $("#tape-counter").textContent = entry ? `Track ${slots[entry.side].findIndex(item => item.key === entry.key) + 1} of ${slots[entry.side].length} on this side` : "Press play. Stay a while.";
    $("#play-tape").disabled = !queue.length;
    $("#play-tape").setAttribute("aria-label", playing ? "Pause mixtape" : "Play the mixtape");
    $("#tape-play-icon").textContent = playing ? "Ⅱ" : "▶";
    $("#tape-play-label").textContent = playing ? "PAUSE" : "PLAY";
    $("#tape-prev").disabled = index <= 0;
    $("#tape-next").disabled = index < 0 || index >= queue.length - 1;
    $("#tape-stop").disabled = !loadedKey;
    $(".tape-dock").hidden = !loadedKey || deckVisible;
    $("#tape-mini-now").textContent = entry?.song?.title || "Mixtape";
    $("#tape-mini-toggle").textContent = playing ? "Ⅱ" : "▶";
    $("#tape-mini-toggle").setAttribute("aria-label", `${playing ? "Pause" : "Play"} from mini player`);
    $("#flip-tape").setAttribute("aria-label", `Flip to side ${activeSide === "a" ? "B" : "A"}`);
    main.querySelectorAll("[data-load-side]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.loadSide === activeSide)));
    main.querySelectorAll(".tape-track").forEach(row => {
      const selected = Number(row.dataset.key) === currentKey;
      row.classList.toggle("is-current", selected);
      row.querySelector("[data-track-play]")?.setAttribute("aria-current", selected ? "true" : "false");
    });
  }
  function syncTime() {
    const duration = audio.duration, seekable = Boolean(loadedKey) && Number.isFinite(duration) && duration > 0;
    $("#tape-elapsed").textContent = clock(audio.currentTime);
    $("#tape-duration").textContent = seekable ? clock(duration) : "0:00";
    $("#tape-seek").disabled = !seekable;
    $("#tape-seek").max = seekable ? duration : 100;
    $("#tape-seek").value = seekable ? audio.currentTime : 0;
    $("#tape-seek").setAttribute("aria-valuetext", `${clock(audio.currentTime)} of ${seekable ? clock(duration) : "0:00"}`);
  }
  function render() {
    $(".tape-sleeve").dataset.color = tape.color;
    $("#tape-title").textContent = tape.name || "My Tony C mixtape";
    document.title = `${tape.name || "My Tony C mixtape"} · Mixtapes · yehry3`;
    const count = slots.a.length + slots.b.length;
    $("#tape-total").textContent = `${count} ${count === 1 ? "track" : "tracks"} / ${tapeDuration(entries().map(entry => entry.id), catalog)}`;
    $("#tape-count").textContent = `${count} / 40 tracks`;
    $("#share-tape").disabled = !count || shareBusy;
    $("#tape-sides").innerHTML = ["a", "b"].map(side => `<section class="tape-side" data-side="${side}"><div class="side-heading"><h3><span>${side.toUpperCase()}</span> Side ${side.toUpperCase()}</h3><span class="small">${tapeDuration(slots[side].map(entry => entry.id), catalog)}</span><button class="quiet" data-side-play="${side}" ${slots[side].some(entry => safeAudio(catalog.get(entry.id))) ? "" : "disabled"} aria-label="Play side ${side.toUpperCase()}">▶</button></div><ol>${slots[side].map(({ id, key }, index) => {
      const song = catalog.get(id), label = escape(song?.title || "Song unavailable");
      return `<li class="tape-track" data-index="${index}" data-key="${key}" ${shared ? "" : 'draggable="true"'}><div class="tape-track-heading"><span class="tape-track-number">${String(index + 1).padStart(2, "0")}</span><button class="tape-track-title" data-track-play="${key}" aria-label="Play ${label}" ${safeAudio(song) ? "" : "disabled"}><strong>${label}</strong></button><span class="small">${clock(song?.duration)}</span></div>${song ? qualityNotice(song.qualityIssues, song.reviewState) : '<p class="small">This song is not currently in the catalog.</p>'}<div class="tape-track-tools">${musicBackendBadge(song)}${song?.hasLyrics || song?.lyrics?.text ? `<a class="text-link" href="${lyricsHref(song)}">Lyrics ↗</a>` : ""}${shared ? "" : `<div class="tape-moves"><button class="quiet" data-move="up" aria-label="Move ${label} up" ${index ? "" : "disabled"}>↑</button><button class="quiet" data-move="down" aria-label="Move ${label} down" ${index < slots[side].length - 1 ? "" : "disabled"}>↓</button><button class="quiet" data-move="side" aria-label="Move ${label} to side ${side === "a" ? "B" : "A"}">To ${side === "a" ? "B" : "A"}</button><button class="quiet" data-move="remove" aria-label="Remove ${label}">×</button></div>`}</div></li>`;
    }).join("")}</ol>${slots[side].length ? "" : `<div class="tape-empty"><span aria-hidden="true">${side === "a" ? "↗" : "↘"}</span><p>${side === "a" ? "Start with a song<br>that says something." : "A change of mood.<br>A second chapter."}</p>${shared ? "" : `<a href="#tape-picker" class="text-link">Add a song to side ${side.toUpperCase()} →</a>`}</div>`}</section>`).join("");
    syncPlayer();
  }
  function renderCatalog() {
    const query = $("#tape-search").value.trim().toLocaleLowerCase();
    const songs = [...catalog.values()].filter(song => song.title.toLocaleLowerCase().includes(query)).sort((a, b) => a.title.localeCompare(b.title));
    const full = slots.a.length + slots.b.length >= 40;
    $("#tape-results").textContent = `${songs.length} ${songs.length === 1 ? "song" : "songs"} · Add to A or B${full ? " · Tape full" : ""}`;
    $("#tape-surprise").disabled = full || ![...catalog.values()].some(song => safeAudio(song) && !entries().some(entry => entry.id === song.id));
    $("#tape-catalog").innerHTML = songs.length ? songs.map(song => {
      const sides = ["a", "b"].filter(side => slots[side].some(entry => entry.id === song.id));
      return `<div class="tape-pick"><div><strong>${escape(song.title)}</strong><span class="small">${clock(song.duration)}${sides.length ? ` · On side ${sides.map(side => side.toUpperCase()).join(" + ")}` : ""}</span></div><div class="tape-adds"><button class="quiet" data-add="${escape(song.id)}" data-to="a" aria-label="Add ${escape(song.title)} to side A" ${full || !safeAudio(song) ? "disabled" : ""}>+ A</button><button class="quiet" data-add="${escape(song.id)}" data-to="b" aria-label="Add ${escape(song.title)} to side B" ${full || !safeAudio(song) ? "disabled" : ""}>+ B</button></div></div>`;
    }).join("") : '<p class="small tape-no-results">No songs match that title. Try a different search.</p>';
  }
  function changed() { save(); render(); renderCatalog(); }
  $("#tape-name").value = tape.name;
  $("#tape-color").value = tape.color;
  $("#tape-name").oninput = event => { tape.name = event.target.value; save(); renderLabel(); document.title = `${tape.name || "My Tony C mixtape"} · Mixtapes · yehry3`; };
  main.querySelectorAll("[data-label-text]").forEach(input => {
    input.value = tape.labels[input.dataset.labelText].text;
    input.oninput = () => { tape.labels[input.dataset.labelText].text = input.value; save(); renderLabel(); };
  });
  mountHandwriting(main, { getLabel: side => tape.labels[side], onChange: () => { save(); renderLabel(); } });
  $("#tape-color").onchange = event => { tape.color = event.target.value; save(); $(".tape-sleeve").dataset.color = tape.color; };
  $("#tape-search").oninput = renderCatalog;
  $("#tape-catalog").onclick = event => {
    const button = event.target.closest("[data-add]");
    if (!button || shared || button.disabled) return;
    if (slots.a.length + slots.b.length >= 40) return status("This tape has 40 tracks. Remove one before adding another.");
    slots[button.dataset.to].push(newSlot(button.dataset.add)); changed();
    $(`[data-add="${button.dataset.add}"][data-to="${button.dataset.to}"]`)?.focus({ preventScroll: true });
  };
  $("#tape-surprise").onclick = () => {
    if (shared) return;
    const used = new Set(entries().map(entry => entry.id));
    const choices = [...catalog.values()].filter(song => safeAudio(song) && !used.has(song.id));
    for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
    const additions = choices.slice(0, Math.min(6, 40 - entries().length));
    for (const song of additions) {
      const length = side => slots[side].reduce((total, entry) => total + (catalog.get(entry.id)?.duration || 180), 0);
      slots[length("a") <= length("b") ? "a" : "b"].push(newSlot(song.id));
    }
    changed();
    // Append without hiding a storage failure reported by save().
    $("#tape-status").textContent += ` Added ${additions.length} surprise tracks across the two sides. Keep the ones you love.`;
  };
  function resetAudio() {
    playRequest++; audio.pause(); audio.removeAttribute("src"); audio.load(); loadedKey = null; currentKey = null; syncTime();
  }
  $("#tape-sides").onclick = event => {
    const sidePlay = event.target.closest("[data-side-play]");
    if (sidePlay) return loadSide(sidePlay.dataset.sidePlay, true);
    const trackPlay = event.target.closest("[data-track-play]");
    if (trackPlay) return play(Number(trackPlay.dataset.trackPlay));
    const button = event.target.closest("[data-move]");
    if (!button || shared || button.disabled) return;
    const side = button.closest("[data-side]").dataset.side, index = Number(button.closest("[data-index]").dataset.index);
    const action = button.dataset.move;
    let destination = side, focusIndex = Math.max(0, action === "up" ? index - 1 : action === "down" ? index + 1 : index);
    const [entry] = slots[side].splice(index, 1);
    if (action === "side") { destination = side === "a" ? "b" : "a"; focusIndex = slots[destination].length; slots[destination].push(entry); }
    else if (action !== "remove") slots[side].splice(focusIndex, 0, entry);
    if (action === "remove" && currentKey === entry.key) resetAudio();
    changed();
    const next = $(`[data-side="${destination}"] [data-index="${Math.min(focusIndex, slots[destination].length - 1)}"] [data-move="${action}"]`);
    (next && !next.disabled ? next : $(`[data-side="${destination}"] .tape-track-title:not(:disabled)`) || $("#tape-search"))?.focus({ preventScroll: true });
  };
  let dragged;
  $("#tape-sides").ondragstart = event => {
    const row = event.target.closest("[data-index]");
    if (!row || shared) return;
    dragged = { side: row.closest("[data-side]").dataset.side, index: Number(row.dataset.index) };
    event.dataTransfer.setData("text/plain", "mixtape-track"); event.dataTransfer.effectAllowed = "move";
  };
  $("#tape-sides").ondragover = event => { if (dragged && event.target.closest("[data-side]")) event.preventDefault(); };
  $("#tape-sides").ondrop = event => {
    const target = event.target.closest("[data-side]");
    if (!dragged || !target || shared) return;
    event.preventDefault();
    const side = target.dataset.side, row = event.target.closest("[data-index]");
    let index = row ? Number(row.dataset.index) : slots[side].length;
    if (side === dragged.side && index > dragged.index) index--;
    const [entry] = slots[dragged.side].splice(dragged.index, 1);
    slots[side].splice(index, 0, entry); dragged = null; changed();
  };
  $("#tape-sides").ondragend = () => { dragged = null; };
  async function play(key) {
    const entry = playable().find(item => item.key === key);
    if (!entry) return;
    const request = ++playRequest;
    currentKey = key; activeSide = entry.side;
    if (loadedKey !== key) { audio.src = safeAudio(entry.song); loadedKey = key; }
    if (audio.ended) audio.currentTime = 0;
    syncPlayer();
    try { await audio.play(); } catch { if (request === playRequest) status("Press play to start this song, or try the next recording."); }
    syncPlayer();
  }
  function loadSide(side, autoplay = !audio.paused && !audio.ended) {
    resetAudio(); activeSide = side;
    const entry = playable().find(item => item.side === side);
    if (entry) { currentKey = entry.key; if (autoplay) play(entry.key); }
    else status(`Side ${side.toUpperCase()} is empty. Add a song from the record shelf.`);
    syncPlayer();
  }
  function step(direction) {
    const queue = playable(), index = queue.findIndex(entry => entry.key === currentKey);
    if (index >= 0 && queue[index + direction]) play(queue[index + direction].key);
  }
  $("#play-tape").onclick = () => {
    if (!audio.paused && !audio.ended) { playRequest++; audio.pause(); return; }
    const entry = current() || playable().find(item => item.side === activeSide) || playable()[0];
    if (entry) play(entry.key);
  };
  $("#tape-prev").onclick = () => step(-1);
  $("#tape-mini-toggle").onclick = () => $("#play-tape").click();
  $("#tape-volume").oninput = event => { audio.volume = Number(event.target.value); };
  $("#tape-next").onclick = () => step(1);
  $("#tape-stop").onclick = () => { playRequest++; audio.pause(); audio.currentTime = 0; syncTime(); syncPlayer(); };
  $("#flip-tape").onclick = () => loadSide(activeSide === "a" ? "b" : "a");
  main.querySelectorAll("[data-load-side]").forEach(button => button.onclick = () => { if (button.dataset.loadSide !== activeSide) loadSide(button.dataset.loadSide); });
  $("#tape-seek").oninput = event => { if (loadedKey && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value); syncTime(); };
  audio.onended = () => { step(1); syncPlayer(); };
  for (const event of ["play", "pause", "emptied"]) audio.addEventListener(event, syncPlayer);
  for (const event of ["timeupdate", "loadedmetadata", "durationchange", "emptied"]) audio.addEventListener(event, syncTime);
  audio.onerror = () => { syncPlayer(); status("This recording could not play. Try the next song or retry when it reconnects."); };
  $("#share-tape").onclick = async () => {
    if (shareBusy) return;
    const snapshot = JSON.stringify(validateTape(tape));
    shareBusy = true; $("#share-tape").disabled = true; $("#share-tape").setAttribute("aria-busy", "true");
    status("Saving your mixtape link…");
    try {
      if (lastShare?.snapshot !== snapshot) {
        const saved = await api("/mixtapes", { method: "POST", body: { tape: JSON.parse(snapshot) } });
        if (!tapeIdPattern.test(saved.id || "")) throw new Error("The mixtape link could not be saved. Please try again.");
        lastShare = { snapshot, id: saved.id };
      }
      if (snapshot !== JSON.stringify(validateTape(tape))) { status("Your tape changed while the link was saving. Copy again to share the latest version."); return; }
      const url = new URL(tapeHref(lastShare.id), location.origin);
      $("#tape-link").value = url.href; $("#tape-share").hidden = false;
      try { await navigator.clipboard.writeText(url.href); status("Mixtape link copied. Both side labels and this track order are saved."); }
      catch { $("#tape-link").focus(); $("#tape-link").select(); status("Your mixtape is saved. Copy the selected link to share it."); }
    } catch (error) { status(`${error.message} Your selection is still here. Try copying the link again.`); }
    finally { shareBusy = false; $("#share-tape").disabled = !entries().length; $("#share-tape").removeAttribute("aria-busy"); }
  };
  $("#edit-tape")?.addEventListener("click", () => {
    shared = false; sharedId = null; history.replaceState(null, "", "/mixtapes/");
    $(".tape-edit").hidden = false; $(".tape-picker").hidden = false; $("#edit-tape").remove(); changed();
  });
  render();
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => { deckVisible = entry.isIntersecting; syncPlayer(); }).observe($("#tape-deck"));
  }
  // The independent static read keeps saved tapes usable during API outages.
  let loaded = false;
  const update = data => {
    if (!Array.isArray(data?.songs) || !data.songs.length) return;
    catalog = new Map(data.songs.map(song => [song.id, song])); loaded = true; render(); renderCatalog();
  };
  const live = publicApi("/songs/summary").then(data => update(data));
  const fallback = fetch("/catalog-summary.json").then(response => response.json()).then(data => { if (!loaded) update(data); });
  await Promise.allSettled([live, fallback]);
  if (!loaded) { $("#tape-catalog").textContent = "The collection could not load. Reload to try again."; status("Your selection is still here. The song catalog is temporarily unavailable."); }
}
