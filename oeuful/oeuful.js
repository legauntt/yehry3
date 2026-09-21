// Œuful: the cover art easter egg, left running. Two to five turntables take turns: one record
// plays a sung moment while the next waits, cued, on another deck. When a side nears its end the
// next deck comes in over it: the old record plays on, fading, while the new one swells up to its
// moment. Then the spent record lifts off and another drops into its place. Each deck cuts its
// records to its own length and has its own volume; the Overlap slider brings the next record in
// early, so two or more sing at once, and a deck can be set to play whole songs. The picture, the gasp and the comic caption are the egg's
// own (badge-sound.js, egg-caption.js), and follow the newest record that is singing.
import { shock } from "../assets/badge-sound.js";
import { songArtwork } from "../assets/song-art.js";
import { lyricsHref } from "../assets/song-links.js";
import { api } from "../assets/api.js";
import { crateWeight, createPicker, wholeSong } from "./crate.js";

// Each turntable keeps three sounds of its own: the record that is playing and two more, cut and
// already loading, behind it. They are made once and reused: a phone only lets a sound start by
// itself on an element the listener has already started by hand.
const perDeck = 3, fewestDecks = 2, mostDecks = 5, deckNames = "ABCDE";
const seekSlack = 0.1, tick = 40;
// Records overlap by at least `blend` seconds. The songs come from another origin without leave
// to mix them, so the crossfade is a volume slider each. An iPhone ignores those, and there a
// fade would only be two songs at once, so its decks cut straight across instead.
const probe = new Audio();
probe.volume = 0.5;
const blend = probe.volume === 0.5 ? 1.5 : 0;
// A side that never starts is skipped. A record that will not load is swapped for another, a
// little more slowly each time, so a dead connection is not hammered.
const patience = 15000, retryMs = [1500, 4000, 10000, 30000];
const ejectMs = 450, artWait = 2000;
// How long a side may run, in seconds, for each stop of a deck's Side slider.
const sideLengths = [3, 5, 8, 13, 20, 30, 45, 60], usualSide = 3, boothKey = "oeuful:booth";

const $ = (id) => document.getElementById(id);
const booth = $("booth"), stage = $("stage"), art = $("art"), now = $("now"), mixer = $("mixer");
const startButton = $("start"), skipButton = $("skip"), volumeInput = $("volume"), overlapInput = $("overlap");
const fewerButton = $("fewer"), moreButton = $("more");
const setDeck = (deck, state) => { deck.element.dataset.state = state; };
const clamp = (value) => Math.min(1, Math.max(0, value));

const decks = [];
let pick = () => null;
let songs = new Map();
let sounding = []; // Records that have been started, oldest first, until they lift off.
let onAir = []; // Those of them whose moment is sounding now.
let shown = null; // The one whose picture and caption are up.
let head = null; // The newest record, until it calls for the next one.
let due = false; // The next record has been called for.
let turn = 0; // Whose turn it is.
let wanted = false;
let level = Number(volumeInput.value);
let overlap = 0;
let sides = 0;
let failures = 0;
let refill = null;
let filling = false;

// --- The turntables ---

function save() {
  const kept = { overlap: Number(overlapInput.value), decks: decks.map((deck) => ({ side: Number(deck.side.value), level: deck.level, muted: deck.muted, whole: deck.whole })) };
  try { localStorage.setItem(boothKey, JSON.stringify(kept)); } catch { /* The settings just last for this visit. */ }
}

function showDeck(deck) {
  deck.seconds = sideLengths[Number(deck.side.value)] ?? deck.seconds;
  deck.sideText.textContent = deck.whole ? "Full" : deck.seconds + " s";
  deck.side.setAttribute("aria-valuetext", "Sides of up to " + deck.seconds + " seconds");
  deck.side.disabled = deck.whole;
  deck.full.setAttribute("aria-pressed", String(deck.whole));
  deck.level = clamp(Number(deck.dial.value));
  deck.dial.parentElement.style.setProperty("--turn", String(deck.level));
  deck.dialText.textContent = Math.round(deck.level * 100) + "%";
  deck.dial.setAttribute("aria-valuetext", deck.dialText.textContent);
  deck.mute.setAttribute("aria-pressed", String(deck.muted));
  deck.element.classList.toggle("is-muted", deck.muted);
}

function addDeck({ side = usualSide, level: loud = 1, muted = false, whole = false } = {}) {
  const name = deckNames[decks.length], id = "deck-" + name.toLowerCase();
  let element = $(id);
  if (!element) {
    element = document.createElement("div");
    element.className = "deck";
    element.id = id;
    element.dataset.deck = name;
    stage.append(element);
  }
  element.dataset.state = "empty";
  element.innerHTML = '<div class="deck-body"><div class="platter"><div class="record"><div class="record-spin"><img class="record-label" alt="" width="240" height="200" decoding="async"></div></div><i class="spindle"></i></div>'
    + '<div class="tonearm"><i class="tonearm-weight"></i><i class="tonearm-head"></i></div><i class="deck-led"></i><b class="deck-name">' + name + '</b><p class="deck-title"></p></div>'
    + '<div class="deck-controls"><label class="deck-side"><span>Side</span><input type="range" min="0" max="' + (sideLengths.length - 1) + '" step="1" aria-label="Deck ' + name + ' side length"><output></output></label>'
    + '<div class="deck-level"><label class="dial" title="Deck ' + name + ' volume"><input type="range" min="0" max="1" step="0.05" aria-label="Deck ' + name + ' volume"><i></i></label><output></output>'
    + '<button type="button" class="pad pad-small deck-whole" aria-pressed="false" aria-label="Deck ' + name + ' plays whole songs" title="Play the whole song before the next deck comes in">Full</button>'
    + '<button type="button" class="pad pad-small deck-mute" aria-pressed="false" aria-label="Mute deck ' + name + '">Mute</button></div></div>';
  const find = (selector) => element.querySelector(selector);
  const deck = {
    name, element, record: find(".record"), label: find(".record-label"), title: find(".deck-title"),
    side: find(".deck-side input"), sideText: find(".deck-side output"), dial: find(".dial input"), dialText: find(".deck-level output"), full: find(".deck-whole"), mute: find(".deck-mute"),
    seconds: sideLengths[usualSide], level: 1, muted: Boolean(muted), whole: Boolean(whole), slice: null, queue: [], idle: Array.from({ length: perDeck }, () => new Audio()),
  };
  deck.side.value = String(sideLengths[side] ? side : usualSide);
  deck.dial.value = String(clamp(Number(loud)));
  showDeck(deck);
  deck.record.addEventListener("animationend", () => deck.record.classList.remove("is-arriving"));
  deck.side.addEventListener("input", () => showDeck(deck));
  deck.side.addEventListener("change", () => {
    showDeck(deck);
    save();
    recut(deck);
  });
  deck.dial.addEventListener("input", () => {
    showDeck(deck);
    mix();
  });
  deck.dial.addEventListener("change", save);
  deck.full.addEventListener("click", () => {
    deck.whole = !deck.whole;
    showDeck(deck);
    save();
    recut(deck);
  });
  deck.mute.addEventListener("click", () => {
    deck.muted = !deck.muted;
    showDeck(deck);
    mix();
    save();
  });
  decks.push(deck);
  layout();
  return deck;
}

// The last turntable leaves with everything on it.
function removeDeck() {
  if (decks.length <= fewestDecks) return;
  const deck = decks.pop();
  deck.removed = true;
  for (const slice of sounding.filter((playing) => playing.deck === deck)) eject(slice);
  for (const slice of deck.queue.splice(0)) recycle(slice);
  deck.element.remove();
  turn %= decks.length;
  layout();
  fill();
}

// The crossfader runs from the first deck to the last, and rests on the newest record's.
function slide(deck) {
  mixer.dataset.live = deck.name;
  mixer.style.setProperty("--xf", 8 + 84 * (decks.indexOf(deck) / Math.max(1, decks.length - 1)) + "%");
}

function layout() {
  stage.dataset.decks = String(decks.length);
  $("tables-text").textContent = String(decks.length);
  $("xfader-end").textContent = decks.at(-1).name;
  fewerButton.disabled = decks.length <= fewestDecks;
  moreButton.disabled = decks.length >= mostDecks;
  slide(decks.find((deck) => deck.name === mixer.dataset.live) ?? decks[0]);
}

// --- The crate: records cut for a deck, cued and loading ---

function cueSlice(deck) {
  const whole = deck.whole, moment = deck.idle.length ? pick(whole ? wholeSong : deck.seconds) : null;
  if (!moment) return null;
  // A whole song starts at its first note, not its first word, and ends where the sound does.
  if (whole) moment.start = 0;
  const audio = deck.idle.pop();
  const abort = new AbortController(), { signal } = abort;
  // A record is cued ahead of its moment, so it has room to fade in before the words arrive.
  const from = Math.max(0, moment.start - blend);
  // Where it reaches full volume: at its words, or, for a whole song, a blend into its opening.
  const full = whole ? blend : moment.start;
  // Live votes and listener redraws make the picture match the one in the collection.
  const slice = { moment, from, full, whole, audio, deck, abort, ready: false, art: songArtwork(songs.get(moment.id) ?? { id: moment.id, title: moment.title }) };
  audio.preload = "auto";
  audio.muted = false;
  audio.src = moment.url;
  // Browsers differ on when a seek is honoured, so ask now and again once the length is known.
  const seek = () => { if (audio.currentTime < from) audio.currentTime = from; };
  audio.addEventListener("loadedmetadata", seek, { signal });
  if (whole) audio.addEventListener("loadedmetadata", () => { if (Number.isFinite(audio.duration)) moment.end = audio.duration; }, { signal });
  const check = () => {
    if (slice.ready || audio.seeking || audio.readyState < 3 || audio.currentTime < from - seekSlack) return;
    slice.ready = true;
    failures = 0;
    drawCrate();
    // It may be the record the booth is waiting for.
    advance();
  };
  for (const event of ["loadeddata", "canplay", "canplaythrough", "seeked"]) audio.addEventListener(event, check, { signal });
  audio.addEventListener("error", () => drop(slice), { signal });
  return slice;
}

function fill() {
  clearTimeout(refill);
  refill = null;
  for (const deck of decks) {
    for (let slice = cueSlice(deck); slice; slice = cueSlice(deck)) deck.queue.push(slice);
  }
  filling = true;
  dress();
  drawCrate();
  advance();
  filling = false;
}

function recycle(slice) {
  slice.gone = true;
  slice.abort.abort();
  clearTimeout(slice.patience);
  slice.audio.pause();
  slice.audio.removeAttribute("src");
  slice.audio.load();
  slice.deck.idle.push(slice.audio);
}

// A record leaves the booth's books: it is no longer sounding, waiting, or owed a successor.
function retire(slice) {
  slice.sounding = slice.leaving = slice.running = false;
  clearTimeout(slice.patience);
  sounding = sounding.filter((other) => other !== slice);
  onAir = onAir.filter((other) => other !== slice);
  slice.deck.queue = slice.deck.queue.filter((other) => other !== slice);
  if (slice === head) {
    head = null;
    due = true;
  }
}

function clearPlatter(deck) {
  deck.slice = null;
  deck.title.textContent = "";
  deck.element.classList.remove("is-stalled");
  setDeck(deck, "empty");
}

// A record that will not load leaves the crate, and its deck if it had reached one.
function drop(slice) {
  retire(slice);
  if (slice.deck.slice === slice) clearPlatter(slice.deck);
  recycle(slice);
  const wait = retryMs[Math.min(failures++, retryMs.length - 1)];
  refill ??= setTimeout(fill, wait);
  show();
  dress();
  drawCrate();
  advance();
}

// A deck's records were cut to its old length, so they go back and it is dressed again. The
// record that is playing finishes as it was.
function recut(deck) {
  for (const slice of deck.queue.splice(0)) {
    if (deck.slice === slice) clearPlatter(deck);
    recycle(slice);
  }
  fill();
}

function place(deck, slice) {
  deck.slice = slice;
  deck.label.setAttribute("src", slice.art.src);
  deck.title.textContent = slice.moment.title;
  deck.record.classList.remove("is-arriving");
  void deck.record.offsetWidth;
  deck.record.classList.add("is-arriving");
  setDeck(deck, "cued");
}

// The next record waits on its deck's platter as soon as that is free. One that has finished
// loading goes ahead of one that has not.
function dress() {
  for (const deck of decks) {
    const { queue } = deck;
    if (!queue.length || (deck.slice && deck.slice !== queue[0])) continue;
    const ready = queue[0].ready ? 0 : queue.findIndex((slice) => slice.ready);
    if (ready > 0) queue.unshift(...queue.splice(ready, 1));
    if (deck.slice !== queue[0]) place(deck, queue[0]);
  }
}

function eject(slice) {
  const deck = slice.deck;
  retire(slice);
  slice.audio.pause();
  show();
  mood();
  if (deck.removed || deck.slice !== slice) {
    recycle(slice);
    return fill();
  }
  deck.element.classList.remove("is-stalled");
  setDeck(deck, "ejecting");
  setTimeout(() => {
    if (deck.slice === slice) clearPlatter(deck);
    recycle(slice);
    fill();
  }, ejectMs);
}

// --- The sound ---

// A record comes in by where its needle is, so its words always arrive at full volume. It goes
// out by the clock, so one that stalls still leaves. Sine and cosine keep a crossing pair evenly
// loud; when more than that sing together, everyone is turned down to make the same room.
function swell(slice) {
  const { audio, from, full } = slice;
  if (slice.leaving) return slice.leftGain * Math.cos(clamp((performance.now() - slice.leftAt) / (blend * 1000)) * Math.PI / 2);
  if (full - from <= seekSlack) return 1;
  return Math.sin(clamp((audio.currentTime - from) / (full - from)) * Math.PI / 2);
}

function mix() {
  let power = 0;
  for (const slice of sounding) {
    slice.loud = swell(slice) * (slice.deck.muted ? 0 : slice.deck.level);
    if (slice.running) power += slice.loud ** 2;
  }
  const room = 1 / Math.sqrt(Math.max(1, power));
  for (const slice of sounding) slice.audio.volume = clamp(level * slice.loud * room);
}

// --- The picture ---

function picture(slice) {
  art.setAttribute("src", slice.art.src);
  art.setAttribute("alt", slice.art.alt);
  const link = document.createElement("a");
  link.href = lyricsHref(slice.moment);
  link.textContent = slice.moment.title;
  now.replaceChildren("Now spinning: ", link);
  if ("mediaSession" in navigator) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: slice.moment.title, artist: "Œuful · yehry3" }); } catch { /* The booth plays on without it. */ }
  }
}

// The gasp and caption belong to the newest record that is singing. When it stops, an older one
// that is still going gets them back. They end with the moment, not with the sound, which
// plays on past it.
function show() {
  const top = onAir.at(-1) ?? null;
  if (top === shown) return;
  if (shown) {
    shown.calm?.();
    shown.calm = null;
  }
  shown = top;
  if (!top) return;
  art.classList.remove("egg-loading");
  picture(top);
  const ms = Math.max(200, (top.moment.end - top.audio.currentTime) * 1000);
  top.calm = shock(art, ms, top.audio, { title: top.moment.title, lines: top.moment.lines });
}

function mood() {
  booth.dataset.state = !wanted ? "idle" : onAir.length ? "playing" : sounding.some((slice) => slice.rolling) ? "mixing" : sounding.length ? "cueing" : "waiting";
}

// --- Playing a side ---

// A record rolls as soon as its sound does: it turns, and the crossfader slides over to it. The
// side itself only counts as started once the sound has reached the moment, so a slow seek never
// lets the picture and caption run ahead of it. Both can happen again after the needle is lifted.
function begin(slice) {
  const { audio, moment, deck } = slice;
  if (!wanted || audio.currentTime < slice.from - seekSlack) return;
  if (!slice.rolling) {
    slice.rolling = true;
    clearTimeout(slice.patience);
    art.classList.remove("egg-loading");
    deck.element.style.setProperty("--side-ms", Math.max(200, (moment.end + blend - audio.currentTime) * 1000) + "ms");
    setDeck(deck, "playing");
    slide(deck);
    if (!onAir.length) picture(slice);
    mood();
  }
  if (slice.heard || audio.currentTime < moment.start - seekSlack) return;
  slice.heard = true;
  onAir.push(slice);
  show();
  mood();
  if (!slice.counted) {
    slice.counted = true;
    sides += 1;
    $("tally").textContent = sides + (sides === 1 ? " side played" : " sides played");
  }
}

// With no overlap the next record is called for as the moment ends; with more, that much sooner.
// A whole song has nothing to play on past its end, so its successor comes in over its last notes.
function step(slice) {
  if (slice.leaving) {
    if (performance.now() - slice.leftAt >= blend * 1000) eject(slice);
    return;
  }
  if (!slice.sounding || !slice.running) return;
  begin(slice);
  const { moment } = slice, at = slice.audio.currentTime;
  if (slice === head && at >= moment.end - Math.max(overlap * (moment.end - moment.start), slice.whole ? blend : 0)) {
    head = null;
    due = true;
    advance();
  }
  if (at >= moment.end) finish(slice);
}

function pulse() {
  for (const slice of [...sounding]) step(slice);
  mix();
}

function spin(slice) {
  const { audio, deck } = slice;
  if (!slice.sounding) {
    slice.sounding = true;
    sounding.push(slice);
    deck.queue = deck.queue.filter((other) => other !== slice);
    head = slice;
    due = false;
    turn = (decks.indexOf(deck) + 1) % decks.length;
  }
  audio.muted = false;
  slice.heard = slice.rolling = slice.held = false;
  if (!sounding.some((other) => other !== slice && other.running)) {
    picture(slice);
    art.classList.add("egg-loading");
  }
  mix();
  if (!slice.wired) {
    slice.wired = true;
    const { signal } = slice.abort;
    const stalled = (on) => () => deck.element.classList.toggle("is-stalled", on && slice.sounding);
    audio.addEventListener("playing", () => { slice.running = true; }, { signal });
    // A sound the booth did not stop itself (a phone that plays one at a time) counts as over.
    audio.addEventListener("pause", () => {
      slice.running = false;
      if (wanted && !slice.held) finish(slice);
    }, { signal });
    // The timer is throttled in a background tab; the audio's own events keep time there.
    for (const event of ["playing", "timeupdate", "seeked"]) audio.addEventListener(event, pulse, { signal });
    audio.addEventListener("waiting", stalled(true), { signal });
    audio.addEventListener("playing", stalled(false), { signal });
    audio.addEventListener("ended", () => (slice.leaving ? eject(slice) : finish(slice)), { signal });
  }
  clearTimeout(slice.patience);
  slice.patience = setTimeout(() => finish(slice), patience);
  if (audio.currentTime < slice.from) audio.currentTime = slice.from;
  audio.play().catch((error) => {
    // A browser that refuses to start sound by itself hands the needle back to the listener.
    if (error?.name === "NotAllowedError" && slice.sounding) halt();
  });
  mood();
}

// A side is over when its moment is, or when the listener skips it. The record plays on, fading,
// while another deck comes in over it; one that never made a sound just lifts off.
function finish(slice) {
  if (!slice.sounding || slice.leaving) return;
  onAir = onAir.filter((other) => other !== slice);
  if (slice === head) {
    head = null;
    due = true;
  }
  if (wanted && blend && slice.running) {
    slice.leftGain = swell(slice);
    slice.leftAt = performance.now();
    slice.leaving = true;
    clearTimeout(slice.patience);
    setDeck(slice.deck, "leaving");
  } else eject(slice);
  show();
  mood();
  advance();
}

// The decks take turns, but a deck that is still busy is passed over for one that is ready, so
// a long side on one deck never holds up short ones on another.
function advance() {
  if (!wanted || !due) return;
  dress();
  // Only a record still waiting in its deck's queue may start: one that is lifting off is spent.
  const deck = decks.map((_, index) => decks[(turn + index) % decks.length]).find((free) => free.slice && free.slice === free.queue[0] && free.slice.ready);
  if (deck) return spin(deck.slice);
  if (!sounding.length) {
    art.classList.remove("egg-loading");
    now.textContent = "Digging through the crate…";
    if (!filling && !refill && decks.some((free) => free.idle.length)) fill();
  }
  mood();
}

// --- The listener's controls ---

function showWanted() {
  startButton.textContent = wanted ? "Lift the needle" : "Drop the needle";
  startButton.setAttribute("aria-pressed", String(wanted));
  skipButton.disabled = !wanted;
  mood();
}

// A press is the listener's blessing, so every cued sound that has not had one is started under
// it (muted, and stopped again at once). After that the booth may start each of them by itself.
const blessed = new WeakSet();
function bless() {
  for (const slice of decks.flatMap((deck) => deck.queue)) {
    const { audio } = slice;
    if (blessed.has(audio)) continue;
    blessed.add(audio);
    audio.muted = true;
    audio.play().then(() => { if (!slice.sounding && !slice.gone) audio.pause(); }).catch(() => {}).finally(() => {
      if (slice.gone) return;
      audio.muted = false;
      if (!slice.sounding && audio.currentTime > slice.from) audio.currentTime = slice.from;
    });
  }
}

function start() {
  if (wanted || startButton.disabled) return;
  wanted = true;
  showWanted();
  bless();
  // Records that were lifted mid-side pick up where they were.
  for (const slice of [...sounding]) spin(slice);
  if (!sounding.length) due = true;
  advance();
}

function halt() {
  if (!wanted) return;
  wanted = false;
  for (const slice of [...sounding]) {
    if (slice.leaving) {
      eject(slice);
      continue;
    }
    clearTimeout(slice.patience);
    // Pausing sends one last timeupdate, which must not be mistaken for the side starting.
    slice.running = false;
    slice.held = true;
    slice.audio.pause();
    slice.heard = slice.rolling = false;
    slice.deck.element.classList.remove("is-stalled");
    setDeck(slice.deck, "cued");
  }
  onAir = [];
  show();
  art.classList.remove("egg-loading");
  showWanted();
}

// The newest record gives way to the next one.
function skip() {
  if (!wanted) return;
  bless();
  const newest = sounding.filter((slice) => !slice.leaving).at(-1);
  if (newest) finish(newest);
  else due = true;
  advance();
}

function drawCrate() {
  const slots = $("crate"), cut = decks.flatMap((deck) => deck.queue), room = decks.length * perDeck;
  if (slots.children.length !== room) slots.replaceChildren(...Array.from({ length: room }, () => document.createElement("i")));
  const cued = cut.filter((slice) => slice.ready).length;
  [...slots.children].forEach((slot, index) => {
    slot.className = cut[index] ? (cut[index].ready ? "is-ready" : "is-loading") : "";
  });
  const words = "Crate: " + cued + " cued" + (cut.length > cued ? ", " + (cut.length - cued) + " loading" : "");
  slots.setAttribute("aria-label", words);
  $("crate-text").textContent = words;
}

function showOverlap() {
  overlap = clamp(Number(overlapInput.value) / 100);
  $("overlap-text").textContent = Math.round(overlap * 100) + "%";
}

startButton.addEventListener("click", () => (wanted ? halt() : start()));
skipButton.addEventListener("click", skip);
overlapInput.addEventListener("input", showOverlap);
overlapInput.addEventListener("change", save);
volumeInput.addEventListener("input", () => {
  level = Number(volumeInput.value);
  mix();
});
// A new turntable's sounds are cued under the press that asked for it, so they are blessed too.
moreButton.addEventListener("click", () => {
  if (decks.length >= mostDecks) return;
  addDeck();
  save();
  fill();
  if (wanted) bless();
});
fewerButton.addEventListener("click", () => {
  removeDeck();
  save();
});
document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.("input, a, button")) return;
  if (event.key === " ") {
    event.preventDefault();
    if (wanted) halt(); else start();
  } else if (event.key === "n" || event.key === "N" || event.key === "ArrowRight") skip();
});
if ("mediaSession" in navigator) {
  for (const [action, handler] of [["play", start], ["pause", halt], ["nexttrack", skip]]) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Not every browser knows every action. */ }
  }
}
setInterval(pulse, tick);

// The booth opens the way the listener left it: how many decks, each one's length, volume and
// whole songs or not, and the overlap.
let kept = null;
try { kept = JSON.parse(localStorage.getItem(boothKey) || "null"); } catch { /* The booth opens as usual. */ }
const keptDecks = Array.isArray(kept?.decks) ? kept.decks.slice(0, mostDecks) : [];
for (let index = 0; index < Math.max(fewestDecks, keptDecks.length); index += 1) addDeck(keptDecks[index] ?? {});
if (Number.isFinite(kept?.overlap)) overlapInput.value = String(kept.overlap);
showOverlap();
if (blend) mixer.style.setProperty("--blend-ms", blend * 1000 + "ms");

// The clips are built with the site. Live votes, plays and redraws shape the pictures and the
// odds, so they get a short head start and are never waited on after that.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = api("/songs/summary", { timeout: 5000 })
  .then((data) => { if (Array.isArray(data?.songs)) songs = new Map(data.songs.map((song) => [song.id, song])); })
  .catch(() => {});
const clips = fetch("/egg-clips.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.statusText))))
  .then((data) => (Array.isArray(data?.clips) ? data.clips : []));
try {
  const [found] = await Promise.all([clips, Promise.race([summary, wait(artWait)])]);
  if (!found.length) throw new Error("No clips");
  // Live votes and plays decide how often a song comes up; until they arrive every song is equal.
  pick = createPicker(found, { weightOf: (clip) => crateWeight(songs.get(clip.id)) });
  fill();
  now.textContent = "The crate is packed. Drop the needle.";
  startButton.disabled = false;
} catch {
  pick = () => null;
  now.textContent = "The crate would not open. Try again in a moment.";
}
mood();
