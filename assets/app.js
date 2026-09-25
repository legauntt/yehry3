import { needsReview } from "./repair-status.js";
import { showMessage, showToast } from "./message.js";
import { songBadges, voiceModelBadge } from "./song-badges.js";
import { pitchBadge } from "./pitch-badge.js";
import { sidesBadge } from "./sides.js";
import { songCostLabel } from "./song-cost.js";
import { mountMusicBackend, paidConfirmation, rememberPaidAgreement, PAID_BACKEND } from './music-backend.js';
import { gpuWaiting, gpuWaitNotice } from "./gpu-status.js";
import { mountGeneration, mountGenerationReview } from './generation.js';
import { songPlanLink } from "./song-plan.js";
import { brandLine } from "./branding.js";
import { mountMaterials, materialBrief, durationIssue, hasMaterialEdits } from "./request-materials.js";
import { mountLyricWorkshop } from "./lyric-workshop.js";
import { requestPromptBrief, promptSummary } from "./prompt-brief.js";
import { mountRequestTabs } from "./request-tabs.js";
import { authoredByLine, authorField, savedAuthor, rememberAuthor } from "./authored-by.js";
import { recoveryActive, recoveryStatus } from "./recovery.js";
import { dehakaThread } from "./dehaka.js";
import { workerPresence } from "./worker-presence.js";
import { publicQueue, queueDetailsPage, queueItemHref } from "./queue.js";
import { mountQualitySettings, qualityNotice } from "./quality.js";
import { modelInfoButton, mountModelInfo, voiceVersionLabel } from "./model-info.js";
import { rememberedVoice, rememberVoice, startingVoice, usesGeneration } from "./voice-choice.js";
import { lyricsPage } from "./lyrics.js";
import { lyricsHref } from "./song-links.js";
import { originalPromptPage } from "./original-prompt.js";
import { rotateSuggestions } from "./suggestions.js";
import { startRecordMotion } from "./record-motion.js";
import { startRecordSinger } from "./record-singer.js";
import { api, login, logout, signedIn, loginPersistence, storage } from "./api.js";
import { loadBasisSongs, mountBasisPicker } from "./basis.js";
import { watchCompletions } from "./notifications.js";
import { mountFavorites } from "./favorites.js";
import { listeningLabel } from "./listening.js";
import { player } from "./player.js";
import { setRecordingLabel } from "./player-bar.js";
import { definePage, navigate } from "./shell.js";
import { currentScope } from "./page-scope.js";
import { loadRemix, remixBadge, remixLink } from "./remix.js";
import { draftRemixId, traceRemix } from "./remix-trace.js";
import { recordingLabels, recordingLabel, recordingTitle } from "./recording-label.js";
import { mountCatalogView } from "./catalog-view.js";
import { hasCustomArtwork, songArtworkMarkup } from "./song-art.js";
import { openArtRemix } from "./art-remix.js";
import { watchCatalog } from "./realtime.js";
import { announceAttention, badgeSoundIcon, hasBadgeSound, mountBadgeSounds } from "./badge-sound.js";

const $ = (selector, root = document) => root.querySelector(selector);
const main = $("#main");
let page = document.body.dataset.page;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const labels = {
  draft: "Your idea",
  review: "Ready to confirm",
  queued: "In the queue",
  processing: "In the studio",
  completed: "Ready to publish",
  publishing: "Publishing",
  published: "Published",
  needs_review: "Needs review",
  failed: "9/11'd Again",
  attention: "9/11'd Again",
  recovering: "Recovering automatically",
  canceled: "Canceled",
  cancel_requested: "Cancellation requested",
};
const date = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const badge = (status) =>
  hasBadgeSound(status)
    ? `<button type="button" class="badge ${escape(status)} badge-sound" title="Play a line from “Nine-Eleven'd Again”" aria-label="${escape(labels[status])} (play sound)">${escape(labels[status])}${badgeSoundIcon}</button>`
    : `<span class="badge ${escape(status)}">${escape(labels[status] || status)}</span>`;
let voiceModels = [
  { id: "v6", label: "Tony V6", note: "Established expressive catalog profile", experimental: false },
  { id: "v7", label: "Tony V7", note: "Separate fresh-catalog adapter and references", experimental: true },
];
const voiceModel = (id) =>
  voiceModels.find((model) => model.id === id) || (/^v\d+$/i.test(id || "")
    ? { id, label: `Tony ${id.toUpperCase()}`, note: "Versioned Tony voice profile", experimental: id !== "v6" }
    : voiceModels[0]);
const voiceModelLabel = voiceVersionLabel;
const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const ageFromElapsed = (elapsed) => {
  elapsed = Math.max(0, elapsed);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Less than a minute old";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} old`;
  const hours = Math.floor(minutes / 60);
  if (hours <= 24) return `${hours} ${hours === 1 ? "hour" : "hours"} old`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} old`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks} ${weeks === 1 ? "week" : "weeks"} old`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months} ${months === 1 ? "month" : "months"} old`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} old`;
};
const age = (value) => ageFromElapsed(Date.now() - new Date(value).getTime());
const collections = (song) => [
  ...new Set([song.collection, ...(song.collections || [])]),
];
const collectionNames = {
  fearhunger: "Fear & Hunger",
  tonyai: "Tony AI",
  distonyc: "Distonyc requests",
  shiablo: "Shiablo: The Lord of Prisoners",
};
// The two main collections are the default; only the exceptions are worth a label on each row.
const unlabeledCollections = new Set(["tonyai", "distonyc"]);
const message = showMessage;
function busy(button, value) {
  button.disabled = value;
  button.setAttribute("aria-busy", String(value));
}
function focusHeading() {
  const heading = $("h1", main);
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
function safeUrl(value) {
  try {
    const url = new URL(value, location.origin);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function songPublishedAt(song, recentPublishedAt) {
  for (const value of [song.publishedAt, recentPublishedAt]) {
    if (value && Number.isFinite(new Date(value).getTime())) return value;
  }
  const order = Number(song.order);
  const orderedDate = new Date(-order);
  return order < 0 && Number.isFinite(orderedDate.getTime()) ? orderedDate.toISOString() : "";
}

function songMeta(song, recentPublishedAt) {
  const publishedAt = songPublishedAt(song, recentPublishedAt);
  const releaseAge = publishedAt
    ? age(publishedAt)
    : "Age unavailable";
  const shown = collections(song).filter((name) => !unlabeledCollections.has(name));
  return `<div class="track-meta">${shown.length ? `<span class="track-collections">${escape(
    shown.map((name) => collectionNames[name] || name).join(" / "),
  )}</span>` : ""}${authoredByLine(song.authoredBy, escape)}${voiceModelBadge(song)}${songCostLabel(song)}${pitchBadge(song)}${sidesBadge(song)}<span class="track-duration">${duration(song.duration)}</span>${publishedAt ? `<time class="track-age" datetime="${escape(publishedAt)}" title="Released ${escape(date(publishedAt))}">${releaseAge}</time>` : `<span class="track-age" title="Exact release time unavailable">${releaseAge}</span>`}${(song.lyrics?.text || song.hasLyrics) ? `<a class="text-link" href="${lyricsHref(song)}" aria-label="Lyrics for ${escape(song.title)}">Lyrics ↗</a>` : ""}${songPlanLink(song, escape)}${(song.originalPrompt || song.hasOriginalPrompt) ? `<a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}" aria-label="Original prompt for ${escape(song.title)}">Original prompt ↗</a>` : ""}</div>`;
}

async function library() {
  const scope = currentScope();
  const listeningOverview = `<details class="listening-overview"><summary>Listening activity</summary><div class="listening-body"><div class="listening-heading"><p class="small" id="listening-scope">Loading listening stats…</p><button type="button" class="quiet" id="most-listened" aria-pressed="false">Most listened to ↗</button></div><dl class="listening-totals"><div><dt>Total listens</dt><dd id="listening-total">—</dd></div><div><dt>Songs listened to</dt><dd id="listening-reach">—</dd></div><div><dt>Latest listen</dt><dd id="listening-latest">—</dd></div></dl></div></details>`;
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">Tony C · The listening room</p><h1 data-brand-headline>${escape(brandLine.split("\n")[0])}<br><em>${escape(brandLine.split("\n")[1])}</em></h1>
        <p class="lede">Originals, remixes, and beautiful wrong turns. Find a favorite. Dream up the next one.</p>
        <div class="actions"><button class="primary" id="play-all">Play the collection <span aria-hidden="true">↗</span></button><a class="text-link" href="/mixtapes/">Listener mixtapes →</a><a class="text-link" href="/sausage/">How the Tony C is made →</a><div class="display-settings" data-quality-settings></div></div>
      </div>
      <div class="sleeve" aria-label="Tony C record sleeve"><div class="sleeve-top"><span>YEHRY3 RECORDS</span><span>VOL. 01</span></div><div class="record"><div class="record-label"><span>TONY C</span><small>& THE POSSIBILITIES</small><i></i><span class="label-bottom">PLAY IT LOUD</span></div></div><img class="band-cutout" src="/assets/band-vinyl-v1.webp" width="1000" height="493" alt="Six band members emerge from the vinyl in a cut-paper photo collage." fetchpriority="high"><img class="sleeve-shoes" src="/assets/record-shoes.svg" width="420" height="270" alt="A pair of worn lace-up shoes on the record cover."><div class="sleeve-bottom"><span>FAMILIAR VOICE.<br>UNFAMILIAR TERRITORY.</span><span class="stamp">Give it<br>a spin.</span></div></div>
    </section>
    <section class="collection" aria-labelledby="collection-title">
      <div class="section-heading"><h2 id="collection-title">Pick your next obsession.</h2><div class="catalog-status"><p class="small" id="track-count">Loading songs…</p><p class="small auto-refresh-note"><span aria-hidden="true">↻</span> Auto-refreshes every 30 seconds</p></div></div>
      <details class="catalog-filters"><summary><span>Search &amp; filters</span><span id="active-filters" hidden></span></summary>
      <div class="toolbar"><label class="search"><span class="sr-only">Search songs</span><input type="search" id="search" placeholder="Search songs or styles…"></label><label class="sr-only" for="collection-filter">Collection</label><select id="collection-filter"><option value="all">All collections</option><option value="tonyai">Tony AI</option><option value="fearhunger">Fear & Hunger</option><option value="distonyc">Distonyc requests</option><option value="shiablo">Shiablo: The Lord of Prisoners</option></select><label class="sr-only" for="feedback-filter">Listener feedback</label><select id="feedback-filter"><option value="all">Any feedback</option><option value="downvoted">Downvoted</option><option value="milquetoast">Milquetoasted</option></select><label class="sr-only" for="sort">Sort songs</label><select id="sort"><option value="hybrid">Fresh, then most loved</option><option value="catalog">Latest additions</option><option value="votes">Most loved</option><option value="title">A to Z</option><option value="plays">Most listened to</option><option value="least-played">Least listened to</option><option value="least-recent">Least recently played</option></select><button class="quiet" id="shuffle">Shuffle ↝</button></div></details>
      <div id="favorites"></div>${listeningOverview}<p class="small vote-note" id="vote-note">One anonymous vote per hour across the collection.</p><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1">← Previous page</button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1">Next page →</button></nav><div id="catalog-items"><div id="pending-tracks" aria-label="Songs on the way" hidden></div><div id="tracks" class="tracks"><p class="empty">Getting the records out…</p></div></div><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1">← Previous page</button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1">Next page →</button></nav><p class="small listening-note">Listens are recorded after 10 seconds of listening, once per browser per song every 30 minutes. History starts September 2026.</p>
    </section>
    <section class="request-banner"><p class="eyebrow">Distonyc</p><h2>Heard something<br>in your head?</h2><p><span data-suggestion>Medusa as a barbershop quartet?</span> Put it on the wish list.</p><a class="primary" href="/distonyc/">Pitch the next song <span aria-hidden="true">↗</span></a></section>
`;
  $("#catalog-items").insertAdjacentHTML("beforebegin", `<div class="catalog-view-bar"><p>A little cover art. A lot of personality.</p><div class="catalog-view-switch" role="group" aria-label="Song display"><button type="button" data-catalog-view="grid" aria-pressed="true" aria-controls="catalog-items"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/></svg>Grid</button><button type="button" data-catalog-view="list" aria-pressed="false" aria-controls="catalog-items"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 4H5M8 4H18M2 10H5M8 10H18M2 16H5M8 16H18"/></svg>List</button></div></div>`);
  mountCatalogView($(".catalog-view-switch"), $("#tracks"));
  mountQualitySettings(main);
  startRecordMotion($(".record", main), player.audio);
  rotateSuggestions(main);
  const filters = [
    { id: "collection-filter", param: "collection", defaultValue: "all" },
    { id: "feedback-filter", param: "feedback", defaultValue: "all" },
    { id: "sort", param: "sort", defaultValue: "hybrid" },
    { id: "search", param: "q", defaultValue: "" },
  ];
  const pageSize = 25;
  let catalogPage = 1, editingSearch = false;
  function pageUrl(replace = true) {
    const url = new URL(location.href);
    if (catalogPage > 1) url.searchParams.set("page", catalogPage);
    else url.searchParams.delete("page");
    if (url.href !== location.href) history[replace ? "replaceState" : "pushState"](null, "", url);
  }
  function restoreFilters(resetSearch = true) {
    const params = new URLSearchParams(location.search);
    const requested = Number(params.get("page") || 1);
    catalogPage = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
    for (const { id, param, defaultValue } of filters) {
      const control = $(`#${id}`);
      const value = params.get(param) ?? defaultValue;
      control.value =
        control.options &&
        !Array.from(control.options).some((option) => option.value === value)
          ? defaultValue
          : value;
    }
    if (resetSearch) editingSearch = false;
  }
  function shareFilters(replace = false) {
    const url = new URL(location.href);
    catalogPage = 1;
    url.searchParams.delete("page");
    for (const { id, param, defaultValue } of filters) {
      const value = $(`#${id}`).value;
      if (value === defaultValue) url.searchParams.delete(param);
      else url.searchParams.set(param, value);
    }
    if (url.href !== location.href)
      history[replace ? "replaceState" : "pushState"](null, "", url);
    render();
  }
  restoreFilters();
  let songs = [],
    pending = [],
    visible = [],
    nextVoteAt = null,
    online = false,
    voting = false,
    feedbackBusy = false,
    refreshing = null,
    refreshAgain = false;
  function pinButton(song) {
    const count = Math.max(0, Number(song.pins) || 0);
    const mine = Boolean(song.feedback?.pinned);
    const label = mine ? "📌 Pinned" : count ? "📌 Pin" : "📍 Pin";
    return `<button type="button" class="song-action" data-pin="${escape(song.id)}" aria-pressed="${mine}" aria-label="${mine ? "Unpin" : "Pin"} ${escape(song.title)}${count ? ` · ${count} shared` : ""}" ${!online || feedbackBusy ? "disabled" : ""}>${label}${count ? ` · ${count}` : ""}</button>`;
  }
  // Chairlift allows each browser one redraw per song an hour and keeps its prompt.
  function artRest(song) {
    const mine = song.feedback || {}, until = Date.parse(mine.artRedrawAt || "");
    const words = mine.artPrompt ? ` with “${mine.artPrompt}”` : "";
    if (!mine.artRemixed || until <= Date.now()) return { resting: false, note: words ? `Your last redraw was${words}.` : "" };
    const time = Number.isFinite(until) ? new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    return { resting: true, note: `You redrew this${words}. You can redraw it again ${time ? "at " + time : "in an hour"}.` };
  }
  function artButton(song) {
    if (hasCustomArtwork(song)) return "";
    const { resting, note } = artRest(song);
    // A resting button stays focusable and hoverable so the prompt can be read.
    return `<button type="button" class="song-action" data-art="${escape(song.id)}" aria-label="${resting ? escape(note) : "Redraw the clip art for " + escape(song.title)}"${note ? ` title="${escape(note)}"` : ""} ${resting ? 'aria-disabled="true"' : ""} ${!online || feedbackBusy ? "disabled" : ""}>${resting ? "🎨 Redrawn" : "🎨 Redraw"}</button>`;
  }
  startRecordSinger($(".record", main), () => songs);
  let initialCatalogPending = true;
  // The static fallback still lists archived songs; the last IDs the API reported keep them hidden until it answers.
  const archivedKey = "yehry3:archived-songs";
  const knownArchived = () => {
    try { return new Set(JSON.parse(localStorage.getItem(archivedKey) || "[]")); } catch { return new Set(); }
  };
  const rememberArchived = (ids) => {
    try { localStorage.setItem(archivedKey, JSON.stringify(ids)); } catch { /* the fallback just shows them */ }
  };
  const recentReleases = new Map();
  const freshWindow = 24 * 60 * 60 * 1000;
  const audio = player.audio;
  const rowMarkup = new WeakMap();
  const favorites = mountFavorites($("#favorites"), { filter: true, onChange: () => {
    // Favorite history callbacks may run before our popstate listener. Restore
    // all URL filters together before clamping the requested page.
    restoreFilters(false);
    render({ preserveViewport: true });
  } });
  // The player outlives this page; what it reports is shown here while the page is.
  player.on("recorded", ({ id, stats: { playCount, lastPlayedAt } }) => {
    const song = songs.find((item) => item.id === id);
    if (song) Object.assign(song, { playCount, lastPlayedAt });
    render({ preserveViewport: true });
  }, scope.signal);
  player.on("change", () => render(), scope.signal);
  document.querySelectorAll("[data-catalog-pagination]").forEach((nav) => {
    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-catalog-page]");
      if (!button || button.disabled) return;
      editingSearch = false;
      sharedFollowUntil = 0;
      catalogPage += Number(button.dataset.catalogPage);
      pageUrl(false);
      render();
      $("#collection-title").scrollIntoView({ block: "start" });
    });
  });
  function syncRows(container, markup) {
    const template = document.createElement("template");
    template.innerHTML = markup;
    const previous = new Map(Array.from(container.children, (row) => [row.dataset.id || "empty", row]));
    const keep = new Set();
    Array.from(template.content.children).forEach((next, index) => {
      const row = previous.get(next.dataset.id || "empty") || next;
      keep.add(row);
      const content = next.innerHTML;
      if (rowMarkup.get(row) !== content) {
        const opened = Array.from(row.querySelectorAll("details"), (detail) => detail.open);
        row.innerHTML = content;
        row.querySelectorAll("details").forEach((detail, i) => { detail.open = opened[i] || false; });
        rowMarkup.set(row, content);
      }
      row.className = next.className;
      if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
    });
    Array.from(container.children).forEach((row) => { if (!keep.has(row)) row.remove(); });
  }
  function viewportAnchor() {
    const rows = Array.from(document.querySelectorAll("#pending-tracks > [data-id], #tracks > [data-id]"));
    // Follow a reading position only after the visitor has reached the list.
    // A song peeking below the introduction must not pull the page down when it moves.
    if (!scrollY || !rows.length || rows[0].getBoundingClientRect().top > 0) return () => {};
    const visibleRows = rows
      .map((row) => ({ id: row.dataset.id, top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom }))
      .filter((row) => row.bottom > 0 && row.top < innerHeight);
    return () => {
      for (const before of visibleRows) {
        const row = document.querySelector(`#pending-tracks > [data-id="${CSS.escape(before.id)}"], #tracks > [data-id="${CSS.escape(before.id)}"]`);
        if (row) {
          const change = row.getBoundingClientRect().top - before.top;
          if (Math.abs(change) > 1) window.scrollBy(0, change);
          break;
        }
      }
    };
  }
  function renderPending() {
    const published = new Set(songs.map((song) => song.id));
    const seen = new Set();
    const eligible = pending.filter((song) => {
      if (published.has(song.id) || seen.has(song.id)) return false;
      seen.add(song.id);
      return ["queued", "processing", "completed", "publishing", "cancel_requested", "failed"].includes(song.status);
    });
    const failures = eligible.filter((song) => song.status === "failed");
    const rows = [
      ...failures,
      ...eligible.filter((song) => song.status !== "failed"),
    ];
    const container = $("#pending-tracks");
    container.hidden = !rows.length;
    syncRows(container, rows.map((song) => {
      const percent = Math.max(0, Math.min(100, Number(song.progress?.percent) || 0));
      const title = song.title || song.idea || "Untitled request";
      const state = recoveryStatus(song);
      const label = gpuWaiting(song) ? "Waiting for the GPU" : recoveryActive(song) ? "Recovering automatically" : song.status === "failed" ? "9/11'd Again" : "On the way";
      const needsAttention = song.status === "failed";
      return `<details class="pending-track${needsAttention ? " pending-attention" : ""}" data-id="${escape(song.id)}">
        <summary><span class="pending-mark" aria-hidden="true">↗</span>${songArtworkMarkup({ ...song, title }, escape)}
          <span class="pending-availability"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>Not yet playable</span>
          <span class="pending-title"><span class="tiny-label">${needsAttention ? '<svg class="pending-warning-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5"></path><circle cx="12" cy="17" r=".9"></circle></svg>' : ""}${label}</span><strong title="${escape(title)}">${escape(title)}</strong><span class="track-meta">${authoredByLine(song.authoredBy, escape)}${songBadges(song)}</span></span>
          <span class="pending-state">${badge(state)}${song.progress && song.status !== "failed" ? `<span class="small">${Math.round(percent)}%</span><progress max="100" value="${percent}" aria-label="Song production progress"></progress>` : ""}</span>
          <span class="pending-disclosure"><span class="pending-details-label">Details</span></span>
        </summary><div class="pending-body"><p>${escape(song.idea)}</p>${song.status === "failed" ? '<p class="attention-note">Completed work is saved; retry resumes completed stages.</p>' : song.progress ? `<p class="small">${escape(song.progress.stage)} · ${Math.round(percent)}%</p>` : ""}<div class="actions"><a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}">View original prompt ↗</a>${songPlanLink(song, escape)}<a class="text-link" href="${queueItemHref(song)}">View request details ↗</a></div></div></details>`;
    }).join(""));
  }
  // Rebuilt rows reset their classes, so the alert's outline is reapplied here
  // for as long as it stands.
  let highlighted = null;
  function markHighlighted() {
    const find = (id) => document.querySelector(
      `#tracks > [data-id="${CSS.escape(id)}"], #pending-tracks > [data-id="${CSS.escape(id)}"]`,
    );
    const row = highlighted ? find(highlighted) : null;
    row?.classList.add("is-revealed");
    // The shared badge outlives the alert outline, so it is applied whether or not one is still standing.
    const shared = sharedId ? find(sharedId) : null;
    if (shared) {
      shared.classList.add("is-shared");
      let badge = shared.querySelector(":scope > .shared-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "shared-badge";
        badge.setAttribute("role", "status");
        shared.prepend(badge);
      }
      badge.textContent = sharedFresh ? "Shared with you just now" : "Shared with you";
    }
    syncSharedSpotlight(shared);
    return row;
  }
  // A song page (/song/<id>/) leaves a note before forwarding here; that is what tells a shared link
  // from a completion alert or a hand-typed fragment. The badge stays for the life of the page.
  let sharedId = null, sharedFresh = false, sharedTimer, sharedFollowUntil = 0;
  let sharedSpotlight = false, sharedBackdrop, sharedClose;
  function dismissSharedSpotlight() {
    if (!sharedSpotlight) return;
    sharedSpotlight = false;
    sharedFollowUntil = 0;
    stopCentring?.();
    const row = $(".is-share-spotlight", main);
    if (document.activeElement === sharedClose) $("[data-play]", row || main)?.focus({ preventScroll: true });
    row?.classList.remove("is-share-spotlight");
    sharedBackdrop?.remove();
    sharedClose?.remove();
    sharedBackdrop = sharedClose = null;
  }
  function syncSharedSpotlight(row) {
    if (!sharedSpotlight) return;
    // Filtering, pagination or an archive can take the song off screen.
    if (!row) { dismissSharedSpotlight(); return; }
    row.classList.add("is-share-spotlight");
    if (sharedBackdrop) return;
    sharedBackdrop = document.createElement("div");
    sharedBackdrop.className = "shared-spotlight-backdrop";
    sharedBackdrop.setAttribute("aria-hidden", "true");
    sharedClose = document.createElement("button");
    sharedClose.type = "button";
    sharedClose.className = "shared-spotlight-close";
    sharedClose.setAttribute("aria-label", "Show full collection");
    sharedClose.title = "Show full collection (Esc)";
    sharedClose.textContent = "×";
    sharedClose.addEventListener("click", dismissSharedSpotlight);
    sharedBackdrop.addEventListener("click", dismissSharedSpotlight);
    document.body.append(sharedBackdrop, sharedClose);
  }
  // Listen for scroll intent, not scroll events: our own arrival centring must keep the spotlight.
  scope.on(window, "wheel", (event) => {
    if (event.deltaX || event.deltaY) dismissSharedSpotlight();
  }, { passive: true });
  scope.on(window, "touchmove", dismissSharedSpotlight, { passive: true });
  scope.on(window, "keydown", (event) => {
    if (!sharedSpotlight || event.target.closest?.("dialog[open]")) return;
    if (event.key === "Escape") { dismissSharedSpotlight(); event.preventDefault(); }
    else if ((["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)
      || (event.key === " " && !event.target.closest?.("button, a, summary, [role='button']")))
      && !event.target.closest?.("input, textarea, select, [contenteditable]")) dismissSharedSpotlight();
  });
  // This is a visual introduction, not a modal: tabbing elsewhere restores the collection.
  scope.on(document, "focusin", (event) => {
    if (event.target !== sharedClose && !event.target.closest?.(".is-share-spotlight, dialog[open]")) dismissSharedSpotlight();
  });
  scope.onLeave(dismissSharedSpotlight);
  function takeShared(id) {
    try {
      const note = JSON.parse(sessionStorage.getItem("yehry3:shared-song") || "null");
      sessionStorage.removeItem("yehry3:shared-song");
      return note?.id === id && Date.now() - note.at < 120000;
    } catch { return false; }
  }
  function render({ preserveViewport = false } = {}) {
    const restoreViewport = preserveViewport ? viewportAnchor() : () => {};
    const activeFilters = [];
    if ($("#search").value) activeFilters.push(`Search: “${$("#search").value}”`);
    if ($("#collection-filter").value !== "all")
      activeFilters.push($("#collection-filter").selectedOptions[0].textContent);
    if ($("#feedback-filter").value !== "all")
      activeFilters.push($("#feedback-filter").selectedOptions[0].textContent);
    if (favorites.onlySaved) activeFilters.push("Saved songs");
    if ($("#sort").value !== "hybrid")
      activeFilters.push(`Sort: ${$("#sort").selectedOptions[0].textContent}`);
    const filterSummary = $("#active-filters");
    filterSummary.hidden = !activeFilters.length;
    filterSummary.innerHTML = activeFilters.map((label) => `<span class="active-filter">${escape(label)}</span>`).join("");
    const recordings = recordingLabels(songs, (song) => songPublishedAt(song, recentReleases.get(song.id)));
    if (player.current) setRecordingLabel(player.current.id, recordingLabel(recordings.get(player.current.id), escape));
    const query = $("#search").value.toLowerCase();
    const collection = $("#collection-filter").value;
    // Totals cover every listener; the browser's own flag keeps a just-sent signal from vanishing.
    const feedbackMatches = {
      all: () => true,
      downvoted: (song) => song.downvotes > 0 || Boolean(song.feedback?.downvoted),
      milquetoast: (song) => song.milquetoasts > 0 || Boolean(song.feedback?.milquetoast),
    }[$("#feedback-filter").value] || (() => true);
    visible = songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) &&
        (collection === "all" || collections(song).includes(collection)) && feedbackMatches(song) && favorites.includes(song),
    );
    if ($("#sort").value === "hybrid") {
      const releasedAt = (song) => Date.parse(songPublishedAt(song, recentReleases.get(song.id))) || 0;
      const cutoff = Date.now() - freshWindow;
      visible.sort((a, b) => {
        const aReleased = releasedAt(a), bReleased = releasedAt(b);
        const aFresh = aReleased >= cutoff, bFresh = bReleased >= cutoff;
        if (aFresh !== bFresh) return bFresh - aFresh;
        if (aFresh && aReleased !== bReleased) return bReleased - aReleased;
        return (b.votes || 0) - (a.votes || 0);
      });
    }
    if ($("#sort").value === "votes")
      visible.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    if ($("#sort").value === "title")
      visible.sort((a, b) => a.title.localeCompare(b.title));
    if ($("#sort").value === "plays")
      visible.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    if ($("#sort").value === "least-played")
      visible.sort((a, b) => (a.playCount || 0) - (b.playCount || 0));
    if ($("#sort").value === "least-recent")
      visible.sort((a, b) => (Date.parse(a.lastPlayedAt) || 0) - (Date.parse(b.lastPlayedAt) || 0));
    visible.sort((a, b) => (Number(b.pins) || 0) - (Number(a.pins) || 0));
    const hasStats = songs.some((song) => Number.isFinite(song.playCount)) &&
      visible.every((song) => Number.isFinite(song.playCount)) && !(favorites.onlySaved && (favorites.loading || !favorites.hasProfile));
    const totalListens = visible.reduce((total, song) => total + (song.playCount || 0), 0);
    const listenedTo = visible.filter((song) => song.playCount > 0).length;
    const latestListen = Math.max(0, ...visible.map((song) => Date.parse(song.lastPlayedAt) || 0));
    $("#listening-total").textContent = hasStats ? totalListens.toLocaleString() : "—";
    $("#listening-reach").textContent = hasStats ? `${listenedTo.toLocaleString()} of ${visible.length.toLocaleString()}` : "—";
    $("#listening-latest").textContent = hasStats ? latestListen ? date(latestListen) : "None recorded" : "—";
    $("#listening-scope").textContent = hasStats
      ? `${online ? "All listeners" : "Last available totals"} · Matching songs across all pages · Since Sep 15, 2026`
      : initialCatalogPending || (favorites.onlySaved && favorites.loading) ? "Loading listening stats…" : "Listening stats are temporarily unavailable.";
    $("#most-listened").setAttribute("aria-pressed", String($("#sort").value === "plays"));
    const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
    // Keep a deep link while an asynchronously selected favorite profile loads.
    if (!initialCatalogPending && !(favorites.onlySaved && favorites.loading)) {
      catalogPage = Math.min(catalogPage, pageCount);
      pageUrl();
    }
    // The live catalog can order songs differently from the fallback one the link first landed on;
    // for a moment after arrival the shared song is followed to wherever it settles.
    let followedShared = false;
    if (sharedId && Date.now() < sharedFollowUntil) {
      const at = visible.findIndex((song) => song.id === sharedId);
      if (at >= 0 && Math.floor(at / pageSize) + 1 !== catalogPage) {
        catalogPage = Math.floor(at / pageSize) + 1;
        pageUrl();
        followedShared = true;
      }
    }
    const offset = (catalogPage - 1) * pageSize;
    const pageSongs = visible.slice(offset, offset + pageSize);
    $("#track-count").textContent =
      `${visible.length} ${visible.length === 1 ? "song" : "songs"}${pageSongs.length ? ` · Showing ${offset + 1}–${offset + pageSongs.length}` : ""}`;
    document.querySelectorAll("[data-catalog-pagination]").forEach((nav) => {
      nav.hidden = pageCount <= 1;
      $("[data-catalog-page='-1']", nav).disabled = catalogPage <= 1;
      $("[data-catalog-page='1']", nav).disabled = catalogPage >= pageCount;
      $("[data-page-status]", nav).textContent = `Page ${catalogPage} of ${pageCount}`;
    });
    renderPending();
    syncRows($("#tracks"), visible.length
      ? pageSongs
          .map(
            (
              song,
              index,
            ) => `<article class="track${Number(song.pins) > 0 ? " pinned" : ""}" data-id="${escape(song.id)}">${songArtworkMarkup(song, escape)}
        <span class="track-number">${String(offset + index + 1).padStart(2, "0")}</span><button class="play-song" data-play="${escape(song.id)}" aria-label="Play ${escape(recordingTitle(song, recordings.get(song.id)))}" aria-pressed="false"><span class="play-icon" aria-hidden="true">▶</span><span class="pause-icon" aria-hidden="true">❚❚</span></button><div class="track-info"><div class="track-heading"><h3>${escape(song.title)}</h3>${remixBadge(song)}${recordingLabel(recordings.get(song.id), escape)}</div>${songMeta(song, recentReleases.get(song.id))}<p class="small track-listening" title="${escape(song.lastPlayedAt ? `Last listened ${date(song.lastPlayedAt)}` : "Listening history starts September 2026")}">${escape(listeningLabel(song))}</p>${qualityNotice(song.qualityIssues, song.reviewState, song.validationFailures, song.repairedAt)}<div class="song-actions" role="group" aria-label="Song actions">${pinButton(song)}${artButton(song)}<button type="button" class="song-action" data-feedback="downvote" data-song="${escape(song.id)}" ${song.feedback?.downvoted || !online ? "disabled" : ""}>${song.feedback?.downvoted ? "Downvoted" : "Downvote"}${Number(song.downvotes) ? ` · ${song.downvotes}` : ""}</button><button type="button" class="song-action" data-feedback="milquetoast" data-song="${escape(song.id)}" ${song.feedback?.milquetoast || !online ? "disabled" : ""}>${song.feedback?.milquetoast ? "Sent to agent" : "Milquetoast"}${Number(song.milquetoasts) ? ` · ${song.milquetoasts}` : ""}</button></div></div><span class="vote-hint" role="group"><button class="vote ${Number(song.votes) > 0 ? "has-votes" : ""}" data-vote="${escape(song.id)}" aria-label="Vote for ${escape(recordingTitle(song, recordings.get(song.id)))}"><span aria-hidden="true">${Number(song.votes) > 0 ? "♥" : "♡"}</span> <span>${online ? song.votes || 0 : "—"}</span></button><span class="vote-tooltip" role="tooltip" id="vote-tip-${escape(song.id)}"></span></span></article>`,
          )
          .join("")
      : `<p class="empty">${favorites.onlySaved ? escape(favorites.emptyMessage()) : "No songs match. Try another title or style."}</p>`);
    $("#tracks").querySelectorAll(".track-info").forEach((info) => {
      const song = songs.find((item) => item.id === info.closest("[data-id]").dataset.id);
      if (!info.querySelector("[data-save]")) info.insertAdjacentHTML("beforeend", favorites.button(song));
      if (info.querySelector("[data-remix]")) info.querySelector("[data-remix]").outerHTML = remixLink(song, escape);
      else info.querySelector(".track-meta").insertAdjacentHTML("beforeend", remixLink(song, escape));
    });
    favorites.syncButtons();
    syncPlaybackButtons();
    if (favorites.onlySaved) $("#pending-tracks").hidden = true;
    $("#play-all").disabled = !visible.length;
    $("#shuffle").disabled = !visible.length;
    markHighlighted();
    cooldown();
    restoreViewport();
    if (followedShared) keepCentred(sharedId);
  }
  function cooldown() {
    const left = Math.max(0, new Date(nextVoteAt || 0) - Date.now());
    const rules =
      "One anonymous vote per hour across the collection. Shared networks share the limit.";
    const reason = !online
      ? "Voting is temporarily offline. Listening is still available."
      : voting
        ? "Your vote is being sent."
        : left
          ? `Your next vote is available in ${Math.ceil(left / 60000)} min (${date(nextVoteAt)}).`
          : "";
    $("#vote-note").textContent = rules + (reason ? " " + reason : "");
    document.querySelectorAll("[data-vote]").forEach((button) => {
      button.disabled = !online || Boolean(left) || voting;
      const hint = button.parentElement,
        tooltip = hint.querySelector(".vote-tooltip");
      tooltip.textContent = button.disabled ? reason : "";
      hint.tabIndex = button.disabled ? 0 : -1;
      if (button.disabled) {
        hint.setAttribute("aria-label", "Voting unavailable");
        hint.setAttribute("aria-describedby", tooltip.id);
      } else {
        hint.removeAttribute("aria-label");
        hint.removeAttribute("aria-describedby");
      }
    });
    document.querySelectorAll("[data-feedback]").forEach((button) => {
      const song = songs.find((item) => item.id === button.dataset.song);
      const kind = button.dataset.feedback;
      button.disabled = !online || feedbackBusy || (kind === "milquetoast" && song?.feedback?.milquetoast) || (kind === "downvote" && song?.feedback?.downvoted);
    });
  }
  async function play(song, newQueue) {
    if (!song) return;
    await player.play(song, newQueue, { source: "main" });
  }
  function syncPlaybackButtons() {
    const isPlaying = player.playing;
    document.querySelectorAll("#tracks [data-play]").forEach((button) => {
      const song = songs.find((item) => item.id === button.dataset.play);
      const playing = isPlaying && player.current?.id === button.dataset.play;
      button.dataset.playing = String(playing);
      button.setAttribute("aria-pressed", String(playing));
      button.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${song?.title || "song"}`);
      button.closest(".track")?.classList.toggle("playing", playing);
    });
  }
  async function togglePlay(song, newQueue) {
    if (!song) return;
    // A song a lyric sheet or mixtape started, played on from here, continues through this list.
    if (newQueue && player.current?.id === song.id && player.source !== "main") player.requeue(newQueue, { source: "main" });
    await player.toggle(song, newQueue, { source: "main" });
  }
  // A completion alert lands here with the released song in the URL fragment.
  // Clear whatever filters or page would otherwise hide it, then point at it.
  let revealing, revealed, stopCentring;
  // Art, fonts and the live catalog keep changing the height above the song after it is first
  // scrolled to, which leaves it stranded at the bottom edge. Re-centre on each layout change
  // for a few seconds, and give up the moment the visitor scrolls for themselves.
  function keepCentred(id) {
    stopCentring?.();
    const find = () => document.querySelector(`#tracks > [data-id="${CSS.escape(id)}"], #pending-tracks > [data-id="${CSS.escape(id)}"]`);
    const centre = () => {
      const box = find()?.getBoundingClientRect();
      if (!box) return;
      const delta = box.height < innerHeight ? box.top + box.height / 2 - innerHeight / 2 : box.top - 16;
      if (Math.abs(delta) > 6) window.scrollBy({ top: delta, behavior: "instant" });
    };
    const events = ["wheel", "touchstart", "keydown", "pointerdown"];
    const observer = new ResizeObserver(centre);
    const timer = setTimeout(() => stopCentring?.(), 6000);
    stopCentring = () => {
      observer.disconnect();
      clearTimeout(timer);
      events.forEach((name) => removeEventListener(name, stopCentring));
      stopCentring = null;
    };
    events.forEach((name) => addEventListener(name, stopCentring, { passive: true }));
    observer.observe(document.body);
  }
  function revealSong(id) {
    if (!/^[a-z0-9-]{1,120}$/.test(id || "") || id === revealed) return;
    if (!songs.some((song) => song.id === id) && !pending.some((song) => song.id === id)) return;
    dismissSharedSpotlight();
    revealed = highlighted = id;
    if (takeShared(id)) {
      sharedId = id;
      sharedSpotlight = true;
      sharedFresh = true;
      sharedFollowUntil = Date.now() + 20000;
      clearTimeout(sharedTimer);
      sharedTimer = setTimeout(() => { sharedFresh = false; markHighlighted(); }, 60000);
    }
    if (favorites.onlySaved) $("#saved-only")?.click();
    if (!visible.some((song) => song.id === id)) {
      $("#search").value = "";
      $("#collection-filter").value = "all";
      $("#feedback-filter").value = "all";
      shareFilters(true);
    }
    const index = visible.findIndex((song) => song.id === id);
    const wanted = index < 0 ? catalogPage : Math.floor(index / pageSize) + 1;
    if (wanted !== catalogPage) {
      catalogPage = wanted;
      pageUrl();
      render();
    }
    const row = markHighlighted();
    if (!row) return;
    // Instant, not smooth: an animation heads for the spot the row occupied when it began, which
    // is stale by the time it arrives if anything above has loaded since.
    row.scrollIntoView({ block: "center", behavior: "instant" });
    keepCentred(id);
    if (sharedSpotlight) {
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
    }
    clearTimeout(revealing);
    revealing = setTimeout(() => {
      highlighted = null;
      document.querySelectorAll(".is-revealed").forEach((element) => element.classList.remove("is-revealed"));
    }, 8000);
  }
  const revealFromHash = () => {
    try { revealSong(decodeURIComponent(location.hash.slice(1))); }
    catch { /* A fragment that is not a song ID reveals nothing. */ }
  };
  scope.on(window, "hashchange", revealFromHash);
  scope.onLeave(() => { stopCentring?.(); clearTimeout(revealing); clearTimeout(sharedTimer); });
  $("#tracks").addEventListener("click", async (event) => {
    const playButton = event.target.closest("[data-play]");
    if (playButton)
      return togglePlay(
        songs.find((song) => song.id === playButton.dataset.play),
        visible,
      );
    const pinButton = event.target.closest("[data-pin]");
    if (pinButton) {
      const id = pinButton.dataset.pin;
      const song = songs.find((item) => item.id === id);
      if (!online || feedbackBusy || pinButton.disabled || !song) return;
      const pinned = !song.feedback?.pinned;
      // Pins reorder the catalog for every listener, so a stray tap should not count.
      if (!window.confirm(pinned
        ? `Pin “${song.title}” to the top for everyone?`
        : `Remove your shared pin from “${song.title}”?`))
        return;
      feedbackBusy = true;
      render({ preserveViewport: true });
      try {
        await api(`/song-pins/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { pinned },
        });
        message(pinned ? "Pinned for everyone." : "Shared pin removed.");
        await refresh();
      } catch (error) {
        message(error.message, true);
      } finally {
        feedbackBusy = false;
        render({ preserveViewport: true });
      }
      return;
    }
    const artTrigger = event.target.closest("[data-art]");
    if (artTrigger) {
      const song = songs.find((item) => item.id === artTrigger.dataset.art);
      if (!online || feedbackBusy || artTrigger.disabled || !song) return;
      // Touch screens cannot hover, so a tap on a resting button says the same thing.
      if (artRest(song).resting) return message(artRest(song).note);
      // The dialog previews the redraw, so choosing it there is the confirmation.
      openArtRemix(song, async (remix, prompt) => {
        await api(`/song-art/${encodeURIComponent(song.id)}`, { method: "POST", body: { remix, prompt } });
        message("Clip art redrawn for everyone.");
        await refresh();
      });
      return;
    }
    const feedbackButton = event.target.closest("[data-feedback]");
    if (feedbackButton) {
      if (!online || feedbackBusy || feedbackButton.disabled) return;
      const title = songs.find((item) => item.id === feedbackButton.dataset.song)?.title || "this song";
      // Neither kind of feedback can be withdrawn afterwards.
      if (!window.confirm(feedbackButton.dataset.feedback === "milquetoast"
        ? `Mark “${title}” as milquetoast? It also counts as a downvote, tells the song agent to avoid this pattern, and cannot be undone.`
        : `Downvote “${title}”? This cannot be undone.`))
        return;
      feedbackBusy = true;
      render({ preserveViewport: true });
      try {
        await api("/song-feedback", {
          method: "POST",
          body: { songId: feedbackButton.dataset.song, kind: feedbackButton.dataset.feedback },
        });
        message(feedbackButton.dataset.feedback === "milquetoast"
          ? "Milquetoast noted. The song agent will avoid this pattern in future."
          : "Downvote recorded as listener feedback.");
        await refresh();
      } catch (error) {
        message(error.message, true);
      } finally {
        feedbackBusy = false;
        render({ preserveViewport: true });
      }
      return;
    }
    const voteButton = event.target.closest("[data-vote]");
    if (!voteButton || voting) return;
    voting = true;
    cooldown();
    const id = voteButton.dataset.vote;
    // Keep a request ID until a definitive response, including network retries.
    const key = `vote-request:${id}`;
    const requestId = storage.get(key) || crypto.randomUUID();
    storage.set(key, requestId);
    try {
      const result = await api("/votes", {
        method: "POST",
        body: { songId: id, requestId },
      });
      nextVoteAt = result.nextVoteAt;
      storage.remove(key);
      message("Vote counted. Good taste.");
      await refresh();
    } catch (error) {
      if (error.retryAt) nextVoteAt = error.retryAt;
      if (error.status) storage.remove(key);
      message(
        error.retryAt
          ? `Your next vote is available ${date(error.retryAt)}.`
          : error.message,
        true,
      );
    } finally {
      voting = false;
      cooldown();
    }
  });
  async function refresh() {
    if (document.hidden || scope.left) return;
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        const [catalog, upcoming] = await Promise.allSettled([api("/songs/summary"), api("/queue?page=0")]);
        if (scope.left) return;
        if (catalog.status === "fulfilled" && Array.isArray(catalog.value.songs)) {
          songs = catalog.value.songs;
          if (Array.isArray(catalog.value.archived)) rememberArchived(catalog.value.archived);
          nextVoteAt = catalog.value.nextVoteAt;
          online = true;
        } else online = false;
        initialCatalogPending = false;
        if (upcoming.status === "fulfilled" && Array.isArray(upcoming.value.inStudio) && Array.isArray(upcoming.value.queued)) {
          pending = [...upcoming.value.inStudio, ...(upcoming.value.needsAttention || []), ...upcoming.value.queued];
          recentReleases.clear();
          for (const song of upcoming.value.recent || [])
            if (song.id && song.publishedAt) recentReleases.set(song.id, song.publishedAt);
          await announceAttention(upcoming.value.needsAttention || []);
        }
        if (scope.left) return;
        render({ preserveViewport: true });
      } while (refreshAgain && !document.hidden && !scope.left);
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  for (const id of ["collection-filter", "feedback-filter", "sort"])
    $(`#${id}`).addEventListener("change", () => {
      editingSearch = false;
      shareFilters();
    });
  $("#most-listened").onclick = () => {
    $("#sort").value = "plays";
    editingSearch = false;
    shareFilters();
  };
  $("#search").addEventListener("input", () => {
    // One history entry per search edit, rather than one per keystroke.
    shareFilters(editingSearch);
    editingSearch = true;
  });
  $("#search").addEventListener("blur", () => {
    editingSearch = false;
  });
  scope.on(window, "popstate", () => {
    restoreFilters();
    render();
  });
  scope.on(window, "pageshow", (event) => {
    if (event.persisted) {
      restoreFilters();
      render();
    }
  });
  $("#play-all").onclick = () => play(visible[0], visible);
  $("#shuffle").onclick = () => {
    const shuffled = [...visible];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    play(shuffled[0], shuffled);
  };
  for (const event of ["play", "playing", "pause", "ended", "emptied", "error"])
    audio.addEventListener(event, syncPlaybackButtons, { signal: scope.signal });
  try {
    const hidden = knownArchived();
    songs = (await (await fetch("/catalog-summary.json")).json()).songs.filter((song) => !hidden.has(song.id));
  } catch {
    message("The catalog could not load. Refresh to try again.", true);
  }
  render();
  // The live catalog re-sorts what the fallback showed, so a link reveals its song only after that
  // lands; revealing sooner would centre on a slot that then moves. If the live catalog cannot
  // be had, the fallback order is the final one and the song is revealed anyway.
  const waitingNote = "Loading your song…";
  let linked = "";
  try { linked = decodeURIComponent(location.hash.slice(1)); } catch { /* Not a song fragment. */ }
  if (/^[a-z0-9-]{1,120}$/.test(linked)) message(waitingNote);
  await refresh();
  if (scope.left) return;
  watchCatalog(refresh, { signal: scope.signal });
  // Only our own note is cleared, and before the reveal, so its going cannot move the centred row.
  if ($("#message")?.firstChild?.textContent === waitingNote) message("");
  revealFromHash();
  scope.every(cooldown, 15000);
  let refreshTimer = scope.every(refresh, 30000);
  scope.on(document, "visibilitychange", () => { if (!document.hidden) refresh(); });
  scope.on(window, "pagehide", () => clearInterval(refreshTimer));
  scope.on(window, "pageshow", (event) => {
    if (event.persisted) {
      clearInterval(refreshTimer);
      refreshTimer = scope.every(refresh, 30000);
      refresh();
    }
  });
}

function showLoginStatus(role, target, onSuccess) {
  const persistence = loginPersistence(role);
  const status = document.createElement("p");
  status.className = "small";
  status.id = "login-status";
  status.textContent = {
    saved: "Password saved in this browser.",
    temporary: "Your browser could not save this password. It is remembered only on this page.",
    session: "This older login has no saved password.",
  }[persistence];
  if (persistence === "session") {
    const remember = document.createElement("button");
    remember.className = "quiet";
    remember.textContent = "Remember login";
    remember.onclick = () => loginView(role, onSuccess);
    status.append(" ", remember);
  }
  target.append(status);
}

function loginView(role, onSuccess) {
  const admin = role === "admin";
  main.innerHTML = `<section class="form-layout"><div><p class="eyebrow">${admin ? "Backstage" : "Distonyc"}</p><h1>${admin ? "Run the<br><em>request line.</em>" : "A little idea.<br><em>A whole new song.</em>"}</h1><p class="lede">${admin ? "Review the requests, shape the queue, and keep the music moving." : "Tell us what you’re hearing. We’ll fine-tune the idea together before it joins the queue."}</p><p class="margin-note">${admin ? "Admin access" : "01 / The idea<br>02 / Refinements<br>03 / The final say"}</p></div><div class="form-card"><span class="tiny-label">${admin ? "AUTHORIZED PERSONNEL" : "IF YOU KNOW, YOU KNOW"}</span><h2>${admin ? "Welcome backstage." : "Come on in."}</h2><p>${admin ? "Use your separate admin password." : "Never share your password with anyone"}</p><p class="small">This browser remembers your password until you sign out.</p><form id="login-form"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button class="primary" type="submit">${admin ? "Open the queue" : "Let’s make something"} <span aria-hidden="true">→</span></button><p id="form-error" class="field-error" role="alert"></p></form></div></section>`;
  $("#login-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("button", event.target);
    busy(button, true);
    $("#form-error").textContent = "";
    try {
      await login(role, $("#password").value);
      $("#password").value = "";
      await onSuccess();
    } catch (error) {
      $("#form-error").textContent = error.message;
    } finally {
      busy(button, false);
    }
  };
}

async function requests() {
  const scope = currentScope();
  let draft = null;
  let remix = null, remixUsed = false, remixActive = false, keepSavedRequest = false;
  function finishRemix() {
    remixUsed = true; remixActive = false; storage.remove("remix-idea");
    const url = new URL(location.href); url.searchParams.delete("remix");
    history.replaceState(history.state, "", url);
  }
  // Detach from the saved request and put the remix idea back on step 01.
  function adoptRemixIdea() {
    traceRemix("adopt", { remix: remix.id, replacedDraft: draft?.id || storage.get("draft") });
    draft = null;
    storage.remove("draft");
    storage.remove("prompt-request");
    storage.set("idea-text", remix.seed.prompt);
    storage.set("remix-idea", remix.id);
    remixActive = true;
  }
  let basisSongs;
  let materialsAvailable = false;
  let generationAvailable = false, generationSchema;
  try {
    const loaded = await Promise.all([
      loadBasisSongs(),
      api("/voice-models").catch(() => ({ models: voiceModels })),
      api("/request-materials").catch(() => ({})),
      api("/generation").catch(() => ({})),
      fetch("/assets/generation-schema.json").then((r) => r.json()).catch(() => null),
    ]);
    basisSongs = loaded[0];
    if (Array.isArray(loaded[1].models) && loaded[1].models.length) voiceModels = loaded[1].models;
    materialsAvailable = loaded[2].version === 1;
    generationAvailable = loaded[3].enabled === true && loaded[4]?.version === 1; generationSchema = loaded[4];
    remix = await loadRemix();
    traceRemix("open", { param: new URLSearchParams(location.search).get("remix"), remix: remix?.id || null, unavailable: Boolean(remix?.unavailable), storedDraft: storage.get("draft"), storedRemixIdea: storage.get("remix-idea") });
  } catch (error) {
    message(error.message, true);
    main.innerHTML =
      '<section class="empty"><h1>The song list could not load.</h1><button class="primary" id="reload-basis">Try again</button></section>';
    $("#reload-basis").onclick = () => requests();
    return;
  }
  async function load() {
    const id = storage.get("draft");
    if (id) {
      try {
        draft = (
          await api(`/prompts/${encodeURIComponent(id)}`, { role: "submitter" })
        ).prompt;
      } catch (error) {
        if (error.status === 401) return loginView("submitter", load);
        if (error.status === 404) {
          storage.remove("draft");
          draft = null;
        } else {
          message(error.message, true);
          if (!draft) {
            main.innerHTML =
              '<section class="empty"><h1>Your request is still saved.</h1><p>We couldn’t load its latest status. Try again when the studio reconnects.</p><button class="primary" id="retry-request">Try again</button></section>';
            $("#retry-request").onclick = load;
          } else render();
          return;
        }
      }
    }
    // Older tabs may still carry the remix URL after confirmation. Keep its
    // pending owner review reachable instead of turning it into another idea.
    if (remix && !remixUsed && draft?.confirmedAt) {
      if (draft.generationReview?.state === 'pending' && draftRemixId(draft) === remix.id) finishRemix();
      else if (remix.seed) adoptRemixIdea();
    }
    render();
  }
  // The draft the server holds must be the remix this browser created it for.
  function auditRemix(where) {
    if (!draft) return "";
    const expected = storage.get(`remix-draft:${draft.id}`), actual = draftRemixId(draft);
    traceRemix(where, { draft: draft.id, status: draft.status, confirmed: Boolean(draft.confirmedAt), expected, actual, url: remix?.id || null });
    if (!expected || expected === actual) return "";
    traceRemix("mismatch", { draft: draft.id, expected, actual });
    return `This request is set to remix ${draft.details?.remixSource?.title ? `“${draft.details.remixSource.title}”` : "a different recording"}, not the song you chose. Start again from the song list.`;
  }
  function render(mode) {
    // A Remix link is an explicit choice of song. An unsent draft that is not that
    // remix must be resolved first, or its own song is sent under the new banner.
    const remixConflict = Boolean(remix?.seed && !remixUsed && draft && !draft.confirmedAt && !keepSavedRequest
      && storage.get(`remix-draft:${draft.id}`) !== remix.id && draft.details?.remixSource?.songId !== remix.id);
    const stage = remixConflict ? "conflict" :
      mode ||
      (draft?.confirmedAt
        ? "submitted"
        : draft?.status === "review" && !hasMaterialEdits(draft, storage)
          ? "review"
          : draft
            ? "details"
            : "idea");
    const number = { conflict: 1, idea: 1, details: 2, review: 3, submitted: 3 }[stage];
    if (stage === "idea" && !remixUsed && remix?.seed) {
      if (!storage.get("idea-text")) {
        storage.set("idea-text", remix.seed.prompt); storage.set("remix-idea", remix.id); remixActive = true;
      } else remixActive = remixActive || storage.get("remix-idea") === remix.id;
    }
    main.innerHTML = `<section class="request-intro"><p class="eyebrow">Distonyc</p><h1>Let’s hear<br><em>your wild idea.</em></h1><p class="lede">A familiar song in unfamiliar territory. Or something nobody’s heard before.</p><div class="request-session-actions">${stage === "submitted" ? '<button class="quiet" id="new-request">New request ↗</button>' : ""}<button class="quiet" id="request-signout">Sign out ↗</button></div></section><section class="workbench"><ol class="steps" aria-label="Request progress">${["The idea", "Refinements", "The final say"].map((name, i) => `<li ${i + 1 === number ? 'aria-current="step"' : ""}><span>0${i + 1}</span>${name}</li>`).join("")}</ol><div class="request-form" id="request-form"></div></section>`;
    showLoginStatus("submitter", $(".request-intro"), load);
    if (generationAvailable) {
      const reviewList = document.createElement('div'); $('.request-intro').append(reviewList);
      api('/generation-reviews', { role: 'submitter' }).then(({ reviews }) => {
        if (!reviewList.isConnected || !reviews?.length) return;
        reviewList.innerHTML = `<p class="small">Waiting for your review</p><div class="actions">${reviews.map((item) => `<button type="button" class="quiet" data-review-request="${escape(item.id)}">${escape(item.prompt.slice(0, 80))}</button>`).join('')}</div>`;
        reviewList.querySelectorAll('[data-review-request]').forEach((button) => { button.onclick = () => {
          finishRemix();
          storage.set('draft', button.dataset.reviewRequest);
          load();
        }; });
      }).catch(() => {});
    }

    if (remix && !remixUsed && stage !== "conflict") {
      const panel = document.createElement("div");
      panel.className = "remix-note";
      if (remix.unavailable) panel.innerHTML = `<p class="field-error" role="alert">${escape(remix.message)}</p><p class="small">The remix has not been submitted. <a href="/distonyc/">Start a different request</a>.</p>`;
      else {
        const linkedDraft = draft && storage.get(`remix-draft:${draft.id}`) === remix.id;
        const conflict = draft ? !linkedDraft : !remixActive;
        panel.innerHTML = `<p class="small">Remix of <a href="/lyrics/?song=${encodeURIComponent(remix.id)}">${escape(remix.title)}</a>: a new arrangement guided by the original. Melody and timing may change. ${linkedDraft ? "Choose the new sound and whether lyrics may change, then review your request." : "Edit the idea and tell us what should change."}</p>${conflict ? `<button type="button" class="quiet" id="begin-remix">${draft ? "Start this remix as a new request" : "Use the remix idea instead"}</button><p class="small">${draft ? "Your current request stays saved in the studio." : "This replaces the idea currently in the form."}</p>` : ""}`;
        panel.querySelector("#begin-remix")?.addEventListener("click", () => {
          adoptRemixIdea(); render();
        });
      }
      $(".request-intro").append(panel);
    }
    $("#request-signout").onclick = () => {
      logout("submitter");
      loginView("submitter", load);
    };
    $("#new-request")?.addEventListener("click", () => {
      finishRemix();
      draft = null;
      storage.remove("draft");
      render();
    });
    const form = $("#request-form");
    if (stage === "conflict") {
      const held = draft.details?.remixSource;
      form.innerHTML = `<p class="eyebrow">Two requests</p><h2>Which one should we send?</h2><p>You opened a Remix of <a href="/lyrics/?song=${encodeURIComponent(remix.id)}">${escape(remix.title)}</a>, but this tab is still holding an unsent request${held ? ` (a remix of <a href="/lyrics/?song=${encodeURIComponent(held.songId)}">${escape(held.title)}</a>)` : ""}:</p><blockquote>${escape(draft.prompt)}</blockquote><div class="actions"><button type="button" class="primary" id="use-remix">Remix “${escape(remix.title)}” instead</button><button type="button" class="quiet" id="keep-saved">Keep my saved request</button></div><p class="small">Your saved request stays saved in the studio.</p>`;
      $("#use-remix").onclick = () => { adoptRemixIdea(); render(); };
      $("#keep-saved").onclick = () => { keepSavedRequest = true; render(); };
    } else if (stage === "idea") {
      form.innerHTML = `<p class="eyebrow">Turn 01 · What if…</p><h2>What should we make?</h2><p>Pick a song and take it somewhere unexpected, or pitch an original.</p><form id="idea-form">${authorField}<label for="idea">Your prompt</label><textarea id="idea" rows="5" minlength="10" maxlength="2000" required data-suggestion placeholder="Rendition of Medusa as a barbershop quartet"></textarea><p class="small">A sentence or two is plenty to get started. Your idea, progress, and confirmed settings appear on the public dashboard after submission.</p><button class="primary">Find the direction <span aria-hidden="true">→</span></button><p class="field-error" role="alert"></p></form>`;
      $("#authored-by").value = savedAuthor();
      $("#authored-by").oninput = (event) => {
        rememberAuthor(event.target.value);
        storage.remove("prompt-request");
      };
      $("#idea").value = storage.get("idea-text") || (!remixUsed && remix?.seed ? remix.seed.prompt : "");
      $("#idea").oninput = (event) => {
        storage.set("idea-text", event.target.value);
        storage.remove("prompt-request");
      };
      $("#idea-form").onsubmit = (event) =>
        run(event, async () => {
          if (remix?.unavailable && storage.get('remix-idea') === remix.id) throw new Error(remix.message);
          const requestId =
            storage.get("prompt-request") || crypto.randomUUID();
          storage.set("prompt-request", requestId);
          draft = (
            await api("/prompts", {
              method: "POST",
              role: "submitter",
          body: { prompt: $("#idea").value, authoredBy: $("#authored-by").value.trim(), requestId, ...(remixActive && !remixUsed && remix?.seed ? { remixSongId: remix.id } : {}) },
            })
          ).prompt;
          rememberAuthor(draft.authoredBy || "");
          storage.set("draft", draft.id);
          traceRemix("draft-created", { draft: draft.id, sent: remixActive && !remixUsed && remix?.seed ? remix.id : null, got: draftRemixId(draft), requestId });
          keepSavedRequest = true; // Created here, on purpose: nothing older to choose between.
          if (remixActive && !remixUsed && remix?.seed) storage.set(`remix-draft:${draft.id}`, remix.id);
          storage.remove("prompt-request");
          render();
        });
    } else if (stage === "details") {
      const remixDetails = !remixUsed && remix?.seed && storage.get(`remix-draft:${draft.id}`) === remix.id ? remix.seed : {};
      const initialDetails = draft.status === "draft" ? { ...draft.details, ...remixDetails } : draft.details || {};
      form.innerHTML = `<p class="eyebrow">Turn 02 · Optional refinements</p><h2>Here’s what I’m hearing.</h2><blockquote>${escape(draft.prompt)}</blockquote><p>Choose the Tony voice and pitch. Open Advanced to add a sound, lyrics, references, or basis songs.</p>
        <form id="details-form">${authorField}
          <div class="request-tabs" role="tablist" aria-label="Request refinements">
            <button type="button" role="tab" id="essentials-tab" aria-controls="essentials-panel" aria-selected="true">Essentials</button>
            <button type="button" role="tab" id="advanced-tab" aria-controls="advanced-panel" aria-selected="false" tabindex="-1">Advanced</button>
          </div>
          <div role="tabpanel" id="essentials-panel" aria-labelledby="essentials-tab">
            <div id="lyric-workshop-root"></div>
            <div id="music-backend-root"></div>
            <div class="voice-model-label"><label for="voice-model">Tony voice model</label>${modelInfoButton()}</div>
            <select id="voice-model" name="voiceModel">${voiceModels.map((model) => `<option value="${escape(model.id)}">${escape(voiceModelLabel(model.id))}</option>`).join("")}</select><p class="small voice-model-note"></p>
            <div id="pitch-root"></div>
            <label for="keep">What matters most? <span class="small">(optional)</span></label><textarea id="keep" rows="2" maxlength="1000" placeholder="Tony’s slurred delivery and a big hook. Or: preserve the melody and words of the basis song."></textarea><p class="small field-hint">Leave this empty for “Surprise me.”</p>
          </div>
          <div role="tabpanel" id="advanced-panel" aria-labelledby="advanced-tab" hidden>
            <label for="direction">What does it sound like? <span class="small">(optional)</span></label><textarea id="direction" rows="3" maxlength="2000" placeholder="Refine the prompt with a style, arrangement, mood, or other direction…"></textarea><p class="small field-hint">Leave this empty to use your prompt as written.</p>
            <div id="generation-root"></div>
            <div id="request-materials-root"></div>
            <div id="basis-root"></div>
          </div>
          <div class="actions"><button class="primary">Review the request <span aria-hidden="true">→</span></button><button class="quiet" type="button" id="start-over">Change the idea</button></div><p class="field-error" role="alert"></p>
        </form>`;
      const requestTabs = mountRequestTabs($("#details-form"), storage, draft.id);
      const generation = mountGeneration($("#generation-root"), { pitchRoot: $("#pitch-root"), draft: { ...draft, details: initialDetails }, schema: generationSchema, enabled: generationAvailable, storage, escape });
      $("#authored-by").value = draft.authoredBy || "";
      $("#authored-by").oninput = (event) => rememberAuthor(event.target.value);
      const selectedBasis = mountBasisPicker(
        $("#basis-root"),
        basisSongs,
        initialDetails.basisSongIds || [],
      );
      const attachedRemix = initialDetails.remixSource;
      if (attachedRemix) {
        $("#basis-root").innerHTML = `<p class="small" data-remix-source>Recording attached: <a href="/lyrics/?song=${encodeURIComponent(attachedRemix.songId)}">${escape(attachedRemix.title)}</a>. <span data-remix-guidance>Its vocals guide the new arrangement; exact melody and timing may change.</span></p>`;
        $("#essentials-panel .request-shortcuts").insertAdjacentHTML("afterend", $("#basis-root").innerHTML);
        const direction = $('#direction'), directionLabel = $('label[for="direction"]'), hint = direction.nextElementSibling;
        directionLabel.textContent = 'What should change?';
        direction.placeholder = 'Try a new genre, mood, tempo, or instrumentation…';
        const fields = document.createElement('div');
        fields.append(directionLabel, direction, hint);
        $('label[for="keep"]').before(fields);
        $('label[for="keep"]').textContent = 'What should stay?';
        $('#keep').placeholder = 'The chorus words, the story, or the mood that makes this song yours…';
        $('#keep').nextElementSibling.after(Object.assign(document.createElement('div'), { id: 'remix-lyric-choice' }));
      }
      const savedDirection = draft.details?.direction || "";
      const savedKeep = initialDetails.keep || "";
      $("#direction").value = savedDirection === "Use the prompt as written." ? "" : savedDirection;
      $("#keep").value = savedKeep === "Surprise me." ? "" : savedKeep;
      const voiceDraftKey = `voice-draft:${draft.id}`;
      const savedVoice = storage.get(voiceDraftKey);
      const initialVoice = /^v[6-9]$/.test(savedVoice || '') ? savedVoice : initialDetails.voiceModel;
      if (initialVoice && !voiceModels.some(model => model.id === initialVoice)) {
        const unavailable = new Option(`${voiceModelLabel(initialVoice)} · temporarily unavailable`, initialVoice);
        unavailable.disabled = true; $("#voice-model").append(unavailable);
      }
      $("#voice-model").value = startingVoice({ saved: initialVoice, remembered: rememberedVoice(), models: voiceModels, generationAvailable });
      const describeVoice = () => {
        const model = voiceModel($("#voice-model").value);
        generation.setRequired(usesGeneration(model.id));
        $(".voice-model-note").textContent = `${model.note}.${model.experimental ? " This voice is still being evaluated." : ""}`;
      };
      $("#voice-model").onchange = () => { storage.set(voiceDraftKey, $("#voice-model").value); rememberVoice($("#voice-model").value); describeVoice(); };
      describeVoice();
      const music = mountMusicBackend($('#music-backend-root'), { draft: { ...draft, details: initialDetails }, generation, basisRoot: $('#basis-root'), storage, api, escape, onChange: describeVoice });
      const requestMaterials = materialsAvailable ? mountMaterials($("#request-materials-root"), { ...draft, details: initialDetails }, { api, storage, escape, lyricChoiceRoot: $('#remix-lyric-choice') }) : {
        read() {
          if (draft.details?.lyricSheet || draft.details?.references?.length) throw new Error("Your saved lyrics and references are temporarily unavailable for editing. Try again shortly.");
          return {};
        },
        clear() {},
      };
      if (!materialsAvailable) $("#request-materials-root").innerHTML = '<p class="small">Lyrics and reference links are temporarily unavailable.</p>' + materialBrief(draft.details, escape);
      if (materialsAvailable) mountLyricWorkshop($('#lyric-workshop-root'), { draft, materials: requestMaterials, api, storage, escape, scope,
        context: () => {
          const preferences = generation.read();
          return { direction: $('#direction').value.trim(), keep: $('#keep').value.trim(), duration: preferences?.duration ?? null, generation: preferences };
        } });
      requestTabs.sync();
      $("#start-over").onclick = () => {
        storage.set("idea-text", draft.prompt);
        if (attachedRemix) {
          remix = { id: attachedRemix.songId, title: attachedRemix.title, seed: { ...initialDetails, prompt: draft.prompt, remixSongId: attachedRemix.songId } };
          remixUsed = false; remixActive = true;
          storage.set('remix-idea', remix.id);
          const url = new URL(location.href); url.searchParams.set('remix', remix.id);
          history.replaceState(history.state, '', url);
        }
        draft = null;
        storage.remove("draft");
        render();
      };
      $("#details-form").onsubmit = (event) =>
        run(event, async () => {
          const details = {
            direction: $("#direction").value.trim() || "Use the prompt as written.",
            keep: $("#keep").value.trim() || "Surprise me.",
          };
          if (!attachedRemix && remix && storage.get(`remix-draft:${draft.id}`) === remix.id) throw new Error("The remix recording is not attached. Open Remix again when its source is available.");
          details.musicBackend = music.read();
          details.basisSongIds = attachedRemix || details.musicBackend === PAID_BACKEND ? [] : selectedBasis();
          if (attachedRemix) details.remixSongId = attachedRemix.songId;
          details.voiceModel = $("#voice-model").value;
          details.authoredBy = $("#authored-by").value.trim();
          Object.assign(details, requestMaterials.read());
          details.generation = generation.read();
          draft = (
            await api(`/prompts/${encodeURIComponent(draft.id)}`, {
              method: "PATCH",
              role: "submitter",
              body: { version: draft.version, ...details },
            })
          ).prompt;
          requestMaterials.clear(); generation.clear(); music.clear(); storage.remove(voiceDraftKey);
          rememberAuthor(draft.authoredBy || "");
          render();
        });
    } else if (stage === "review") {
      form.innerHTML = `<p class="eyebrow">One last check</p><h2>Does this sound right?</h2><p>This is the brief that will go into the studio queue.</p>${brief(draft)}<form id="confirm-form">${paidConfirmation(draft.details, escape)}<div class="actions"><button class="primary">Send to the queue <span aria-hidden="true">↗</span></button><button class="quiet" type="button" id="edit">Fine-tune it</button></div><p class="small">The queue holds up to 10 unfinished requests, including songs in production. If it is full, your review stays saved so you can try again when a slot opens.</p><p class="field-error" role="alert"></p></form>`;
      const materialIssue = durationIssue(draft.details, draft.prompt);
      const paidCheckbox = $('#confirm-paid');
      const paidConfirmationPanel = $('.paid-music-confirmation');
      if (paidCheckbox) paidCheckbox.onchange = () => { if (!paidCheckbox.checked) rememberPaidAgreement(false); };
      if (draft.details?.musicBackend === PAID_BACKEND && (!paidConfirmationPanel || !paidCheckbox)) $('#confirm-form .primary').disabled = true;
      if (materialIssue) {
        $("#confirm-form .primary").disabled = true;
        $("#confirm-form .field-error").textContent = materialIssue;
      }
      $("#edit").onclick = () => render("details");
      $("#confirm-form").onsubmit = (event) =>
        run(event, async () => {
          const paid = draft.details?.musicBackend === PAID_BACKEND;
          if (paid) rememberPaidAgreement(Boolean(paidCheckbox?.checked));
          draft = (await api(`/prompts/${encodeURIComponent(draft.id)}/confirm`, {
            method: "POST",
            role: "submitter",
            body: {
              version: draft.version,
              confirmed: true,
              ...(paid ? { confirmedPaid: Boolean(paidCheckbox?.checked) } : {}),
            },
          })).prompt;
          storage.remove("idea-text");
          // The remix link has done its job. Refresh now follows this request.
          finishRemix();
          render();
        });
    } else {
      form.innerHTML = `<span class="success-mark" aria-hidden="true">✓</span><p class="eyebrow">Request received</p><h2>Your idea is on the list.</h2><p>Your idea has a place in the studio queue. Check back here for its progress.</p>${badge(recoveryStatus(draft))} ${songBadges(draft)}${recoveryActive(draft) ? '<p class="small">Automatic recovery is working on your song. Saved work will be reused.</p>' : ""}${brief(draft)}${draft.publishedUrl ? `<a class="primary" href="${escape(safeUrl(draft.publishedUrl))}" target="_blank" rel="noopener">Hear your song ↗</a>` : ""}<div class="actions"><button class="quiet" id="refresh-status">Refresh status</button><button class="primary" id="another">Another idea ↗</button></div><p class="small">This browser tab remembers your request. <a href="/queue/">Watch the public queue and enable completion alerts →</a></p>`;
      const reviewRoot = document.createElement('div'); form.prepend(reviewRoot);
      mountGenerationReview(reviewRoot, { draft, api, escape, reload: load });
      $("#another").onclick = () => {
        finishRemix();
        draft = null;
        storage.remove("draft");
        render();
      };
      $("#refresh-status").onclick = async (event) => {
        busy(event.target, true);
        await load();
      };
    }
    const remixIssue = ["details", "review", "submitted"].includes(stage) ? auditRemix(`render:${stage}`) : "";
    if (remixIssue) {
      form.insertAdjacentHTML("afterbegin", `<p class="field-error" role="alert" data-remix-mismatch>${escape(remixIssue)}</p>`);
      if (stage === "review") $("#confirm-form .primary").disabled = true;
    }
    rotateSuggestions(main);
    focusHeading();
  }
  async function run(event, action) {
    event.preventDefault();
    const button = $('button[type="submit"], button:not([type])', event.target);
    busy(button, true);
    try {
      await action();
      message("");
    } catch (error) {
      if (error.status === 401) return loginView("submitter", load);
      if (error.status === 409) {
        await load();
        message(error.message, true);
      } else {
        const target = $(".field-error[role=alert]", event.target) || $(".field-error", event.target);
        if (target)
          target.textContent = error.retryAt
            ? `${error.message} Try again ${date(error.retryAt)}.`
            : error.message;
      }
    } finally {
      busy(button, false);
    }
  }
  if (!signedIn("submitter")) loginView("submitter", load);
  else await load();
}
function brief(doc, showGpuWait = true) {
  return `${showGpuWait ? gpuWaitNotice(doc) : ""}${requestPromptBrief(doc, escape, voiceModelLabel)}${qualityNotice(doc.result?.qualityIssues || doc.qualityIssues, doc.reviewState, doc.validationFailures || doc.result?.validationFailures, doc.repairedAt ?? doc.result?.repairedAt)}${doc.workerProgress ? `<p class="small">${escape(doc.workerProgress.stage)}${doc.status !== "failed" && doc.workerProgress.percent ? ` · ${Math.round(doc.workerProgress.percent)}%` : ""}</p>` : ""}${doc.workerError ? `<p class="field-error">${escape(doc.workerError)}</p>` : ""}`;
}

async function admin() {
  const scope = currentScope();
  const adminParams = new URLSearchParams(location.search);
  const requestedFilter = adminParams.get("status") === "failed" ? "attention" : adminParams.get("status");
  const sortOptions = { newest: "Newest first", oldest: "Oldest first", priority: "Queue priority" };
  const validFilters = ["all", ...Object.keys(labels).filter((key) => !["draft", "review"].includes(key))];
  // /admin/<requestId> opens that one request, the way a shared link should.
  const pathParts = location.pathname.split("/").filter(Boolean);
  const requestId = pathParts[0] === "admin" && pathParts.length === 2 && /^[A-Za-z0-9-]{1,64}$/.test(pathParts[1]) ? pathParts[1] : "";
  let data = null,
    filter = validFilters.includes(requestedFilter) ? requestedFilter : "queued",
    sortOrder = Object.hasOwn(sortOptions, adminParams.get("sort")) ? adminParams.get("sort") : "newest",
    pageNumber = 0,
    loadSequence = 0;
  const threads = new Map();
  // The song list keeps its own state so the queue's periodic re-render never loses a search.
  const songs = { q: "", view: "live", page: 0, data: null, sequence: 0, open: false, error: "", jumped: false, counted: false };
  let songTimer;
  const songsCount = () => (songs.data ? `${songs.data.counts.live} on the site · ${songs.data.counts.archived} archived` : "Search, archive or restore");
  function songsMarkup() {
    return `<details class="admin-songs" id="admin-songs"${songs.open ? " open" : ""}><summary><span class="admin-songs-chevron" aria-hidden="true"></span><span class="admin-songs-title">Published songs</span><span class="admin-songs-count small" id="song-count">${songsCount()}</span><span class="admin-songs-toggle" aria-hidden="true"></span></summary><div class="toolbar"><label class="search"><span class="sr-only">Search published songs</span><input type="search" id="song-search" placeholder="Search title, author, idea or ID…" value="${escape(songs.q)}"></label><label class="sr-only" for="song-view">Show songs</label><select id="song-view"><option value="live">On the site</option><option value="archived">Archived</option><option value="all">Both</option></select><span class="small" id="song-summary"></span></div><p class="small">Archiving hides a song from the site for everyone. Votes, plays and files are kept, and you can restore it here. Unpinning clears every listener's pin on a song at once; anyone can pin it again.</p><div id="song-list"></div><div class="song-pager"><button class="quiet" id="song-prev">← Earlier songs</button><span id="song-page"></span><button class="quiet" id="song-next">Later songs →</button></div></details>`;
  }
  function songRow(song) {
    const id = escape(song.id);
    const pins = Math.max(0, Number(song.pins) || 0);
    const meta = [collectionNames[song.collection] || song.collection, song.authoredBy && `by ${song.authoredBy}`, song.publishedAt && date(song.publishedAt), song.id, song.archivedAt && `archived ${date(song.archivedAt)}`].filter(Boolean);
    const title = song.archived ? escape(song.title) : `<a href="/#${id}" target="_blank" rel="noopener">${escape(song.title)}</a>`;
    const unpinButton = pins ? `<button type="button" class="quiet" data-unpin="${id}" aria-label="Unpin ${escape(song.title)}">📌 Unpin (${pins})</button>` : "";
    return `<article class="admin-song${song.archived ? " archived" : ""}" data-song="${id}"><div><h3>${title}${song.archived ? ' <span class="badge archived">Archived</span>' : ""}${pins ? ` <span class="badge pinned">📌 ${pins}</span>` : ""}</h3><p class="small">${escape(meta.join(" · "))}</p></div><div class="admin-song-actions">${unpinButton}<button type="button" class="quiet" data-archive="${id}" data-archived="${!song.archived}" aria-label="${song.archived ? "Restore" : "Archive"} ${escape(song.title)}">${song.archived ? "Restore" : "Archive"}</button></div></article>`;
  }
  function paintSongs() {
    const list = songs.data;
    if (!$("#song-list")) return;
    $("#song-view").value = songs.view;
    $("#song-count").textContent = songsCount();
    $("#song-summary").textContent = list ? `${list.total} matching · ${list.counts.live} on the site · ${list.counts.archived} archived` : "Loading songs…";
    $("#song-list").innerHTML = songs.error ? `<p class="small">${escape(songs.error)}</p>` : !list ? "" : list.songs.length ? list.songs.map(songRow).join("") : '<p class="empty small">No songs match.</p>';
    $("#song-page").textContent = `Page ${songs.page + 1}`;
    $("#song-prev").disabled = songs.page === 0;
    $("#song-next").disabled = !list || (songs.page + 1) * list.pageSize >= list.total;
  }
  // `quiet` is the one-time count for the collapsed header: it never signs in again or reports an error.
  async function loadSongs(quiet = false) {
    const sequence = ++songs.sequence;
    try {
      const params = new URLSearchParams({ view: songs.view, page: songs.page });
      if (songs.q.trim()) params.set("q", songs.q.trim());
      const response = await api(`/admin/songs?${params}`, { role: "admin" });
      if (sequence !== songs.sequence) return;
      if (!response.songs.length && songs.page > 0) {
        songs.page = 0;
        return loadSongs();
      }
      songs.data = response;
      songs.error = "";
      paintSongs();
    } catch (error) {
      if (sequence !== songs.sequence || quiet) return;
      // An expired session is settled by reloading the queue, which shows the login when it must.
      if (error.status === 401) return load();
      songs.error = error.status === 404 ? "Song archiving isn’t available from the studio API yet." : error.message;
      paintSongs();
    }
  }
  // The panel sits below the whole queue, so the header button and /admin/#songs both open it and bring it into view.
  function showSongs() {
    const panel = $("#admin-songs");
    panel.open = true;
    panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    $("#song-search").focus({ preventScroll: true });
  }
  // Archiving offers an Undo, since the row leaves the list the moment it succeeds.
  async function setArchived(id, archived, title) {
    try {
      await api(`/admin/songs/${encodeURIComponent(id)}`, { method: "PATCH", role: "admin", body: { archived } });
      showToast(archived ? `Archived “${title}”. It is off the site for everyone.` : `Restored “${title}” to the site.`,
        archived ? { action: { label: "Undo", run: () => setArchived(id, false, title) } } : {});
      await loadSongs();
    } catch (error) {
      if (error.status === 401) return load();
      showToast(error.message, { error: true });
    }
  }
  // Unpinning clears the shared signal for everyone at once; there is no per-listener target to restore.
  async function clearPins(id, title) {
    try {
      await api(`/admin/song-pins/${encodeURIComponent(id)}`, { method: "DELETE", role: "admin" });
      showToast(`Unpinned “${title}”. It can be pinned again by anyone.`);
      await loadSongs();
    } catch (error) {
      if (error.status === 401) return load();
      showToast(error.message, { error: true });
    }
  }
  function bindSongs() {
    $("#jump-songs").onclick = showSongs;
    $("#song-search").oninput = (event) => {
      songs.q = event.target.value;
      songs.page = 0;
      clearTimeout(songTimer);
      songTimer = setTimeout(loadSongs, 250);
    };
    $("#song-view").onchange = (event) => {
      songs.view = event.target.value;
      songs.page = 0;
      loadSongs();
    };
    $("#song-prev").onclick = () => {
      songs.page--;
      loadSongs();
    };
    $("#song-next").onclick = () => {
      songs.page++;
      loadSongs();
    };
    $("#song-list").addEventListener("click", async (event) => {
      const unpin = event.target.closest("[data-unpin]");
      if (unpin) {
        const id = unpin.dataset.unpin;
        const song = songs.data?.songs.find((item) => item.id === id);
        const title = song?.title || "this song";
        if (!window.confirm(`Unpin “${title}” for everyone? ${song?.pins || "Its"} pin${song?.pins === 1 ? "" : "s"} will be cleared, and anyone can pin it again.`)) return;
        busy(unpin, true);
        try {
          await clearPins(id, title);
        } finally {
          busy(unpin, false);
        }
        return;
      }
      const button = event.target.closest("[data-archive]");
      if (!button) return;
      const archived = button.dataset.archived === "true";
      const id = button.dataset.archive;
      const title = songs.data?.songs.find((item) => item.id === id)?.title || "this song";
      if (archived && !window.confirm(`Archive “${title}”? It leaves the site for everyone. Votes and plays are kept, and you can restore it here.`)) return;
      busy(button, true);
      try {
        await setArchived(id, archived, title);
      } finally {
        busy(button, false);
      }
    });
    $("#admin-songs").ontoggle = (event) => {
      songs.open = event.target.open;
      if (songs.open && !songs.data) loadSongs();
    };
    paintSongs();
    if (!songs.data && !songs.counted && !songs.open) {
      songs.counted = true;
      loadSongs(true);
    }
    if (location.hash === "#songs" && !songs.jumped) {
      songs.jumped = true;
      showSongs();
    }
  }
  // Threads refresh in place so an open raw log survives polling.
  async function loadThreads(onScreenOnly = false) {
    const onScreen = (node) => {
      const box = node.getBoundingClientRect();
      return box.bottom > -200 && box.top < innerHeight + 200;
    };
    await Promise.all(
      [...document.querySelectorAll("[data-dehaka-thread]")].filter((node) => !onScreenOnly || onScreen(node)).map(async (node) => {
        const id = node.dataset.dehakaThread;
        const body = $(".dehaka-thread-body", node);
        try {
          const { entries } = await api(`/admin/prompts/${encodeURIComponent(id)}/logs`, { role: "admin" });
          const html = dehakaThread(entries, { escape, date, completion: node.hasAttribute("data-completion") });
          if (!node.isConnected || threads.get(id) === html) return;
          threads.set(id, html);
          const open = new Set([...body.querySelectorAll("details[open]")].map((item) => item.dataset.log));
          body.innerHTML = html;
          body.querySelectorAll("details[data-log]").forEach((item) => (item.open = open.has(item.dataset.log)));
        } catch (error) {
          if (!threads.has(id)) body.innerHTML = `<p class="small">${error.status === 404 ? "The diagnostic log isn’t available from the studio API yet." : "The diagnostic log couldn’t load; it will retry."}</p>`;
        }
      }),
    );
  }
  function signOut() {
    loadSequence++;
    logout("admin");
    data = null;
    loginView("admin", load);
  }
  async function load() {
    const sequence = ++loadSequence;
    try {
      if (requestId) {
        const response = await api(`/admin/prompts/${encodeURIComponent(requestId)}`, { role: "admin" });
        if (sequence !== loadSequence) return;
        data = { prompts: [response.prompt], total: 1, counts: {}, transitions: response.transitions, workers: response.workers };
        return renderRequest();
      }
      const nextFilter = filter;
      const nextSort = sortOrder;
      let nextPage = pageNumber;
      while (true) {
        const response = await api(
          `/admin/prompts?status=${nextFilter}&sort=${nextSort}&page=${nextPage}`,
          { role: "admin" },
        );
        if (sequence !== loadSequence) return;
        if (!response.prompts.length && nextPage > 0) {
          nextPage = 0;
          continue;
        }
        pageNumber = nextPage;
        data = response;
        render();
        break;
      }
    } catch (error) {
      if (sequence !== loadSequence) return;
      if (error.status === 401) return loginView("admin", load);
      if (requestId && error.status === 404) {
        data = null;
        document.title = "Request not found · Backstage — yehry3";
        main.innerHTML = '<section class="empty"><h1>That request isn’t here.</h1><p>It may not have been submitted yet, or the link is mistyped.</p><a class="text-link" href="/admin/?status=all">All requests →</a></section>';
        return;
      }
      message(error.message, true);
      if (!data)
        main.innerHTML =
          '<section class="empty"><h1>The queue couldn’t load.</h1><button class="primary" id="retry-admin">Try again</button></section>';
      $("#retry-admin")?.addEventListener("click", load);
    }
  }
  function renderRequest() {
    const doc = data.prompts[0];
    document.title = `${doc.prompt.length > 60 ? `${doc.prompt.slice(0, 57)}…` : doc.prompt} · Backstage — yehry3`;
    main.innerHTML = `<section class="admin-intro"><div><p class="eyebrow">Backstage · One request</p><h1>Up close on<br><em>this one.</em></h1></div><button class="quiet" id="signout">Sign out ↗</button></section><div class="worker-health">${workerPresence(data.workers, { escape, date })}</div><section class="admin-queue"><div class="toolbar"><a class="text-link" href="/admin/?status=all">← All requests</a><button class="quiet" id="refresh">Refresh ↻</button></div><div id="queue">${row(doc)}</div></section>`;
    showLoginStatus("admin", $(".admin-intro > div"), load);
    loadThreads();
    $("#refresh").onclick = load;
    $("#signout").onclick = signOut;
    bindQueue();
  }
  function render() {
    main.innerHTML = `<section class="admin-intro"><div><p class="eyebrow">Backstage · Studio queue</p><h1>Make room for<br><em>the next one.</em></h1></div><div class="admin-intro-actions"><button class="quiet" id="jump-songs" type="button">Published songs ↓</button><button class="quiet" id="signout">Sign out ↗</button></div></section><div class="stats">${[
      ["queued", "Waiting in line"],
      ["processing", "In the studio"],
      ["attention", "9/11'd Again"],
      ["recovering", "Recovering automatically"],
      ["completed", "Ready to publish"],
      ["published", "Out in the world"],
      ["needs_review", "Needs review"],
    ]
      .map(
        ([status, label]) =>
          `<a href="${status === "queued" ? "/admin/" : `/admin/?status=${status}`}" data-status-tile="${status}"${status === filter ? ' aria-current="true"' : ""}><strong>${data.counts[status] ?? (status === "attention" ? data.counts.failed || 0 : 0)}</strong><span>${label}</span></a>`,
      )
      .join(
        "",
      )}</div><div class="worker-health">${workerPresence(data.workers, { escape, date })}</div><section class="admin-queue"><div class="toolbar"><label for="status-filter">Show</label><select id="status-filter"><option value="all">All requests</option>${Object.entries(
      labels,
    )
      .filter(([key]) => !["draft", "review", "failed"].includes(key))
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join(
        "",
      )}</select><label for="admin-sort">Sort</label><select id="admin-sort">${Object.entries(sortOptions).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select><button class="quiet" id="refresh">Refresh ↻</button><span class="small">${data.total} requests · ${sortOrder === "priority" ? "Higher priority first; oldest wins ties." : sortOrder === "oldest" ? "Earliest submissions first." : "Latest submissions first."}</span></div><div id="queue">${data.prompts.length ? data.prompts.map(row).join("") : `<div class="empty"><span class="empty-symbol">◎</span><h2>A little room for possibility.</h2><p>No requests in this view yet.</p>${filter === "all" ? '<a class="text-link" href="/distonyc/">Make the first request →</a>' : '<a class="text-link" href="/admin/?status=all">All requests →</a>'}</div>`}</div><div class="pagination"><button class="quiet" id="prev-page" ${pageNumber === 0 ? "disabled" : ""}>← Previous</button><span>Page ${pageNumber + 1}</span><button class="quiet" id="next-page" ${(pageNumber + 1) * 50 >= data.total ? "disabled" : ""}>Next →</button></div></section>${songsMarkup()}`;
    showLoginStatus("admin", $(".admin-intro > div"), load);
    loadThreads();
    function changeView() {
      pageNumber = 0;
      const url = new URL(location.href);
      if (filter === "queued") url.searchParams.delete("status");
      else url.searchParams.set("status", filter);
      if (sortOrder === "newest") url.searchParams.delete("sort");
      else url.searchParams.set("sort", sortOrder);
      history.replaceState(null, "", url);
      load();
    }
    $("#status-filter").value = filter;
    document.querySelectorAll("[data-status-tile]").forEach((tile) => {
      tile.onclick = (event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        filter = tile.dataset.statusTile;
        changeView();
      };
    });
    $("#status-filter").onchange = (event) => {
      filter = event.target.value;
      changeView();
    };
    $("#admin-sort").value = sortOrder;
    $("#admin-sort").onchange = (event) => {
      sortOrder = event.target.value;
      changeView();
    };
    $("#refresh").onclick = load;
    bindSongs();
    $("#signout").onclick = signOut;
    $("#prev-page").onclick = () => {
      pageNumber--;
      load();
    };
    $("#next-page").onclick = () => {
      pageNumber++;
      load();
    };
    bindQueue();
  }
  // The queue list and the single-request view share these card controls.
  function bindQueue() {
    $("#queue").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-support], [data-copy-support]");
      if (!button) return;
      const card = button.closest("[data-prompt]");
      const panel = $(".support-report", card);
      if (button.hasAttribute("data-copy-support")) {
        const report = $("textarea", panel);
        try {
          await navigator.clipboard.writeText(report.value);
          $(".support-copy-status", panel).textContent = "Copied. Paste it into your support conversation.";
        } catch {
          report.focus(); report.select();
          $(".support-copy-status", panel).textContent = "Copy the selected report with Ctrl+C or your device’s Copy command.";
        }
        return;
      }
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      if (panel.hidden) return;
      panel.innerHTML = '<p class="small">Collecting the saved diagnostics…</p>';
      busy(button, true);
      try {
        const report = await api(`/admin/prompts/${encodeURIComponent(card.dataset.prompt)}/support`, { role: "admin" });
        if (!panel.isConnected) return;
        panel.innerHTML = `<h3>Contact Support</h3><p class="small">Copy this report into a support conversation. It includes the current state and excerpts from retained logs.</p><label for="report-${escape(card.dataset.prompt)}">Diagnostic report</label><textarea id="report-${escape(card.dataset.prompt)}" rows="14" readonly>${escape(report.text)}</textarea><button type="button" class="quiet" data-copy-support>Copy report</button><p class="small support-copy-status" role="status"></p>`;
      } catch (error) {
        if (panel.isConnected) panel.innerHTML = `<p class="field-error">${escape(error.message)}</p><p class="small">Close and reopen Contact Support to retry. Raw logs remain below.</p>`;
      } finally { busy(button, false); }
    });
    $("#queue").addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = event.target.closest("[data-prompt]");
      const doc = data.prompts.find((item) => item.id === card.dataset.prompt);
      const kind = event.submitter?.dataset.action || event.target.dataset.action;
      const body = { action: kind, version: doc.version };
      if (kind === "archive-request") {
        if (!window.confirm("Archive this failed request? Recovery will stop. Saved work and history are kept under Canceled, where you can queue it again.")) return;
        body.action = "status";
        body.status = "canceled";
      }
      if (kind === "regenerate") {
        const key = `review-regeneration:${doc.id}`;
        body.requestId = storage.get(key) || crypto.randomUUID();
        storage.set(key, body.requestId);
      }
      if (kind === "priority")
        body.priority = Number($('[name="priority"]', event.target).value);
      if (kind === "note") body.note = $('[name="note"]', event.target).value;
      if (kind === "archive" && !window.confirm("Archive this recording? It leaves the site for everyone and closes the review."))
        return;
      if (kind === "status") {
        body.status = $('[name="status"]', event.target).value;
        if (body.status === "published")
          body.publishedUrl = $('[name="publishedUrl"]', event.target).value;
        if (
          ["canceled", "cancel_requested"].includes(body.status) &&
          !window.confirm(
            body.status === "cancel_requested"
              ? "Request cancellation? A running job must acknowledge it before stopping."
              : "Cancel this queued request?",
          )
        )
          return;
      }
      const button = event.submitter || $("button", event.target);
      busy(button, true);
      try {
        const response = await api(`/admin/prompts/${encodeURIComponent(doc.id)}`, {
          method: "PATCH",
          role: "admin",
          body,
        });
        if (response.draftId) {
          storage.set("draft", response.draftId);
          navigate("/distonyc/");
          return;
        }
        message(kind === "archive-request" ? "Request archived. Saved work and history are kept under Canceled." : "Queue updated.");
        await load();
      } catch (error) {
        if (error.status === 401) {
          data = null;
          loginView("admin", load);
        } else {
          message(error.message, true);
          if (error.status === 409) await load();
        }
      } finally {
        busy(button, false);
      }
    });
    document.querySelectorAll('select[name="status"]').forEach(
      (select) =>
        (select.onchange = () => {
          const field = $(".publish-field", select.closest("form"));
          field.hidden = select.value !== "published";
          $("input", field).required = !field.hidden;
        }),
    );
  }
  function row(doc) {
    const id = escape(doc.id);
    const allowed = (data.transitions[doc.status] || []).filter(
      (status) =>
        !doc.workerActive ||
        (doc.status !== "cancel_requested" &&
          ["cancel_requested", "canceled"].includes(status)),
    );
    const adapting = recoveryActive(doc);
    const steered = (doc.history || []).some((entry) => entry.action === "shepherd");
    const hasThread = doc.status === "failed" || steered;
    const thread = hasThread ? `<section class="dehaka-thread" data-dehaka-thread="${id}" aria-label="Diagnostic history and raw logs"><h3>Raw logs & history</h3><div class="dehaka-thread-body" aria-live="polite">${threads.get(doc.id) || '<p class="small">Loading diagnostic history and raw logs…</p>'}</div></section>` : "";
    const logsRecent = doc.status === "published" && Date.now() - Date.parse(doc.publishedAt || doc.updatedAt) < 25 * 3600 * 1000;
    const logsSlot = !hasThread && doc.status === "published" && (logsRecent || needsReview(doc))
      ? `<section class="dehaka-thread completion-logs" data-dehaka-thread="${id}" data-completion aria-label="Raw logs from the render"><h3>Raw logs</h3><div class="dehaka-thread-body" aria-live="polite">${threads.get(doc.id) || '<p class="small">Loading the render’s raw logs…</p>'}</div></section>` : "";
    const archiveRequest = doc.status === "failed" && !doc.workerActive && allowed.includes("canceled");
    const support = `<form class="support-actions" data-action="archive-request"><button type="button" class="primary" data-support aria-expanded="false" aria-controls="support-${id}">Contact Support</button>${archiveRequest ? '<button class="quiet">Archive</button>' : ""}<span class="small">Dehaka has retired. Support is you, wearing a different hat.</span></form><section id="support-${id}" class="support-report" hidden aria-label="Support report" aria-live="polite"></section>`;
    const failure = doc.status === "failed" ? `<section class="attention-problem"><p class="eyebrow">What stopped it</p>${doc.workerProgress?.stage ? `<p class="small">Production stopped during ${escape(doc.workerProgress.stage)}.</p>` : ""}<p class="field-error">${escape(doc.workerError || "The render stopped. Saved work is retained.")}</p></section>${adapting ? '<p class="small recovery-notice">Automatic recovery is working on this request using saved work.</p>' : ""}` : "";
    return `<article class="queue-card" data-prompt="${id}"><div class="queue-heading"><div>${badge(recoveryStatus(doc))} ${songBadges(doc)}<h2>${escape(doc.prompt)}</h2>${authoredByLine(doc.authoredBy, escape)}<p class="small">Received ${date(doc.confirmedAt)} · Priority ${doc.priority}${requestId ? "" : ` · <a href="/admin/${encodeURIComponent(doc.id)}">Permalink</a>`}</p></div>${doc.status === "queued" ? `<form data-action="priority" class="priority-form"><label for="priority-${id}">Priority</label><div><input id="priority-${id}" name="priority" type="number" min="-10000" max="10000" step="1" value="${doc.priority}" required><button class="quiet">Set</button></div></form>` : ""}</div>${gpuWaitNotice(doc)}${qualityNotice(doc.result?.qualityIssues, doc.reviewState, doc.result?.validationFailures, doc.repairedAt ?? doc.result?.repairedAt)}${needsReview(doc) ? '<form data-action="keep" class="retry-form"><button class="primary">Keep this version</button><span class="small">Clear the review flag after listening.</span></form><form data-action="regenerate" class="retry-form"><button class="quiet">Regenerate</button><span class="small">Review the same brief as a new request. This recording stays up until you send the new request to the queue; then it is archived and leaves the site.</span></form><form data-action="archive" class="retry-form"><button class="quiet">Archive</button><span class="small">Take this recording down now, with no replacement queued. Votes and plays are kept, and it can be restored from Published songs.</span></form>' : ""}${failure}${support}${thread}${logsSlot}${promptSummary(doc.details || {}, escape)}<details class="admin-brief"><summary>Open brief & controls <span class="disclosure-icon" aria-hidden="true"></span></summary>${brief({ ...doc, result: null, qualityIssues: null, validationFailures: null, reviewState: null, workerError: doc.status === "failed" ? null : doc.workerError }, false)}<form data-action="note"><label for="note-${id}">Private admin note</label><textarea id="note-${id}" name="note" rows="2" maxlength="2000">${escape(doc.adminNote || "")}</textarea><button class="quiet">Save note</button></form>${allowed.length ? `<form data-action="status" class="status-form"><label for="status-${id}">Move request to</label><select id="status-${id}" name="status" required><option value="" disabled selected>Choose a status</option>${allowed.map((status) => `<option value="${status}">${labels[status]}</option>`).join("")}</select><label class="publish-field" hidden>Published song URL<input name="publishedUrl" type="url" placeholder="https://yehry3.app/…"></label><button class="primary">Update status</button></form>` : ""}${doc.publishedUrl ? `<p><a href="${escape(safeUrl(doc.publishedUrl))}" target="_blank" rel="noopener">Open published song ↗</a></p>` : ""}<h3 class="history-title">Activity</h3><ol class="history">${[
      ...(doc.history || []),
    ]
      .reverse()
      .map(
        (entry) =>
          `<li><time>${date(entry.at)}</time><span>${escape(entry.actor)} · ${escape(entry.action)}${entry.status ? ` → ${escape(labels[entry.status] || entry.status)}` : ""}${entry.priority !== undefined ? ` → ${entry.priority}` : ""}</span></li>`,
      )
      .join("")}</ol></details></article>`;
  }
  if (!signedIn("admin")) loginView("admin", load);
  else await load();
  scope.every(() => {
    if (signedIn("admin") && !document.hidden && !document.activeElement?.matches("input, textarea, select") && !$(".queue-card details[open]") && !$('.support-report:not([hidden])')) load();
  }, 30000);
  scope.every(() => {
    if (signedIn("admin") && !document.hidden && data) loadThreads(true);
  }, 15000);
  scope.onLeave(() => { clearTimeout(songTimer); });
}

async function mountPage() {
  page = document.body.dataset.page;
  document.querySelector(`[data-nav="${page}"]`)?.setAttribute("aria-current", "page");
  mountModelInfo();
  mountBadgeSounds();
  try {
    if (page !== "queue") watchCompletions();
    if (page === "requests") await requests();
    else if (page === "admin") await admin();
    else if (page === "queue")
      await publicQueue(main, { escape, date, badge, safeUrl });
    else if (page === "queue-details")
      await queueDetailsPage(main, { escape, date, badge, safeUrl });
    else if (page === "lyrics") await lyricsPage(main, { escape, safeUrl });
    else if (page === "original-prompt")
      await originalPromptPage(main, { escape, safeUrl });
    else await library();
  } catch (error) {
    message(error.message, true);
  }
}
definePage(import.meta.url, mountPage);
