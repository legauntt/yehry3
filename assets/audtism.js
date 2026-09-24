import { api, signedIn } from "./api.js";
import { auditPeriods, auditTotals, periodEnd } from "./audit-data.js";
import { currentScope } from "./page-scope.js";
import { definePage } from "./shell.js";

// Aud'tism: every release counted by day or week, with what the paid ones cost and what is left to spend.
const unitKey = "yehry3:audtism-unit";
const $ = (selector, root = document) => root.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dollars = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const centsText = (cents) => `${new Intl.NumberFormat("en-US").format(cents)} ¢`;
const count = (n) => new Intl.NumberFormat("en-US").format(n);
const minutes = (seconds) => `${count(Math.round(seconds / 60))} min`;
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
const day = (date, options = { month: "short", day: "numeric" }) => new Intl.DateTimeFormat("en-US", options).format(date);
const readUnit = () => { try { return localStorage.getItem(unitKey) === "week" ? "week" : "day"; } catch { return "day"; } };
const saveUnit = (unit) => { try { localStorage.setItem(unitKey, unit); } catch { /* Storage blocked: the choice lasts this visit. */ } };

let scope, songs = [], unit = "day";

function periodLabel(period, short = false) {
  if (unit === "day") return short ? day(period.start, { day: "numeric" }) : day(period.start, { weekday: "short", month: "short", day: "numeric" });
  return short ? day(period.start) : `Week of ${day(period.start)}`;
}

function tiles() {
  const total = auditTotals(songs);
  const recorded = total.cents - total.estimatedCents;
  const perPaid = total.paid ? Math.round(total.cents / total.paid) : 0;
  $("#audit-tiles").innerHTML = `
    <div class="audit-tile"><span class="audit-tile-label">Songs released</span><strong>${count(total.songs)}</strong><span class="audit-tile-note">${count(total.paid)} paid · ${count(total.free)} free</span></div>
    <div class="audit-tile"><span class="audit-tile-label">Music made</span><strong>${minutes(total.seconds)}</strong><span class="audit-tile-note">${(total.seconds / 3600).toFixed(1)} hours end to end</span></div>
    <div class="audit-tile"><span class="audit-tile-label">Spent on paid music</span><strong>${dollars(total.cents)}</strong><span class="audit-tile-note" title="Recorded costs come from the settled ledger; the rest are length estimates at 15 cents a minute.">${dollars(recorded)} recorded · ${dollars(total.estimatedCents)} estimated</span></div>
    <div class="audit-tile"><span class="audit-tile-label">Per paid song</span><strong>${centsText(perPaid)}</strong><span class="audit-tile-note">on average</span></div>`;
}

// A column chart of one period series. Each column is focusable and explains itself on hover or focus.
function chart(root, periods, { stacked, value, total, describe }) {
  const max = Math.max(1, ...periods.map(total));
  const peak = periods.reduce((best, period) => (total(period) > total(best) ? period : best), periods[0]);
  root.innerHTML = `<div class="audit-plot" role="list">${periods.map((period, index) => {
    const segments = stacked.map(({ key }) => ({ key, size: value(period, key) })).filter(({ size }) => size > 0);
    const label = describe(period);
    const tick = unit === "week" || periods.length <= 16 || index % Math.ceil(periods.length / 12) === 0 || index === periods.length - 1;
    return `<div class="audit-col" role="listitem" tabindex="0" aria-label="${escape(label)}" data-tip="${escape(label)}">
      <div class="audit-bar" data-size="${(total(period) / max) * 100}">${period === peak && total(period) > 0 ? `<span class="audit-peak">${escape(stacked.length > 1 ? count(total(period)) : centsText(total(period)))}</span>` : ""}${segments.map(({ key, size }) => `<i class="audit-seg ${key}" data-grow="${size}"></i>`).join("")}</div>
      <span class="audit-tick"${tick ? "" : " aria-hidden=\"true\" data-hidden"}>${escape(periodLabel(period, true))}</span>
    </div>`;
  }).join("")}</div>`;
  sizeFrom(root);
}

// The site's content security policy refuses inline style attributes, so sizes travel as data and are set here.
function sizeFrom(root) {
  for (const bar of root.querySelectorAll("[data-size]")) bar.style.height = `${bar.dataset.size}%`;
  for (const meter of root.querySelectorAll("[data-fill]")) meter.style.width = `${meter.dataset.fill}%`;
  for (const segment of root.querySelectorAll("[data-grow]")) segment.style.flexGrow = segment.dataset.grow;
}

function render() {
  const periods = auditPeriods(songs, unit);
  for (const button of document.querySelectorAll("[data-audit-unit]")) button.setAttribute("aria-pressed", String(button.dataset.auditUnit === unit));
  tiles();
  const songText = (p) => `${periodLabel(p)}: ${plural(p.songs, "song")} (${count(p.paid)} paid, ${count(p.free)} free), ${minutes(p.seconds)}`;
  chart($("#audit-songs"), periods, {
    stacked: [{ key: "paid" }, { key: "free" }],
    value: (p, key) => p[key],
    total: (p) => p.songs,
    describe: songText,
  });
  chart($("#audit-spend"), periods, {
    stacked: [{ key: "paid" }],
    value: (p) => p.cents,
    total: (p) => p.cents,
    describe: (p) => `${periodLabel(p)}: ${centsText(p.cents)} on ${plural(p.paid, "paid song")}${p.estimatedCents ? `, ${centsText(p.estimatedCents)} of it estimated` : ""}`,
  });
  $("#audit-table tbody").innerHTML = [...periods].reverse().map((p) => `<tr${p.songs ? "" : ' class="audit-quiet"'}>
    <th scope="row">${escape(periodLabel(p))}${unit === "week" ? `<span class="audit-range"> – ${escape(day(periodEnd(p, unit)))}</span>` : ""}</th>
    <td>${count(p.songs)}</td><td class="audit-split">${count(p.paid)}</td><td class="audit-split">${count(p.free)}</td><td class="audit-length">${minutes(p.seconds)}</td>
    <td>${p.cents ? centsText(p.cents) : "—"}${p.estimatedCents ? `<span class="audit-est" title="${escape(centsText(p.estimatedCents))} estimated"> *</span>` : ""}</td>
  </tr>`).join("");
  const undated = auditTotals(songs).undated;
  $("#audit-undated").textContent = undated ? `${plural(undated, "song")} without a release time ${undated === 1 ? "is" : "are"} counted in the totals but not the charts.` : "";
}

function budgetView(result) {
  const provider = result.provider;
  const parts = [];
  if (provider) {
    const used = provider.creditLimit > 0 ? Math.min(1, Math.max(0, provider.creditsRemaining / provider.creditLimit)) : 0;
    const cents = provider.availableCents ?? provider.remainingCents;
    const songMinutes = Math.floor(cents / (provider.estimatedCentsPerMinute || 15));
    const renews = provider.resetAt ? day(new Date(provider.resetAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    parts.push(`<div class="audit-budget-row">
      <p><strong>ElevenLabs credits</strong> ${count(provider.creditsRemaining)} of ${count(provider.creditLimit)} left${provider.tier ? ` · ${escape(provider.tier)} plan` : ""}</p>
      <div class="audit-meter" role="meter" aria-valuemin="0" aria-valuemax="${provider.creditLimit}" aria-valuenow="${provider.creditsRemaining}" aria-label="ElevenLabs credits left"><i data-fill="${used * 100}"></i></div>
      <p class="small">About ${dollars(cents)} of generation, roughly ${plural(songMinutes, "minute")} of music (${plural(Math.floor(songMinutes / 3.5), "song")} at 3½ minutes)${provider.availableCents != null && provider.availableCents !== provider.remainingCents ? ", after the songs already in the queue" : ""}.${renews ? ` Renews ${escape(renews)}.` : ""}</p>
      <p class="small">Reported by the studio PC ${escape(day(new Date(provider.observedAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}${provider.fresh ? "" : " — out of date, so it may have changed"}.</p>
    </div>`);
  } else parts.push(`<p class="small">The studio PC has not reported the ElevenLabs balance yet.</p>`);
  if (Number.isFinite(result.capCents)) {
    const left = Math.min(1, Math.max(0, result.remainingCents / result.capCents));
    parts.push(`<div class="audit-budget-row">
      <p><strong>Spending cap</strong> ${dollars(result.remainingCents)} of ${dollars(result.capCents)} left</p>
      <div class="audit-meter" role="meter" aria-valuemin="0" aria-valuemax="${result.capCents}" aria-valuenow="${result.remainingCents}" aria-label="Spending cap left"><i data-fill="${left * 100}"></i></div>
      <p class="small">The site's own limit on paid songs. Reservations count until they are settled against real usage.</p>
    </div>`);
  }
  return parts.join("");
}

async function loadBudget() {
  const root = $("#audit-budget");
  if (!signedIn("submitter")) {
    root.innerHTML = `<p class="small">Sign in on <a href="/distonyc/">Make a request</a> to see the remaining ElevenLabs credits and spending cap.</p>`;
    return;
  }
  try {
    const result = await api("/music-backends", { role: "submitter" });
    if (!scope.left) { root.innerHTML = budgetView(result); sizeFrom(root); }
  } catch {
    if (!scope.left) root.innerHTML = `<p class="small">The budget could not be read right now. Reload to try again.</p>`;
  }
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
    await fallback.catch(() => { if (!scope.left) $("#audit-status").textContent = "The catalog could not load. Refresh to try again."; });
    if (!scope.left && songs.length) $("#audit-status").textContent = "Showing the saved catalog; the newest songs may be missing.";
  }
}

async function mountPage() {
  scope = currentScope();
  songs = [];
  unit = readUnit();
  for (const button of document.querySelectorAll("[data-audit-unit]"))
    scope.on(button, "click", () => { unit = button.dataset.auditUnit; saveUnit(unit); if (songs.length) render(); });
  await Promise.all([loadSongs(), loadBudget()]);
}

definePage(import.meta.url, mountPage);
