import { api } from "./api.js";
import { currentScope } from "./page-scope.js";
import { definePage } from "./shell.js";
import { songCostLabel } from "./song-cost.js";
import { dayKey, heatLevel, heatWeeks, timelineDays, timelineRows, timelineStats } from "./timeline-data.js";

// Timeline: every release day, newest first, with a calendar strip on top and the quiet stretches folded away.
const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const count = (n) => new Intl.NumberFormat("en-US").format(n);
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
const date = (value, options) => new Intl.DateTimeFormat("en-US", options).format(value);
const clock = (seconds) => Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "";
const songHref = (song) => song.collection === "fearhunger" ? "/fearhunger/" : `/#${encodeURIComponent(song.id)}`;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let scope, songs = [], observer;

function relative(day) {
  const today = new Date();
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - day.start) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? `${diff} days ago` : "";
}

function stats(days) {
  const s = timelineStats(days);
  const busiest = s.busiest ? `${date(s.busiest.start, { month: "short", day: "numeric" })} · ${plural(s.busiest.songs.length, "song")}` : "—";
  $("#timeline-stats").innerHTML = `
    <div class="tl-stat"><strong>${count(s.songs)}</strong><span>songs on the timeline</span></div>
    <div class="tl-stat"><strong>${count(s.activeDays)}<small>/${count(s.days)}</small></strong><span>days with a release</span></div>
    <div class="tl-stat"><strong>${count(s.longest)}</strong><span>longest daily streak</span></div>
    <div class="tl-stat"><strong>${count(s.current)}${s.current >= 3 ? ' <i class="tl-flame" aria-hidden="true">🔥</i>' : ""}</strong><span>current streak</span></div>
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
    <span class="tl-time">${escape(date(new Date(Date.parse(song.publishedAt)), { hour: "numeric", minute: "2-digit" }))}</span>
    <a class="tl-title" href="${escape(songHref(song))}">${escape(song.title || "Untitled")}</a>
    <span class="tl-meta">${milestone ? `<span class="tl-badge">${escape(milestone)}</span>` : ""}${songCostLabel(song)}${clock(song.duration) ? `<span class="tl-length">${clock(song.duration)}</span>` : ""}</span>
  </li>`;
}

function timeline(days, busiest) {
  const max = Math.max(1, ...days.map((day) => day.songs.length));
  $("#timeline-list").innerHTML = timelineRows(days).map((row) => {
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
          <span class="tl-day-sub">${when ? `<span class="tl-when">${escape(when)}</span>` : ""}<span>${plural(n, "song")}${minutes ? ` · ${count(minutes)} min` : ""}</span>${day === busiest ? ' <span class="tl-crown" title="Busiest day">👑 busiest</span>' : ""}</span>
        </header>
        <ol class="tl-songs">${[...day.songs].reverse().map((entry) => songRow(entry)).join("")}</ol>
      </div>
    </li>`;
  }).join("");
  // The site's content security policy refuses inline style attributes, so sizes travel as data and are set here.
  for (const disc of document.querySelectorAll("#timeline-list [data-scale]")) disc.style.setProperty("--scale", disc.dataset.scale);
  reveal();
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
  await loadSongs();
}

definePage(import.meta.url, mountPage);
