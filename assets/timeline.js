import { api } from "./api.js";
import { currentScope } from "./page-scope.js";
import { player } from "./player.js";
import { definePage } from "./shell.js";
import { songCost, songCostLabel } from "./song-cost.js";
import { dayKey, heatLevel, heatWeeks, spend, timelineDays, timelineRows, timelineStats, withWeeks } from "./timeline-data.js";

// Timeline: every release day, newest first, with a calendar strip on top and the quiet stretches folded away.
const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const count = (n) => new Intl.NumberFormat("en-US").format(n);
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
const date = (value, options) => new Intl.DateTimeFormat("en-US", options).format(value);
const clock = (seconds) => Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "";
const songHref = (song) => song.collection === "fearhunger" ? "/fearhunger/" : `/#${encodeURIComponent(song.id)}`;
const dollars = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const spendText = ({ cents, paid }) => paid ? `${dollars(cents)} spent` : "all free";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let scope, songs = [], observer, queue = [];

function relative(day) {
  const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - day.start) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? `${diff} days ago` : "";
}

function stats(days) {
  const s = { ...timelineStats(days), spent: spend(days.flatMap((day) => day.songs), songCost) };
  const busiest = s.busiest ? `${date(s.busiest.start, { month: "short", day: "numeric" })} · ${plural(s.busiest.songs.length, "song")}` : "—";
  $("#timeline-stats").innerHTML = `
    <div class="tl-stat"><strong>${count(s.songs)}</strong><span>songs on the timeline</span></div>
    <div class="tl-stat"><strong>${count(s.activeDays)}<small>/${count(s.days)}</small></strong><span>days with a release</span></div>
    <div class="tl-stat"><strong>${count(s.longest)}</strong><span>longest daily streak</span></div>
    <div class="tl-stat"><strong>${count(s.current)}${s.current >= 3 ? ' <i class="tl-flame" aria-hidden="true">🔥</i>' : ""}</strong><span>current streak</span></div>
    <div class="tl-stat"><strong>${dollars(s.spent.cents)}</strong><span>spent · ${count(s.spent.free)} free songs</span></div>
    <div class="tl-stat tl-stat-wide"><strong>${escape(busiest)}</strong><span>busiest day</span></div>`;
  return s;
}

function heat(days) {
  const max = Math.max(0, ...days.map((day) => day.songs.length));
  const weekday = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
  const weeks = heatWeeks(days);
  $("#timeline-heat").dataset.weeks = weeks.length <= 12 ? "few" : "many";
  $("#timeline-heat").innerHTML = `
    <div class="tl-heat-days" aria-hidden="true">${weekday.map((name) => `<span>${name}</span>`).join("")}</div>
    <div class="tl-heat-grid" role="list">${weeks.map((week) => `<div class="tl-heat-week">${week.map((day) => {
      if (!day) return '<span class="tl-cell" data-level="none" aria-hidden="true"></span>';
      const n = day.songs.length;
      const label = `${date(day.start, { weekday: "short", month: "short", day: "numeric" })}: ${n ? plural(n, "song") : "no songs"}`;
      return n
        ? `<a class="tl-cell" role="listitem" data-level="${heatLevel(n, max)}" href="#day-${dayKey(day.start)}" aria-label="${escape(label)}" data-tip="${escape(label)}"></a>`
        : `<span class="tl-cell" role="listitem" data-level="0" aria-label="${escape(label)}" data-tip="${escape(label)}"></span>`;
    }).join("")}</div>`).join("")}</div>`;
}

function songRow({ song, number }) {
  const milestone = number === 1 ? "The first one" : number % 50 === 0 ? `Song #${count(number)}` : "";
  return `<li class="tl-song${milestone ? " tl-milestone" : ""}">
    <button type="button" class="tl-play" data-play="${escape(song.id)}" aria-pressed="false" aria-label="Play ${escape(song.title || "Untitled")}"${song.url ? "" : " disabled"}><svg viewBox="0 0 16 16" aria-hidden="true"><path class="tl-play-icon" d="M4.5 2.8v10.4L13 8z"/><path class="tl-pause-icon" d="M4 3h3v10H4zM9 3h3v10H9z"/></svg></button>
    <span class="tl-time">${escape(date(new Date(Date.parse(song.publishedAt)), { hour: "numeric", minute: "2-digit" }))}</span>
    <a class="tl-title" href="${escape(songHref(song))}">${escape(song.title || "Untitled")}</a>
    <span class="tl-meta">${milestone ? `<span class="tl-badge">${escape(milestone)}</span>` : ""}${songCostLabel(song)}${clock(song.duration) ? `<span class="tl-length">${clock(song.duration)}</span>` : ""}</span>
  </li>`;
}

function timeline(days, busiest) {
  const max = Math.max(1, ...days.map((day) => day.songs.length));
  $("#timeline-list").innerHTML = withWeeks(timelineRows(days)).map((row) => {
    if (row.kind === "week") {
      const entries = row.days.flatMap((day) => day.songs);
      const cost = spend(entries, songCost);
      return `<li class="tl-week"><span class="tl-week-name">Week of ${escape(date(row.start, { month: "short", day: "numeric" }))}</span><span class="tl-week-sum">${plural(entries.length, "song")} · ${escape(spendText(cost))}${cost.paid && cost.free ? ` · ${count(cost.free)} free` : ""}</span></li>`;
    }
    if (row.kind === "gap") {
      const n = row.days.length;
      const until = row.days[0].start, from = row.days.at(-1).start;
      const span = n === 1 ? date(from, { month: "short", day: "numeric" }) : `${date(from, { month: "short", day: "numeric" })} – ${date(until, { month: "short", day: "numeric" })}`;
      return `<li class="tl-gap"><span>${n === 1 ? "A quiet day" : `${count(n)} quiet days`} · ${escape(span)}</span></li>`;
    }
    const { day } = row;
    const n = day.songs.length;
    const when = relative(day);
    const minutes = Math.round(day.songs.reduce((sum, { song }) => sum + (Number.isFinite(song.duration) ? song.duration : 0), 0) / 60);
    return `<li class="tl-day" id="day-${dayKey(day.start)}">
      <span class="tl-disc" data-scale="${0.7 + (n / max) * 0.6}" aria-hidden="true"><span class="tl-disc-label">${count(n)}</span></span>
      <div class="tl-day-card">
        <header class="tl-day-head">
          <h2>${escape(date(day.start, { weekday: "long", month: "long", day: "numeric" }))}</h2>
          <span class="tl-day-sub">${when ? `<span class="tl-when">${escape(when)}</span>` : ""}<span>${plural(n, "song")}${minutes ? ` · ${count(minutes)} min` : ""} · <span class="tl-spend">${escape(spendText(spend(day.songs, songCost)))}</span></span>${day === busiest ? ' <span class="tl-crown" title="Busiest day">👑 busiest</span>' : ""}</span>
        </header>
        <ol class="tl-songs">${[...day.songs].reverse().map((entry) => songRow(entry)).join("")}</ol>
      </div>
    </li>`;
  }).join("");
  // The site's content security policy refuses inline style attributes, so sizes travel as data and are set here.
  for (const disc of document.querySelectorAll("#timeline-list [data-scale]")) disc.style.setProperty("--scale", disc.dataset.scale);
  // Play runs down the page as it reads: newest day first, newest song first.
  queue = [...days].reverse().flatMap((day) => [...day.songs].reverse().map(({ song }) => song)).filter((song) => song.url);
  syncPlay();
  reveal();
}

function syncPlay() {
  for (const button of document.querySelectorAll("#timeline-list [data-play]")) {
    const playing = player.playing && player.current?.id === button.dataset.play;
    const title = button.closest(".tl-song")?.querySelector(".tl-title")?.textContent || "song";
    button.dataset.playing = String(playing);
    button.setAttribute("aria-pressed", String(playing));
    button.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${title}`);
    button.closest(".tl-song")?.classList.toggle("tl-now", player.current?.id === button.dataset.play);
  }
}

// One tooltip for the calendar, placed against the viewport so the strip's scrolling box never clips it.
function tooltip() {
  const tip = document.createElement("div");
  tip.className = "tl-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  scope.onLeave(() => tip.remove());
  const show = (cell) => {
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const box = cell.getBoundingClientRect();
    const left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2));
    const above = box.top - tip.offsetHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${above < 8 ? box.bottom + 8 : above}px`;
  };
  const hide = () => { tip.hidden = true; };
  const heat = $("#timeline-heat");
  const cellOf = (event) => event.target.closest?.("[data-tip]");
  scope.on(heat, "pointerover", (event) => { const cell = cellOf(event); if (cell) show(cell); else hide(); });
  scope.on(heat, "pointerleave", hide);
  scope.on(heat, "focusin", (event) => { const cell = cellOf(event); if (cell) show(cell); });
  scope.on(heat, "focusout", hide);
  scope.on(heat, "scroll", hide, { passive: true });
  scope.on(window, "scroll", hide, { passive: true });
}

// Release days drift in as they scroll into view; with reduced motion, or without an observer, they are simply there.
function reveal() {
  observer?.disconnect();
  const items = document.querySelectorAll(".tl-day");
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("tl-in"); observer.unobserve(entry.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const item of items) { item.classList.add("tl-rise"); observer.observe(item); }
}

function render() {
  const days = timelineDays(songs);
  if (!days.length) { $("#timeline-list").innerHTML = '<li class="empty">Nothing on the timeline yet.</li>'; return; }
  const s = stats(days);
  heat(days);
  timeline(days, s.busiest);
  const undated = songs.length - s.songs;
  $("#timeline-undated").textContent = undated ? `${plural(undated, "song")} without a release time ${undated === 1 ? "is" : "are"} left off.` : "";
}

async function loadSongs() {
  const use = (data) => { if (!scope.left && Array.isArray(data?.songs)) { songs = data.songs.filter((song) => !data.archived?.includes?.(song.id)); render(); } };
  let live = false;
  const fallback = fetch("/catalog-summary.json").then((response) => response.json()).then((data) => { if (!live) use(data); });
  try {
    const data = await api("/songs/summary", { timeout: 5000 });
    live = true;
    use(data);
  } catch {
    await fallback.catch(() => { if (!scope.left) $("#timeline-status").textContent = "The catalog could not load. Refresh to try again."; });
    if (!scope.left && songs.length) $("#timeline-status").textContent = "Showing the saved catalog; the newest songs may be missing.";
  }
}

async function mountPage() {
  scope = currentScope();
  songs = [];
  scope.onLeave(() => observer?.disconnect());
  tooltip();
  scope.on($("#timeline-list"), "click", (event) => {
    const button = event.target.closest("[data-play]");
    const song = button && queue.find((item) => item.id === button.dataset.play);
    if (song) player.toggle(song, queue, { source: "main" });
  });
  player.on("change", syncPlay, scope.signal);
  for (const type of ["play", "pause", "ended"]) scope.on(player.audio, type, syncPlay);
  await loadSongs();
}

definePage(import.meta.url, mountPage);
