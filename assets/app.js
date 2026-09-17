import { musicBackendBadge } from "./music-provenance.js";
import { mountMusicBackend, paidConfirmation, PAID_BACKEND } from './music-backend.js';
import { gpuWaiting, gpuWaitNotice } from "./gpu-status.js";
import { mountGeneration, mountGenerationReview } from './generation.js';
import { songPlanLink } from "./song-plan.js";
import { brandLine } from "./branding.js";
import { mountMaterials, materialBrief, durationIssue, hasMaterialEdits } from "./request-materials.js";
import { requestPromptBrief, promptSummary } from "./prompt-brief.js";
import { mountRequestTabs } from "./request-tabs.js";
import { authoredByLine, authorField, savedAuthor, rememberAuthor } from "./authored-by.js";
import { recoveryActive, recoveryStatus } from "./recovery.js";
import { publicQueue, queueDetailsPage, queueItemHref } from "./queue.js";
import { mountQualitySettings, qualityNotice } from "./quality.js";
import { modelInfoButton, mountModelInfo, voiceVersionLabel } from "./model-info.js";
import { lyricsPage } from "./lyrics.js";
import { lyricsHref } from "./song-links.js";
import { originalPromptPage } from "./original-prompt.js";
import { rotateSuggestions } from "./suggestions.js";
import { startRecordMotion } from "./record-motion.js";
import { api, login, logout, signedIn, loginPersistence, storage } from "./api.js";
import { loadBasisSongs, mountBasisPicker } from "./basis.js";
import { watchCompletions } from "./notifications.js";
import { mountFavorites } from "./favorites.js";
import { trackListening, listeningLabel } from "./listening.js";
import { loadRemix, remixLink } from "./remix.js";
import { recordingLabels, recordingLabel, recordingTitle } from "./recording-label.js";

const $ = (selector, root = document) => root.querySelector(selector);
const main = $("#main");
const page = document.body.dataset.page;
mountModelInfo();
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
  failed: "Needs attention",
  attention: "Needs attention",
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
  `<span class="badge ${escape(status)}">${escape(labels[status] || status)}</span>`;
let voiceModels = [
  { id: "v6", label: "Tony V6", note: "Established expressive catalog profile", experimental: false },
  { id: "v7", label: "Tony V7", note: "Separate fresh-catalog adapter and references", experimental: true },
];
const voiceModel = (id) =>
  voiceModels.find((model) => model.id === id) || (/^v\d+$/i.test(id || "")
    ? { id, label: `Tony ${id.toUpperCase()}`, note: "Versioned Tony voice profile", experimental: id !== "v6" }
    : voiceModels[0]);
const voiceModelBadge = (id) => escape((/^v\d+$/i.test(id || "") ? id : "v6").toUpperCase());
const voiceModelBadgeClass = (id) => /^v[78]$/i.test(id || "") ? " " + id.toLowerCase() : "";
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
const message = (text, error = false) => {
  const region = $("#message");
  region.textContent = text;
  region.classList.toggle("error", error);
};
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
document
  .querySelector(`[data-nav="${page}"]`)
  ?.setAttribute("aria-current", "page");

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
  return `<div class="track-meta"><span class="track-collections">${escape(
    collections(song)
      .map((name) => collectionNames[name] || name)
      .join(" / "),
  )}</span>${authoredByLine(song.authoredBy, escape)}<span class="voice-model-badge${voiceModelBadgeClass(song.voiceModel)}">${voiceModelBadge(song.voiceModel)}</span>${musicBackendBadge(song)}<span class="track-duration">${duration(song.duration)}</span>${publishedAt ? `<time class="track-age" datetime="${escape(publishedAt)}" title="Released ${escape(date(publishedAt))}">${releaseAge}</time>` : `<span class="track-age" title="Exact release time unavailable">${releaseAge}</span>`}${(song.lyrics?.text || song.hasLyrics) ? `<a class="text-link" href="${lyricsHref(song)}" aria-label="Lyrics for ${escape(song.title)}">Lyrics ↗</a>` : ""}${songPlanLink(song, escape)}${(song.originalPrompt || song.hasOriginalPrompt) ? `<a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}" aria-label="Original prompt for ${escape(song.title)}">Original prompt ↗</a>` : ""}</div>`;
}

async function library() {
  const listeningOverview = `<details class="listening-overview"><summary>Listening activity</summary><div class="listening-body"><div class="listening-heading"><p class="small" id="listening-scope">Loading listening stats…</p><button type="button" class="quiet" id="most-listened" aria-pressed="false">Most listened to ↗</button></div><dl class="listening-totals"><div><dt>Total listens</dt><dd id="listening-total">—</dd></div><div><dt>Songs listened to</dt><dd id="listening-reach">—</dd></div><div><dt>Latest listen</dt><dd id="listening-latest">—</dd></div></dl></div></details>`;
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">Tony C · The listening room</p><h1 data-brand-headline>${escape(brandLine.split("\n")[0])}<br><em>${escape(brandLine.split("\n")[1])}</em></h1>
        <p class="lede">Originals, remixes, and beautiful wrong turns. Find a favorite. Dream up the next one.</p>
        <div class="actions"><button class="primary" id="play-all">Play the collection <span aria-hidden="true">↗</span></button><a class="text-link" href="/mixtapes/">Make a mixtape →</a></div>
      </div>
      <div class="sleeve" aria-label="Tony C record sleeve"><div class="sleeve-top"><span>YEHRY3 RECORDS</span><span>VOL. 01</span></div><div class="record"><div class="record-label"><span>TONY C</span><small>& THE POSSIBILITIES</small><i></i><span class="label-bottom">PLAY IT LOUD</span></div></div><img class="band-cutout" src="/assets/band-vinyl-v1.webp" width="1000" height="493" alt="Six band members emerge from the vinyl in a cut-paper photo collage." fetchpriority="high"><img class="sleeve-shoes" src="/assets/record-shoes.svg" width="420" height="270" alt="A pair of worn lace-up shoes on the record cover."><div class="sleeve-bottom"><span>FAMILIAR VOICE.<br>UNFAMILIAR TERRITORY.</span><span class="stamp">Give it<br>a spin.</span></div></div>
    </section>
    <section class="collection" aria-labelledby="collection-title">
      <div class="section-heading"><h2 id="collection-title">Pick your next obsession.</h2><div class="catalog-status"><p class="small" id="track-count">Loading songs…</p><p class="small auto-refresh-note"><span aria-hidden="true">↻</span> Auto-refreshes every 30 seconds</p></div></div>
      <details class="catalog-filters"><summary><span>Search &amp; filters</span><span id="active-filters" hidden></span></summary>
      <div class="toolbar"><label class="search"><span class="sr-only">Search songs</span><input type="search" id="search" placeholder="Search songs or styles…"></label><label class="sr-only" for="collection-filter">Collection</label><select id="collection-filter"><option value="all">All collections</option><option value="tonyai">Tony AI</option><option value="fearhunger">Fear & Hunger</option><option value="distonyc">Distonyc requests</option><option value="shiablo">Shiablo: The Lord of Prisoners</option></select><label class="sr-only" for="sort">Sort songs</label><select id="sort"><option value="hybrid">Fresh, then most loved</option><option value="catalog">Latest additions</option><option value="votes">Most loved</option><option value="title">A to Z</option><option value="plays">Most listened to</option><option value="least-played">Least listened to</option><option value="least-recent">Least recently played</option></select><button class="quiet" id="shuffle">Shuffle ↝</button><div class="display-settings" data-quality-settings></div></div></details>
      <div id="favorites"></div>${listeningOverview}<p class="small vote-note" id="vote-note">One anonymous vote per hour across the collection.</p><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1">← Previous page</button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1">Next page →</button></nav><div id="pending-tracks" aria-label="Songs on the way" hidden></div><div id="tracks" class="tracks"><p class="empty">Getting the records out…</p></div><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1">← Previous page</button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1">Next page →</button></nav><p class="small listening-note">Listens are recorded after 10 seconds of listening, once per browser per song every 30 minutes. History starts September 2026.</p>
    </section>
    <section class="request-banner"><p class="eyebrow">Distonyc</p><h2>Heard something<br>in your head?</h2><p><span data-suggestion>Medusa as a barbershop quartet?</span> Put it on the wish list.</p><a class="primary" href="/distonyc/">Pitch the next song <span aria-hidden="true">↗</span></a></section>
    <aside class="player" aria-label="Music player" hidden><div class="now-playing"><span class="eyebrow">On the turntable</span><strong id="now-title"></strong><span id="now-recording" hidden></span><span id="now-generator" hidden></span></div><button id="previous" class="quiet" aria-label="Previous song">←</button><audio id="audio" controls preload="none"></audio><button id="next" class="quiet" aria-label="Next song">→</button><a id="download" class="text-link" target="_blank" rel="noopener">MP3 ↗</a></aside>`;
  mountQualitySettings(main);
  startRecordMotion($(".record", main), $("#audio", main));
  rotateSuggestions(main);
  const filters = [
    { id: "collection-filter", param: "collection", defaultValue: "all" },
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
    queue = [],
    current = null,
    nextVoteAt = null,
    online = false,
    voting = false,
    refreshing = null;
  let initialCatalogPending = true;
  const recentReleases = new Map();
  const freshWindow = 24 * 60 * 60 * 1000;
  const audio = $("#audio");
  const rowMarkup = new WeakMap();
  const favorites = mountFavorites($("#favorites"), { filter: true, onChange: () => {
    // Favorite history callbacks may run before our popstate listener. Restore
    // all URL filters together before clamping the requested page.
    restoreFilters(false);
    render({ preserveViewport: true });
  } });
  const listening = trackListening(audio, {
    source: "main", send: (body) => api("/listens", { method: "POST", body }),
    onRecorded: (id, { playCount, lastPlayedAt }) => {
      const song = songs.find((item) => item.id === id);
      if (song) Object.assign(song, { playCount, lastPlayedAt });
      render({ preserveViewport: true });
    },
  });
  document.querySelectorAll("[data-catalog-pagination]").forEach((nav) => {
    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-catalog-page]");
      if (!button || button.disabled) return;
      editingSearch = false;
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
      ...eligible.filter((song) => song.status !== "failed").slice(0, Math.max(0, 3 - failures.length)),
    ];
    const container = $("#pending-tracks");
    container.hidden = !rows.length;
    syncRows(container, rows.map((song) => {
      const percent = Math.max(0, Math.min(100, Number(song.progress?.percent) || 0));
  return `<details class="pending-track" data-id="${escape(song.id)}"><summary><span class="pending-mark" aria-hidden="true">↗</span><span class="pending-title"><span class="tiny-label">${gpuWaiting(song) ? "Waiting for the GPU" : recoveryActive(song) ? "Recovering automatically" : song.status === "failed" ? "Needs attention" : "On the way"} · ${voiceModelBadge(song.voiceModel)}</span><strong>${escape(song.title || song.idea)}</strong>${authoredByLine(song.authoredBy, escape)}${musicBackendBadge(song)}</span><span class="pending-state">${badge(recoveryStatus(song))}${song.progress && song.status !== "failed" ? `<span class="small">${Math.round(percent)}%</span>` : ""}</span></summary><div class="pending-body"><p>${escape(song.idea)}</p>${song.status === "failed" ? '<p class="attention-note">Completed work is saved; retry resumes completed stages.</p>' : song.progress ? `<p class="small">${escape(song.progress.stage)} · ${Math.round(percent)}%</p><progress max="100" value="${percent}" aria-label="Song production progress"></progress>` : ""}<div class="actions"><a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}">View original prompt ↗</a>${songPlanLink(song, escape)}<a class="text-link" href="${queueItemHref(song)}">View request details ↗</a></div></div></details>`;
    }).join(""));
  }
  function render({ preserveViewport = false } = {}) {
    const restoreViewport = preserveViewport ? viewportAnchor() : () => {};
    const activeFilters = [];
    if ($("#search").value) activeFilters.push(`Search: “${$("#search").value}”`);
    if ($("#collection-filter").value !== "all")
      activeFilters.push($("#collection-filter").selectedOptions[0].textContent);
    if (favorites.onlySaved) activeFilters.push("Saved songs");
    if ($("#sort").value !== "hybrid")
      activeFilters.push(`Sort: ${$("#sort").selectedOptions[0].textContent}`);
    const filterSummary = $("#active-filters");
    filterSummary.hidden = !activeFilters.length;
    filterSummary.innerHTML = activeFilters.map((label) => `<span class="active-filter">${escape(label)}</span>`).join("");
    const recordings = recordingLabels(songs, (song) => songPublishedAt(song, recentReleases.get(song.id)));
    const currentRecording = recordings.get(current?.id);
    $("#now-recording").hidden = !currentRecording;
    $("#now-recording").innerHTML = recordingLabel(currentRecording, escape);
    const generator = musicBackendBadge(songs.find(song => song.id === current?.id) || current);
    $("#now-generator").innerHTML = generator;
    $("#now-generator").hidden = !generator;
    const query = $("#search").value.toLowerCase();
    const collection = $("#collection-filter").value;
    visible = songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) &&
        (collection === "all" || collections(song).includes(collection)) && favorites.includes(song),
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
            ) => `<article class="track ${current?.id === song.id ? "playing" : ""}" data-id="${escape(song.id)}">
        <span class="track-number">${String(offset + index + 1).padStart(2, "0")}</span><button class="play-song" data-play="${escape(song.id)}" aria-label="Play ${escape(recordingTitle(song, recordings.get(song.id)))}">▶</button><div class="track-info"><div class="track-heading"><h3>${escape(song.title)}</h3>${recordingLabel(recordings.get(song.id), escape)}</div>${songMeta(song, recentReleases.get(song.id))}<p class="small track-listening" title="${escape(song.lastPlayedAt ? `Last listened ${date(song.lastPlayedAt)}` : "Listening history starts September 2026")}">${escape(listeningLabel(song))}</p>${qualityNotice(song.qualityIssues)}</div><span class="vote-hint" role="group"><button class="vote ${Number(song.votes) > 0 ? "has-votes" : ""}" data-vote="${escape(song.id)}" aria-label="Vote for ${escape(recordingTitle(song, recordings.get(song.id)))}"><span aria-hidden="true">${Number(song.votes) > 0 ? "♥" : "♡"}</span> <span>${online ? song.votes || 0 : "—"}</span></button><span class="vote-tooltip" role="tooltip" id="vote-tip-${escape(song.id)}"></span></span></article>`,
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
    if (favorites.onlySaved) $("#pending-tracks").hidden = true;
    $("#play-all").disabled = !visible.length;
    $("#shuffle").disabled = !visible.length;
    cooldown();
    restoreViewport();
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
  }
  async function play(song, newQueue) {
    if (!song) return;
    if (newQueue) queue = [...newQueue];
    current = song;
    $(".player").hidden = false;
    $("#now-title").textContent = song.title;
    $("#download").href = safeUrl(song.url);
    audio.src = safeUrl(song.url);
    listening.start(song.id);
    render();
    try {
      await audio.play();
    } catch {
      message("Press play in the player to start this song.");
    }
  }
  function next(offset) {
    const index = queue.findIndex((song) => song.id === current?.id) + offset;
    if (index >= 0 && index < queue.length) play(queue[index]);
  }
  $("#tracks").addEventListener("click", async (event) => {
    const playButton = event.target.closest("[data-play]");
    if (playButton)
      return play(
        songs.find((song) => song.id === playButton.dataset.play),
        visible,
      );
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
    if (document.hidden) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const [catalog, upcoming] = await Promise.allSettled([api("/songs/summary"), api("/queue?page=0")]);
      if (catalog.status === "fulfilled" && catalog.value.songs?.length) {
        songs = catalog.value.songs;
        nextVoteAt = catalog.value.nextVoteAt;
        online = true;
      } else online = false;
      initialCatalogPending = false;
      if (upcoming.status === "fulfilled" && Array.isArray(upcoming.value.inStudio) && Array.isArray(upcoming.value.queued)) {
        pending = [...upcoming.value.inStudio, ...(upcoming.value.needsAttention || []), ...upcoming.value.queued];
        recentReleases.clear();
        for (const song of upcoming.value.recent || [])
          if (song.id && song.publishedAt) recentReleases.set(song.id, song.publishedAt);
      }
      render({ preserveViewport: true });
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  for (const id of ["collection-filter", "sort"])
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
  window.addEventListener("popstate", () => {
    restoreFilters();
    render();
  });
  window.addEventListener("pageshow", (event) => {
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
  $("#previous").onclick = () => next(-1);
  $("#next").onclick = () => next(1);
  audio.onended = () => next(1);
  audio.onerror = () =>
    message(
      "This track could not load. Try another song or open its MP3 link.",
      true,
    );
  try {
    songs = (await (await fetch("/catalog-summary.json")).json()).songs;
  } catch {
    message("The catalog could not load. Refresh to try again.", true);
  }
  render();
  await refresh();
  setInterval(cooldown, 15000);
  let refreshTimer = setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("pagehide", () => clearInterval(refreshTimer));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, 30000);
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
  let draft = null;
  let remix = null, remixUsed = false, remixActive = false;
  function finishRemix() {
    remixUsed = true; remixActive = false; storage.remove("remix-idea");
    const url = new URL(location.href); url.searchParams.delete("remix");
    history.replaceState(history.state, "", url);
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
    render();
  }
  function render(mode) {
    const stage =
      mode ||
      (draft?.confirmedAt
        ? "submitted"
        : draft?.status === "review" && !hasMaterialEdits(draft, storage)
          ? "review"
          : draft
            ? "details"
            : "idea");
    const number = { idea: 1, details: 2, review: 3, submitted: 3 }[stage];
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
        reviewList.querySelectorAll('[data-review-request]').forEach((button) => { button.onclick = () => { storage.set('draft', button.dataset.reviewRequest); load(); }; });
      }).catch(() => {});
    }

    if (remix && !remixUsed) {
      const panel = document.createElement("div");
      panel.className = "remix-note";
      if (remix.unavailable) panel.innerHTML = `<p class="field-error" role="alert">${escape(remix.message)}</p><p class="small">The remix has not been submitted. <a href="/distonyc/">Start a different request</a>.</p>`;
      else {
        const linkedDraft = draft && storage.get(`remix-draft:${draft.id}`) === remix.id;
        const conflict = draft ? !linkedDraft : !remixActive;
        panel.innerHTML = `<p class="small">Remix of <a href="/lyrics/?song=${encodeURIComponent(remix.id)}">${escape(remix.title)}</a>: a new arrangement guided by the original. Melody and timing may change. ${linkedDraft ? "Choose the new sound and whether lyrics may change, then review your request." : "Edit the idea and tell us what should change."}</p>${conflict ? `<button type="button" class="quiet" id="begin-remix">${draft ? "Start this remix as a new request" : "Use the remix idea instead"}</button><p class="small">${draft ? "Your current request stays saved in the studio." : "This replaces the idea currently in the form."}</p>` : ""}`;
        panel.querySelector("#begin-remix")?.addEventListener("click", () => {
          draft = null; storage.remove("draft"); storage.remove("prompt-request");
          storage.set("idea-text", remix.seed.prompt); storage.set("remix-idea", remix.id); remixActive = true; render();
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
    if (stage === "idea") {
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
          if (remixActive && !remixUsed && remix?.seed) storage.set(`remix-draft:${draft.id}`, remix.id);
          storage.remove("prompt-request");
          render();
        });
    } else if (stage === "details") {
      const remixDetails = !remixUsed && remix?.seed && storage.get(`remix-draft:${draft.id}`) === remix.id ? remix.seed : {};
      const initialDetails = draft.status === "draft" ? { ...draft.details, ...remixDetails } : draft.details || {};
      form.innerHTML = `<p class="eyebrow">Turn 02 · Optional refinements</p><h2>Here’s what I’m hearing.</h2><blockquote>${escape(draft.prompt)}</blockquote><p>Choose the Tony voice. Open Advanced to add a sound, lyrics, references, or basis songs.</p>
        <form id="details-form">${authorField}
          <div class="request-tabs" role="tablist" aria-label="Request refinements">
            <button type="button" role="tab" id="essentials-tab" aria-controls="essentials-panel" aria-selected="true">Essentials</button>
            <button type="button" role="tab" id="advanced-tab" aria-controls="advanced-panel" aria-selected="false" tabindex="-1">Advanced</button>
          </div>
          <div role="tabpanel" id="essentials-panel" aria-labelledby="essentials-tab">
            <div id="music-backend-root"></div>
            <div class="voice-model-label"><label for="voice-model">Tony voice model</label>${modelInfoButton()}</div>
            <select id="voice-model" name="voiceModel">${voiceModels.map((model) => `<option value="${escape(model.id)}">${escape(voiceModelLabel(model.id))}</option>`).join("")}</select><p class="small voice-model-note"></p>
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
      mountRequestTabs($("#details-form"), storage, draft.id);
      const generation = mountGeneration($("#generation-root"), { draft: { ...draft, details: initialDetails }, schema: generationSchema, enabled: generationAvailable, storage, escape });
      $("#authored-by").value = draft.authoredBy || "";
      $("#authored-by").oninput = (event) => rememberAuthor(event.target.value);
      const selectedBasis = mountBasisPicker(
        $("#basis-root"),
        basisSongs,
        initialDetails.basisSongIds || [],
      );
      const attachedRemix = initialDetails.remixSource;
      if (attachedRemix) {
        $("#basis-root").innerHTML = `<p class="small" data-remix-source>Recording attached: <a href="/lyrics/?song=${encodeURIComponent(attachedRemix.songId)}">${escape(attachedRemix.title)}</a>. Its vocals guide the new arrangement; exact melody and timing may change.</p>`;
        $("#essentials-panel").insertAdjacentHTML("afterbegin", $("#basis-root").innerHTML);
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
      const initialVoice = /^v[678]$/.test(savedVoice || '') ? savedVoice : initialDetails.voiceModel;
      if (initialVoice && !voiceModels.some(model => model.id === initialVoice)) {
        const unavailable = new Option(`${voiceModelLabel(initialVoice)} · temporarily unavailable`, initialVoice);
        unavailable.disabled = true; $("#voice-model").append(unavailable);
      }
      const defaultVoice = voiceModels.find((model) => model.id === "v8" && generationAvailable)
        || voiceModels.find((model) => model.id === "v7") || voiceModels[0];
      $("#voice-model").value = initialVoice || defaultVoice.id;
      const describeVoice = () => {
        const model = voiceModel($("#voice-model").value);
        generation.setRequired(model.id === "v8");
        $(".voice-model-note").textContent = `${model.note}.${model.experimental ? " This voice is still being evaluated." : ""}`;
      };
      $("#voice-model").onchange = () => { storage.set(voiceDraftKey, $("#voice-model").value); describeVoice(); };
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
      if (materialIssue) {
        $("#confirm-form .primary").disabled = true;
        $("#confirm-form .field-error").textContent = materialIssue;
      }
      $("#edit").onclick = () => render("details");
      $("#confirm-form").onsubmit = (event) =>
        run(event, async () => {
          draft = (
            await api(`/prompts/${encodeURIComponent(draft.id)}/confirm`, {
              method: "POST",
              role: "submitter",
              body: {
                version: draft.version,
                confirmed: true,
                ...(draft.details?.musicBackend === PAID_BACKEND ? { confirmedPaid: $('#confirm-paid').checked, paidPassword: $('#paid-password').value } : {}),
              },
            })
          ).prompt;
          storage.remove("idea-text");
          render();
        });
    } else {
      form.innerHTML = `<span class="success-mark" aria-hidden="true">✓</span><p class="eyebrow">Request received</p><h2>Your idea is on the list.</h2><p>Your idea has a place in the studio queue. Check back here for its progress.</p>${badge(recoveryStatus(draft))} ${musicBackendBadge(draft)}${recoveryActive(draft) ? '<p class="small">Automatic recovery is working on your song. Saved work will be reused.</p>' : ""}${brief(draft)}${draft.publishedUrl ? `<a class="primary" href="${escape(safeUrl(draft.publishedUrl))}" target="_blank" rel="noopener">Hear your song ↗</a>` : ""}<div class="actions"><button class="quiet" id="refresh-status">Refresh status</button><button class="primary" id="another">Another idea ↗</button></div><p class="small">This browser tab remembers your request. <a href="/queue/">Watch the public queue and enable completion alerts →</a></p>`;
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
  return `${showGpuWait ? gpuWaitNotice(doc) : ""}${requestPromptBrief(doc, escape, voiceModelLabel)}${qualityNotice(doc.result?.qualityIssues || doc.qualityIssues)}${doc.workerProgress ? `<p class="small">${escape(doc.workerProgress.stage)}${doc.status !== "failed" && doc.workerProgress.percent ? ` · ${Math.round(doc.workerProgress.percent)}%` : ""}</p>` : ""}${doc.workerError ? `<p class="field-error">${escape(doc.workerError)}</p>` : ""}`;
}

async function admin() {
  const adminParams = new URLSearchParams(location.search);
  const requestedFilter = adminParams.get("status") === "failed" ? "attention" : adminParams.get("status");
  const sortOptions = { newest: "Newest first", oldest: "Oldest first", priority: "Queue priority" };
  const validFilters = ["all", ...Object.keys(labels).filter((key) => !["draft", "review"].includes(key))];
  let data = null,
    filter = validFilters.includes(requestedFilter) ? requestedFilter : "queued",
    sortOrder = Object.hasOwn(sortOptions, adminParams.get("sort")) ? adminParams.get("sort") : "newest",
    pageNumber = 0,
    loadSequence = 0;
  async function load() {
    const sequence = ++loadSequence;
    try {
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
      message(error.message, true);
      if (!data)
        main.innerHTML =
          '<section class="empty"><h1>The queue couldn’t load.</h1><button class="primary" id="retry-admin">Try again</button></section>';
      $("#retry-admin")?.addEventListener("click", load);
    }
  }
  function render() {
    main.innerHTML = `<section class="admin-intro"><div><p class="eyebrow">Backstage · Studio queue</p><h1>Make room for<br><em>the next one.</em></h1></div><button class="quiet" id="signout">Sign out ↗</button></section><div class="stats">${[
      ["queued", "Waiting in line"],
      ["processing", "In the studio"],
      ["attention", "Needs Attention"],
      ["recovering", "Recovering automatically"],
      ["completed", "Ready to publish"],
      ["published", "Out in the world"],
    ]
      .map(
        ([status, label]) =>
          ["attention", "recovering"].includes(status)
            ? `<a href="/admin/?status=${status}"><strong>${data.counts[status] ?? (status === "attention" ? data.counts.failed || 0 : 0)}</strong><span>${label}</span></a>`
            : `<div><strong>${data.counts[status] || 0}</strong><span>${label}</span></div>`,
      )
      .join(
        "",
      )}</div><p class="small worker-health">${data.workers?.length ? data.workers.map((worker) => `PC worker: ${escape(worker.stage)} · Last seen ${date(worker.lastSeenAt)}${Date.now() - new Date(worker.lastSeenAt) > 5 * 60000 ? " · Offline or paused" : ""}`).join("<br>") : "PC worker: waiting for its first connection."}</p><section class="admin-queue"><div class="toolbar"><label for="status-filter">Show</label><select id="status-filter"><option value="all">All requests</option>${Object.entries(
      labels,
    )
      .filter(([key]) => !["draft", "review", "failed"].includes(key))
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join(
        "",
      )}</select><label for="admin-sort">Sort</label><select id="admin-sort">${Object.entries(sortOptions).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select><button class="quiet" id="refresh">Refresh ↻</button><span class="small">${data.total} requests · ${sortOrder === "priority" ? "Higher priority first; oldest wins ties." : sortOrder === "oldest" ? "Earliest submissions first." : "Latest submissions first."}</span></div><div id="queue">${data.prompts.length ? data.prompts.map(row).join("") : `<div class="empty"><span class="empty-symbol">◎</span><h2>A little room for possibility.</h2><p>No requests in this view yet.</p>${filter === "all" ? '<a class="text-link" href="/distonyc/">Make the first request →</a>' : '<a class="text-link" href="/admin/?status=all">All requests →</a>'}</div>`}</div><div class="pagination"><button class="quiet" id="prev-page" ${pageNumber === 0 ? "disabled" : ""}>← Previous</button><span>Page ${pageNumber + 1}</span><button class="quiet" id="next-page" ${(pageNumber + 1) * 50 >= data.total ? "disabled" : ""}>Next →</button></div></section>`;
    showLoginStatus("admin", $(".admin-intro > div"), load);
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
    $("#signout").onclick = () => {
      loadSequence++;
      logout("admin");
      data = null;
      loginView("admin", load);
    };
    $("#prev-page").onclick = () => {
      pageNumber--;
      load();
    };
    $("#next-page").onclick = () => {
      pageNumber++;
      load();
    };
    $("#queue").addEventListener("submit", async (event) => {
      event.preventDefault();
      const card = event.target.closest("[data-prompt]");
      const doc = data.prompts.find((item) => item.id === card.dataset.prompt);
      const kind = event.target.dataset.action;
      const body = { action: kind, version: doc.version };
      if (kind === "priority")
        body.priority = Number($('[name="priority"]', event.target).value);
      if (kind === "note") body.note = $('[name="note"]', event.target).value;
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
      const button = $("button", event.target);
      busy(button, true);
      try {
        await api(`/admin/prompts/${encodeURIComponent(doc.id)}`, {
          method: "PATCH",
          role: "admin",
          body,
        });
        message("Queue updated.");
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
    return `<article class="queue-card" data-prompt="${id}"><div class="queue-heading"><div>${badge(recoveryStatus(doc))} ${musicBackendBadge(doc)}<h2>${escape(doc.prompt)}</h2>${authoredByLine(doc.authoredBy, escape)}<p class="small">Received ${date(doc.confirmedAt)} · Priority ${doc.priority}</p></div>${doc.status === "queued" ? `<form data-action="priority" class="priority-form"><label for="priority-${id}">Priority</label><div><input id="priority-${id}" name="priority" type="number" min="-10000" max="10000" step="1" value="${doc.priority}" required><button class="quiet">Set</button></div></form>` : ""}</div>${gpuWaitNotice(doc)}${qualityNotice(doc.result?.qualityIssues)}${doc.status === "failed" ? `${recoveryActive(doc) ? '<p class="small recovery-notice">Automatic recovery is working on this request. Saved work will be reused; you can leave it running.</p>' : ""}<p class="field-error">${escape(doc.workerError || "The render stopped. Saved work is retained.")}</p>${allowed.includes("queued") && !recoveryActive(doc) ? `<form data-action="status" class="retry-form"><input type="hidden" name="status" value="queued"><button class="primary">Retry saved work</button><span class="small">Completed stages will be reused.</span></form>` : ""}` : ""}${promptSummary(doc.details || {}, escape)}<details class="admin-brief"><summary>Open brief & controls <span class="disclosure-icon" aria-hidden="true"></span></summary>${brief({ ...doc, result: null, qualityIssues: null, workerError: doc.status === "failed" ? null : doc.workerError }, false)}<form data-action="note"><label for="note-${id}">Private admin note</label><textarea id="note-${id}" name="note" rows="2" maxlength="2000">${escape(doc.adminNote || "")}</textarea><button class="quiet">Save note</button></form>${allowed.length ? `<form data-action="status" class="status-form"><label for="status-${id}">Move request to</label><select id="status-${id}" name="status" required><option value="" disabled selected>Choose a status</option>${allowed.map((status) => `<option value="${status}">${labels[status]}</option>`).join("")}</select><label class="publish-field" hidden>Published song URL<input name="publishedUrl" type="url" placeholder="https://yehry3.app/…"></label><button class="primary">Update status</button></form>` : ""}${doc.publishedUrl ? `<p><a href="${escape(safeUrl(doc.publishedUrl))}" target="_blank" rel="noopener">Open published song ↗</a></p>` : ""}<h3 class="history-title">Activity</h3><ol class="history">${[
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
  setInterval(() => {
    if (signedIn("admin") && !document.hidden && !document.activeElement?.matches("input, textarea, select") && !$(".queue-card details[open]")) load();
  }, 30000);
}

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
