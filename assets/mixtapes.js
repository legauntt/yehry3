import { publicApi } from "./api.js";
import { watchCompletions } from "./notifications.js";
import { qualityNotice } from "./quality.js";
import { lyricsHref } from "./song-links.js";
import { tapeKey, tapeColors, emptyTape, validateTape, encodeTape, decodeTape, tapeDuration } from "./mixtape-data.js";

const main = document.querySelector("#main");
watchCompletions();
addEventListener("hashchange", () => location.reload());
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeAudio = song => {
  try { const url = new URL(song?.url, location.origin); return ["https:", "http:"].includes(url.protocol) && song?.url ? url.href : ""; }
  catch { return ""; }
};
let tape = emptyTape(), shared = Boolean(location.hash), invalid = false, catalog = new Map(), queue = [], position = -1;
try {
  if (shared) tape = decodeTape(new URLSearchParams(location.hash.slice(1)).get("tape"));
  else {
    const saved = localStorage.getItem(tapeKey);
    if (saved) tape = validateTape(JSON.parse(saved));
  }
} catch (error) {
  if (shared) {
    main.innerHTML = `<section class="empty"><h1>This mixtape could not open.</h1><p>${escape(error.message)}</p><a class="primary" href="/mixtapes/">Make a mixtape</a></section>`;
    invalid = true;
  }
}

if (!invalid) mount();

async function mount() {
  main.innerHTML = `<section class="tape-intro"><p class="eyebrow">A little off the record · Mixtapes</p><h1>Two sides.<br><em>Your kind of Tony.</em></h1><p class="lede">Pick the songs, set the order, pass it on.</p></section>
    <section class="tape-sleeve" aria-label="Mixtape sleeve"><span class="tiny-label">YEHRY3 · PERSONAL SELECTION</span><h2 id="tape-title"></h2><div class="tape-reels" aria-hidden="true"><span>✳</span><span>✳</span></div><p id="tape-total" class="small"></p></section>
    <div class="tape-edit" ${shared ? "hidden" : ""}><label for="tape-name">Mixtape name</label><input id="tape-name" maxlength="80"><label for="tape-color">Sleeve color</label><select id="tape-color">${tapeColors.map(color => `<option value="${color}">${color[0].toUpperCase() + color.slice(1)}</option>`).join("")}</select></div>
    <div class="actions tape-actions"><button class="primary" id="play-tape" disabled>Play the mixtape</button><button class="quiet" id="share-tape" disabled>Copy mixtape link</button>${shared ? '<button class="quiet" id="edit-tape">Make your own version</button>' : ""}</div>
    <p class="small" id="tape-status" role="status">${shared ? "A shared mixtape. Make your own version to change the selection." : "Your draft saves in this browser. Share a link to keep this version."}</p>
    <div id="tape-share" hidden><label for="tape-link">Mixtape link</label><input id="tape-link" readonly></div>
    <div class="tape-sides" id="tape-sides"></div>
    <section class="tape-picker" ${shared ? "hidden" : ""}><h2>Fill the tape.</h2><p class="small">Up to 40 tracks. Drag songs between sides, or use their move buttons.</p><label for="tape-search">Find a song</label><input type="search" id="tape-search" placeholder="Search the collection…"><div id="tape-catalog"><p>Getting the records out…</p></div></section>
    <aside class="player" aria-label="Mixtape player" hidden><div class="now-playing"><span class="eyebrow">On the tape</span><strong id="tape-now"></strong></div><button class="quiet" id="tape-prev" aria-label="Previous song">←</button><audio controls preload="none"></audio><button class="quiet" id="tape-next" aria-label="Next song">→</button></aside>`;
  const $ = selector => main.querySelector(selector);
  const status = text => { $("#tape-status").textContent = text; };
  const audio = $("audio");
  function save() {
    if (shared) return;
    try { localStorage.setItem(tapeKey, JSON.stringify(tape)); status("Draft saved in this browser. Copy a link to share this version."); }
    catch { status("Browser storage is unavailable. Copy a mixtape link to keep your selection."); }
    $("#tape-share").hidden = true;
  }
  function render() {
    $(".tape-sleeve").dataset.color = tape.color;
    $("#tape-title").textContent = tape.name || "My Tony C mixtape";
    document.title = `${tape.name || "My Tony C mixtape"} · Mixtapes · yehry3`;
    const count = tape.a.length + tape.b.length;
    $("#tape-total").textContent = `${count} ${count === 1 ? "track" : "tracks"} · ${tapeDuration([...tape.a, ...tape.b], catalog)}`;
    $("#play-tape").disabled = ![...tape.a, ...tape.b].some(id => safeAudio(catalog.get(id)));
    $("#share-tape").disabled = !tape.a.length && !tape.b.length;
    $("#tape-sides").innerHTML = ["a", "b"].map(side => `<section class="tape-side" data-side="${side}"><div class="section-heading"><h2>Side ${side.toUpperCase()}</h2><span class="small">${tapeDuration(tape[side], catalog)}</span></div><button class="quiet" data-side-play="${side}" ${tape[side].some(id => safeAudio(catalog.get(id))) ? "" : "disabled"}>Play side ${side.toUpperCase()}</button><ol>${tape[side].map((id, index) => {
      const song = catalog.get(id), label = escape(song?.title || "Song unavailable");
      return `<li class="tape-track" data-index="${index}" ${shared ? "" : 'draggable="true"'}><div><strong>${label}</strong>${song ? qualityNotice(song.qualityIssues) : '<p class="small">This song is not currently in the catalog.</p>'}${song?.hasLyrics || song?.lyrics?.text ? `<a class="text-link" href="${lyricsHref(song)}">Lyrics ↗</a>` : ""}</div>${shared ? "" : `<div class="tape-moves"><button class="quiet" data-move="up" aria-label="Move ${label} up" ${index ? "" : "disabled"}>↑</button><button class="quiet" data-move="down" aria-label="Move ${label} down" ${index < tape[side].length - 1 ? "" : "disabled"}>↓</button><button class="quiet" data-move="side" aria-label="Move ${label} to side ${side === "a" ? "B" : "A"}">To ${side === "a" ? "B" : "A"}</button><button class="quiet" data-move="remove" aria-label="Remove ${label}">×</button></div>`}</li>`;
    }).join("")}</ol>${tape[side].length ? "" : '<p class="small">An open side. Add a few favorites.</p>'}</section>`).join("");
  }
  function renderCatalog() {
    const query = $("#tape-search").value.trim().toLocaleLowerCase();
    const songs = [...catalog.values()].filter(song => song.title.toLocaleLowerCase().includes(query));
    $("#tape-catalog").innerHTML = songs.length ? songs.map(song => `<div class="tape-pick"><span>${escape(song.title)}</span><div><button class="quiet" data-add="${escape(song.id)}" data-to="a" aria-label="Add ${escape(song.title)} to side A">+ A</button><button class="quiet" data-add="${escape(song.id)}" data-to="b" aria-label="Add ${escape(song.title)} to side B">+ B</button></div></div>`).join("") : '<p class="small">No songs match that title.</p>';
  }
  function changed() { save(); render(); }
  $("#tape-name").value = tape.name;
  $("#tape-color").value = tape.color;
  $("#tape-name").oninput = event => { tape.name = event.target.value; changed(); };
  $("#tape-color").onchange = event => { tape.color = event.target.value; changed(); };
  $("#tape-search").oninput = renderCatalog;
  $("#tape-catalog").onclick = event => {
    const button = event.target.closest("[data-add]");
    if (!button || shared) return;
    if (tape.a.length + tape.b.length >= 40) return status("This tape has 40 tracks. Remove one before adding another.");
    tape[button.dataset.to].push(button.dataset.add); changed();
  };
  $("#tape-sides").onclick = event => {
    const sidePlay = event.target.closest("[data-side-play]");
    if (sidePlay) return start(tape[sidePlay.dataset.sidePlay]);
    const button = event.target.closest("[data-move]");
    if (!button || shared) return;
    const side = button.closest("[data-side]").dataset.side, index = Number(button.closest("[data-index]").dataset.index);
    const action = button.dataset.move;
    const focusTarget = Math.max(0, action === "up" ? index - 1 : action === "down" ? index + 1 : index);
    const [id] = tape[side].splice(index, 1);
    if (action === "side") tape[side === "a" ? "b" : "a"].push(id);
    else if (action !== "remove") tape[side].splice(focusTarget, 0, id);
    changed();
    $(`[data-side="${side}"] [data-index="${Math.min(focusTarget, tape[side].length - 1)}"] [data-move="${action}"]`)?.focus();
  };
  let dragged;
  $("#tape-sides").ondragstart = event => {
    const row = event.target.closest("[data-index]");
    if (!row || shared) return;
    dragged = { side: row.closest("[data-side]").dataset.side, index: Number(row.dataset.index) };
    event.dataTransfer.setData("text/plain", "mixtape-track");
  };
  $("#tape-sides").ondragover = event => { if (dragged && event.target.closest("[data-side]")) event.preventDefault(); };
  $("#tape-sides").ondrop = event => {
    const target = event.target.closest("[data-side]");
    if (!dragged || !target || shared) return;
    event.preventDefault();
    const side = target.dataset.side, row = event.target.closest("[data-index]");
    let index = row ? Number(row.dataset.index) : tape[side].length;
    if (side === dragged.side && index > dragged.index) index--;
    const [id] = tape[dragged.side].splice(dragged.index, 1);
    tape[side].splice(index, 0, id); dragged = null; changed();
  };
  $("#tape-sides").ondragend = () => { dragged = null; };
  async function play(index) {
    if (!queue[index]) return;
    position = index;
    $(".player").hidden = false;
    $("#tape-now").textContent = queue[index].title;
    $("#tape-prev").disabled = index === 0;
    $("#tape-next").disabled = index === queue.length - 1;
    audio.src = safeAudio(queue[index]);
    try { await audio.play(); } catch { status("Press play in the player to start this song."); }
  }
  function start(ids) { queue = ids.map(id => catalog.get(id)).filter(song => safeAudio(song)); if (queue.length) play(0); }
  $("#play-tape").onclick = () => start([...tape.a, ...tape.b]);
  $("#tape-prev").onclick = () => play(position - 1);
  $("#tape-next").onclick = () => play(position + 1);
  audio.onended = () => play(position + 1);
  audio.onerror = () => status("This recording could not play. Try the next song or retry when it reconnects.");
  $("#share-tape").onclick = async () => {
    const url = new URL("/mixtapes/", location.origin); url.hash = `tape=${encodeTape(tape)}`;
    $("#tape-link").value = url.href; $("#tape-share").hidden = false;
    try { await navigator.clipboard.writeText(url.href); status("Mixtape link copied. It keeps this name, sleeve and track order."); }
    catch { $("#tape-link").focus(); $("#tape-link").select(); status("Copy the selected link to share your mixtape."); }
  };
  $("#edit-tape")?.addEventListener("click", () => {
    shared = false; history.replaceState(null, "", location.pathname);
    $(".tape-edit").hidden = false; $(".tape-picker").hidden = false; $("#edit-tape").remove(); changed();
  });
  render();
  try {
    // The independent static read keeps saved tapes usable during API outages.
    let loaded = false;
    const update = data => {
      if (!Array.isArray(data?.songs) || !data.songs.length) return;
      catalog = new Map(data.songs.map(song => [song.id, song])); loaded = true; render(); renderCatalog();
    };
    const live = publicApi("/songs/summary").then(data => { update(data); return true; }).catch(() => false);
    const fallback = fetch("/catalog-summary.json").then(response => response.json()).then(data => { if (!loaded) update(data); });
    await Promise.allSettled([live, fallback]);
    if (!loaded) { $("#tape-catalog").textContent = "The collection could not load. Reload to try again."; status("Your selection is still here. The song catalog is temporarily unavailable."); }
  } catch { status("The collection could not load. Reload to try again."); }
}
