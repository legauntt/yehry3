// Œuful: the cover art easter egg, left running. Two turntables take turns: one record plays a
// sung moment while the next waits, cued, on the other deck. When a side ends the other deck
// comes in over it: the old record plays on, fading, while the new one swells up to its moment.
// Then the spent record lifts off and another drops into its place. The picture, the gasp and
// the comic caption are the egg's own (badge-sound.js, egg-caption.js).
import { shock } from "../assets/badge-sound.js";
import { songArtwork } from "../assets/song-art.js";
import { lyricsHref } from "../assets/song-links.js";
import { api } from "../assets/api.js";
import { createPicker } from "./crate.js";

// One record plays and `ahead` more are cued behind it, each on its own audio element that is
// already loading its moment. The elements are made once and reused: a phone only lets a sound
// start by itself on an element the listener has already started by hand.
const ahead = 4;
const seekSlack = 0.1, tick = 40;
// Records overlap by `blend` seconds. The songs come from another origin without leave to mix
// them, so the crossfade is two volume sliders. An iPhone ignores those, and there an overlap
// would only be two songs at once, so its decks cut straight across instead.
const probe = new Audio();
probe.volume = 0.5;
const blend = probe.volume === 0.5 ? 1.5 : 0;
// A side that never starts is skipped. A record that will not load is swapped for another, a
// little more slowly each time, so a dead connection is not hammered.
const patience = 15000, retryMs = [1500, 4000, 10000, 30000];
const ejectMs = 450, artWait = 2000;

const $ = (id) => document.getElementById(id);
const booth = $("booth"), art = $("art"), now = $("now"), mixer = $("mixer");
const startButton = $("start"), skipButton = $("skip"), volumeInput = $("volume");

const decks = Object.fromEntries([...document.querySelectorAll(".deck")].map((element) => {
  element.innerHTML = '<div class="platter"><div class="record"><div class="record-spin"><img class="record-label" alt="" width="240" height="200" decoding="async"></div></div><i class="spindle"></i></div>'
    + '<div class="tonearm"><i class="tonearm-weight"></i><i class="tonearm-head"></i></div><i class="deck-led"></i><b class="deck-name">' + element.dataset.deck + '</b><p class="deck-title"></p>';
  const deck = { name: element.dataset.deck, element, record: element.querySelector(".record"), label: element.querySelector(".record-label"), title: element.querySelector(".deck-title"), slice: null };
  deck.record.addEventListener("animationend", () => deck.record.classList.remove("is-arriving"));
  return [deck.name, deck];
}));
const other = (deck) => (deck === decks.A ? decks.B : decks.A);
const setDeck = (deck, state) => { deck.element.dataset.state = state; };

const idle = Array.from({ length: ahead + 1 }, () => new Audio());
let pick = () => null;
let songs = new Map();
let crate = [];
let current = null;
let leaving = null;
let wanted = false;
let live = decks.A;
let level = Number(volumeInput.value);
let sides = 0;
let failures = 0;
let refill = null;

// --- The crate: records cued and loading ---

function cueSlice(audio) {
  const moment = pick();
  if (!moment) return null;
  const abort = new AbortController(), { signal } = abort;
  // Live votes and listener redraws make the picture match the one in the collection.
  // A record is cued ahead of its moment, so it has room to fade in before the words arrive.
  const from = Math.max(0, moment.start - blend);
  const slice = { moment, from, audio, abort, ready: false, heard: false, deck: null, art: songArtwork(songs.get(moment.id) ?? { id: moment.id, title: moment.title }) };
  audio.preload = "auto";
  audio.muted = false;
  audio.src = moment.url;
  // Browsers differ on when a seek is honoured, so ask now and again once the length is known.
  const seek = () => { if (audio.currentTime < from) audio.currentTime = from; };
  audio.addEventListener("loadedmetadata", seek, { signal });
  const check = () => {
    if (slice.ready || audio.seeking || audio.readyState < 3 || audio.currentTime < from - seekSlack) return;
    slice.ready = true;
    failures = 0;
    drawCrate();
  };
  for (const event of ["loadeddata", "canplay", "canplaythrough", "seeked"]) audio.addEventListener(event, check, { signal });
  audio.addEventListener("error", () => drop(slice), { signal });
  return slice;
}

function fill() {
  clearTimeout(refill);
  refill = null;
  while (idle.length) {
    const slice = cueSlice(idle[idle.length - 1]);
    if (!slice) break;
    idle.pop();
    crate.push(slice);
  }
  dress();
  drawCrate();
  if (wanted && !current && crate.length) advance();
}

function recycle(slice) {
  slice.abort.abort();
  clearInterval(slice.watch);
  clearTimeout(slice.patience);
  slice.audio.pause();
  slice.audio.removeAttribute("src");
  slice.audio.load();
  idle.push(slice.audio);
}

// A record that will not load leaves the crate, and its deck if it had reached one.
function drop(slice) {
  const playing = slice === current;
  if (playing) {
    current = null;
    calm(slice);
  }
  if (slice === leaving) leaving = null;
  crate = crate.filter((cued) => cued !== slice);
  if (slice.deck) {
    slice.deck.slice = null;
    setDeck(slice.deck, "empty");
  }
  recycle(slice);
  const wait = retryMs[Math.min(failures++, retryMs.length - 1)];
  refill ??= setTimeout(fill, wait);
  dress();
  drawCrate();
  if (playing && wanted) advance();
}

// --- The decks ---

function place(slice, deck) {
  if (deck.slice === slice) return;
  if (deck.slice) deck.slice.deck = null;
  if (slice.deck) {
    slice.deck.slice = null;
    setDeck(slice.deck, "empty");
  }
  deck.slice = slice;
  slice.deck = deck;
  deck.label.setAttribute("src", slice.art.src);
  deck.title.textContent = slice.moment.title;
  deck.record.classList.remove("is-arriving");
  void deck.record.offsetWidth;
  deck.record.classList.add("is-arriving");
  setDeck(deck, "cued");
}

// The next record waits on whichever deck is free. Before anything plays, the first two
// records take a deck each, so the booth opens fully dressed.
function dress() {
  const free = current ? [other(current.deck)] : [live, other(live)];
  free.forEach((deck, index) => {
    const slice = crate[index];
    if (slice && !["leaving", "ejecting"].includes(deck.element.dataset.state)) place(slice, deck);
  });
}

function eject(slice) {
  if (slice === leaving) leaving = null;
  clearInterval(slice.watch);
  slice.audio.pause();
  const deck = slice.deck;
  if (!deck) {
    recycle(slice);
    return fill();
  }
  deck.element.classList.remove("is-stalled");
  setDeck(deck, "ejecting");
  setTimeout(() => {
    if (deck.slice === slice) {
      deck.slice = null;
      deck.title.textContent = "";
      setDeck(deck, "empty");
    }
    slice.deck = null;
    recycle(slice);
    fill();
  }, ejectMs);
}

// --- Playing a side ---

// A record comes in by where its needle is, so its words always arrive at full volume. It goes
// out by the clock, so one that stalls still leaves. Sine and cosine keep the pair evenly loud.
function mix(slice) {
  const { audio, moment, from } = slice;
  let gain = 1;
  if (slice === leaving) gain = slice.leftGain * Math.cos(Math.min(1, (performance.now() - slice.leftAt) / (blend * 1000)) * Math.PI / 2);
  else if (moment.start - from > seekSlack) gain = Math.sin(Math.min(1, Math.max(0, (audio.currentTime - from) / (moment.start - from))) * Math.PI / 2);
  slice.gain = Math.min(1, Math.max(0, gain));
  audio.volume = level * slice.gain;
}

function step(slice) {
  if (slice === leaving) {
    if (performance.now() - slice.leftAt >= blend * 1000) eject(slice);
    else mix(slice);
  } else if (slice === current) {
    if (slice.audio.currentTime >= slice.moment.end) finish(slice);
    else mix(slice);
  }
}

// The gasp and caption end with the moment, not with the sound, which now plays on past it.
const calm = (slice) => {
  slice.calm?.();
  slice.calm = null;
};

// A record rolls as soon as its sound does: it turns, and the crossfader slides over to it. The
// side itself only counts as started once the sound has reached the moment, so a slow seek never
// lets the picture and caption run ahead of it. Both can happen again after the needle is lifted.
function begin(slice) {
  const { audio, moment, deck } = slice;
  if (slice !== current || !wanted || !slice.running || audio.currentTime < slice.from - seekSlack) return;
  if (!slice.rolling) {
    slice.rolling = true;
    clearTimeout(slice.patience);
    art.classList.remove("egg-loading");
    deck.element.style.setProperty("--side-ms", Math.max(200, (moment.end + blend - audio.currentTime) * 1000) + "ms");
    setDeck(deck, "playing");
    mixer.dataset.live = deck.name;
    booth.dataset.state = "mixing";
  }
  if (slice.heard || audio.currentTime < moment.start - seekSlack) return;
  slice.heard = true;
  const ms = Math.max(200, (moment.end - audio.currentTime) * 1000);
  booth.dataset.state = "playing";
  slice.calm = shock(art, ms, audio, { title: moment.title, lines: moment.lines });
  if (!slice.counted) {
    slice.counted = true;
    sides += 1;
    $("tally").textContent = sides + (sides === 1 ? " side played" : " sides played");
  }
}

function spin(slice) {
  const { audio, moment, deck } = slice;
  current = slice;
  live = deck;
  audio.muted = false;
  mix(slice);
  slice.heard = slice.rolling = false;
  art.setAttribute("src", slice.art.src);
  art.setAttribute("alt", slice.art.alt);
  art.classList.add("egg-loading");
  booth.dataset.state = "cueing";
  const link = document.createElement("a");
  link.href = lyricsHref(moment);
  link.textContent = moment.title;
  now.replaceChildren("Now spinning: ", link);
  if ("mediaSession" in navigator) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: moment.title, artist: "Œuful · yehry3" }); } catch { /* The booth plays on without it. */ }
  }
  if (!slice.wired) {
    slice.wired = true;
    const { signal } = slice.abort;
    const stalled = (on) => () => deck.element.classList.toggle("is-stalled", on && slice === current);
    audio.addEventListener("playing", () => { slice.running = true; }, { signal });
    audio.addEventListener("pause", () => { slice.running = false; }, { signal });
    for (const event of ["playing", "timeupdate", "seeked"]) audio.addEventListener(event, () => { begin(slice); step(slice); }, { signal });
    audio.addEventListener("waiting", stalled(true), { signal });
    audio.addEventListener("playing", stalled(false), { signal });
    audio.addEventListener("ended", () => (slice === leaving ? eject(slice) : finish(slice)), { signal });
    // The timer is throttled in a background tab; the audio's own events above keep time there.
    slice.watch = setInterval(() => step(slice), tick);
  }
  clearTimeout(slice.patience);
  slice.patience = setTimeout(() => finish(slice), patience);
  if (audio.currentTime < slice.from) audio.currentTime = slice.from;
  audio.play().catch((error) => {
    // A browser that refuses to start sound by itself hands the needle back to the listener.
    if (error?.name === "NotAllowedError" && slice === current) halt();
  });
}

// A side is over when its moment is, or when the listener skips it. The record plays on, fading,
// while the other deck comes in over it; one that never made a sound just lifts off.
function finish(slice) {
  if (slice !== current) return;
  current = null;
  clearTimeout(slice.patience);
  calm(slice);
  // Only two records sound at once: one still fading from the hand-over before makes way.
  if (leaving) eject(leaving);
  if (wanted && blend && slice.running) {
    leaving = slice;
    slice.leftAt = performance.now();
    slice.leftGain = slice.gain ?? 1;
    setDeck(slice.deck, "leaving");
  } else eject(slice);
  if (wanted) advance();
}

// The other deck takes over. A record that has finished loading goes ahead of one that has not.
function advance() {
  if (current) return;
  const ready = crate.findIndex((slice) => slice.ready);
  const [slice] = crate.splice(Math.max(ready, 0), 1);
  if (!slice) {
    art.classList.remove("egg-loading");
    now.textContent = "Digging through the crate…";
    booth.dataset.state = "waiting";
    if (!refill && idle.length) fill();
    return;
  }
  // A record that jumped the queue takes the deck that is not busy with the last one.
  if (!slice.deck) place(slice, live.slice || live.element.dataset.state === "ejecting" ? other(live) : live);
  spin(slice);
  dress();
  drawCrate();
}

// --- The listener's controls ---

function showWanted() {
  startButton.textContent = wanted ? "Lift the needle" : "Drop the needle";
  startButton.setAttribute("aria-pressed", String(wanted));
  skipButton.disabled = !wanted;
  if (!wanted) booth.dataset.state = "idle";
}

// The first press is the listener's blessing, so every cued element is started under it (muted,
// and stopped again at once). After that the booth may start each of them by itself.
let blessed = false;
function bless() {
  if (blessed) return;
  blessed = true;
  for (const slice of crate) {
    const { audio } = slice;
    audio.muted = true;
    audio.play().then(() => { if (slice !== current) audio.pause(); }).catch(() => {}).finally(() => {
      audio.muted = false;
      if (slice !== current && audio.src && audio.currentTime > slice.from) audio.currentTime = slice.from;
    });
  }
}

function start() {
  if (wanted || startButton.disabled) return;
  wanted = true;
  showWanted();
  bless();
  if (current) spin(current);
  else advance();
}

function halt() {
  if (!wanted) return;
  wanted = false;
  showWanted();
  if (leaving) eject(leaving);
  if (!current) return;
  clearTimeout(current.patience);
  // Pausing sends one last timeupdate, which must not be mistaken for the side starting.
  current.running = false;
  current.audio.pause();
  current.heard = current.rolling = false;
  art.classList.remove("egg-loading");
  setDeck(current.deck, "cued");
}

function skip() {
  if (!wanted) return;
  if (current) finish(current);
  else advance();
}

function drawCrate() {
  const slots = $("crate");
  if (slots.children.length !== ahead) slots.replaceChildren(...Array.from({ length: ahead }, () => document.createElement("i")));
  const cued = crate.filter((slice) => slice.ready).length;
  [...slots.children].forEach((slot, index) => {
    slot.className = crate[index] ? (crate[index].ready ? "is-ready" : "is-loading") : "";
  });
  const words = "Crate: " + cued + " cued" + (crate.length > cued ? ", " + (crate.length - cued) + " loading" : "");
  slots.setAttribute("aria-label", words);
  $("crate-text").textContent = words;
}

startButton.addEventListener("click", () => (wanted ? halt() : start()));
skipButton.addEventListener("click", skip);
volumeInput.addEventListener("input", () => {
  level = Number(volumeInput.value);
  for (const slice of [current, leaving]) if (slice) mix(slice);
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

// The clips are built with the site. Live votes and redraws only shape the pictures, so they
// get a short head start and are never waited on after that.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = api("/songs/summary", { timeout: 5000 })
  .then((data) => { if (Array.isArray(data?.songs)) songs = new Map(data.songs.map((song) => [song.id, song])); })
  .catch(() => {});
const clips = fetch("/egg-clips.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.statusText))))
  .then((data) => (Array.isArray(data?.clips) ? data.clips : []));
try {
  const [found] = await Promise.all([clips, Promise.race([summary, wait(artWait)])]);
  pick = createPicker(found);
  if (!found.length) throw new Error("No clips");
  fill();
  if (blend) mixer.style.setProperty("--blend-ms", blend * 1000 + "ms");
  booth.dataset.state = "idle";
  now.textContent = "The crate is packed. Drop the needle.";
  startButton.disabled = false;
} catch {
  pick = () => null;
  now.textContent = "The crate would not open. Try again in a moment.";
  booth.dataset.state = "idle";
}
