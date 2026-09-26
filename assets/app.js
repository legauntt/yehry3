import { songBadges } from "./song-badges.js";
import { gpuWaiting } from "./gpu-status.js";
import { songPlanLink } from "./song-plan.js";
import { brandLine } from "./branding.js";
import { authoredByLine } from "./authored-by.js";
import { recoveryActive, recoveryStatus } from "./recovery.js";
import { queueItemHref } from "./queue-links.js";
import { mountQualitySettings, qualityNotice } from "./quality.js";
import { mountModelInfo } from "./model-info.js";
import { rotateSuggestions } from "./suggestions.js";
import { startRecordMotion } from "./record-motion.js";
import { startRecordSinger } from "./record-singer.js";
import { api, storage } from "./api.js";
import { watchCompletions } from "./notifications.js";
import { mountFavorites } from "./favorites.js";
import { listeningLabel } from "./listening.js";
import { player } from "./player.js";
import { setRecordingLabel } from "./player-bar.js";
import { definePage } from "./shell.js";
import { currentScope } from "./page-scope.js";
import { remixBadge, remixLink } from "./remix.js";
import { recordingLabels, recordingLabel, recordingTitle } from "./recording-label.js";
import { mountCatalogView } from "./catalog-view.js";
import { mountCatalogTools } from "./catalog-tools.js";
import { mountSongMenus } from "./song-menu.js";
import { decorateSongLinks, mountSongLinkTooltips } from "./song-link-icons.js";
import { hasCustomArtwork, songArtworkMarkup } from "./song-art.js";
import { watchCatalog } from "./realtime.js";
import { announceAttention, mountBadgeSounds } from "./badge-sound.js";
import { $, main, escape, date, badge, collections, message, busy, safeUrl, songPublishedAt, songMeta, songLinks } from "./app-ui.js";

async function library() {
  const scope = currentScope();
  const listeningOverview = `<details class="listening-overview"><summary>Listening activity</summary><div class="listening-body"><div class="listening-heading"><p class="small" id="listening-scope">Loading listening stats…</p><button type="button" class="quiet" id="most-listened" aria-pressed="false">Most listened to ↗</button></div><dl class="listening-totals"><div><dt>Total listens</dt><dd id="listening-total">—</dd></div><div><dt>Songs listened to</dt><dd id="listening-reach">—</dd></div><div><dt>Latest listen</dt><dd id="listening-latest">—</dd></div></dl></div></details>`;
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">Tony C · The listening room</p><h1 data-brand-headline>${escape(brandLine.split("\n")[0])}<br><em>${escape(brandLine.split("\n")[1])}</em></h1>
        <p class="lede">Originals, remixes, and beautiful wrong turns.</p>
      </div>
      <div class="sleeve" aria-label="Tony C record sleeve"><div class="sleeve-top"><span>YEHRY3 RECORDS</span><span>VOL. 01</span></div><div class="record"><div class="record-label"><span>TONY C</span><small>& THE POSSIBILITIES</small><i></i><span class="label-bottom">PLAY IT LOUD</span></div></div><img class="band-cutout" src="/assets/band-vinyl-v1.webp" width="1000" height="493" alt="Six band members emerge from the vinyl in a cut-paper photo collage." fetchpriority="high"><img class="sleeve-shoes" src="/assets/record-shoes.svg" width="420" height="270" alt="A pair of worn lace-up shoes on the record cover."><div class="sleeve-bottom"><span>FAMILIAR VOICE.<br>UNFAMILIAR TERRITORY.</span><span class="stamp">Give it<br>a spin.</span></div></div>
    </section>
    <section class="collection" aria-labelledby="collection-title">
      <div class="section-heading"><h2 id="collection-title">Pick your next obsession.</h2><div class="catalog-status"><p class="small" id="track-count">Loading songs…</p><p class="small auto-refresh-note"><span aria-hidden="true">↻</span> Refreshes every 30s</p></div></div>
      <div class="catalog-tools" role="group" aria-label="Collection controls">
      <details class="catalog-filters"><summary><span>Search &amp; filters</span><span id="filter-count" hidden></span></summary>
      <div class="catalog-filter-body"><div id="active-filters" hidden></div><div class="toolbar"><label class="search"><span class="sr-only">Search songs</span><input type="search" id="search" placeholder="Search songs or styles…"></label><label class="sr-only" for="collection-filter">Collection</label><select id="collection-filter"><option value="all">All collections</option><option value="tonyai">Tony AI</option><option value="fearhunger">Fear & Hunger</option><option value="distonyc">Distonyc requests</option><option value="shiablo">Shiablo: The Lord of Prisoners</option></select><label class="sr-only" for="feedback-filter">Listener feedback</label><select id="feedback-filter"><option value="all">Any feedback</option><option value="downvoted">Downvoted</option><option value="milquetoast">Milquetoasted</option></select><label class="sr-only" for="sort">Sort songs</label><select id="sort"><option value="hybrid">Fresh, then most loved</option><option value="catalog">Latest additions</option><option value="votes">Most loved</option><option value="title">A to Z</option><option value="plays">Most listened to</option><option value="least-played">Least listened to</option><option value="least-recent">Least recently played</option></select><button class="quiet" id="play-all">Play the collection ↗</button><button class="quiet" id="shuffle">Shuffle ↝</button></div></div></details>
      <div id="favorites"></div>${listeningOverview}<details class="catalog-voting"><summary>Voting</summary><div class="catalog-vote-body"><p class="small vote-note" id="vote-note">One anonymous vote per hour across the collection.</p></div></details><div class="display-settings" data-quality-settings></div></div><div class="catalog-view-bar"><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1" aria-label="Previous page">←<span class="page-direction"> Previous page</span></button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1" aria-label="Next page"><span class="page-direction">Next page </span>→</button></nav><div id="catalog-view-controls"></div></div><div id="catalog-items"><div id="pending-tracks" aria-label="Songs on the way" hidden></div><div id="tracks" class="tracks"><p class="empty">Getting the records out…</p></div></div><nav class="pagination catalog-pagination" data-catalog-pagination aria-label="Catalog pages" hidden><button class="quiet" data-catalog-page="-1" aria-label="Previous page">←<span class="page-direction"> Previous page</span></button><span data-page-status aria-live="polite"></span><button class="quiet" data-catalog-page="1" aria-label="Next page"><span class="page-direction">Next page </span>→</button></nav><p class="small listening-note">Listens are recorded after 10 seconds of listening, once per browser per song every 30 minutes. History starts September 2026.</p>
    </section>
    <section class="request-banner"><p class="eyebrow">Distonyc</p><h2>Heard something<br>in your head?</h2><p><span data-suggestion>Medusa as a barbershop quartet?</span> Put it on the wish list.</p><a class="primary" href="/distonyc/">Pitch the next song <span aria-hidden="true">↗</span></a></section>
`;
  $("#catalog-view-controls").innerHTML = `<div class="catalog-view-switch" role="group" aria-label="Song display"><button type="button" data-catalog-view="grid" aria-pressed="true" aria-controls="catalog-items"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/></svg>Grid</button><button type="button" data-catalog-view="list" aria-pressed="false" aria-controls="catalog-items"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 4H5M8 4H18M2 10H5M8 10H18M2 16H5M8 16H18"/></svg>List</button></div>`;
  mountCatalogView($(".catalog-view-switch"), $("#tracks"));
  const songMenus = mountSongMenus($("#tracks"), scope);
  mountSongLinkTooltips($("#tracks"), scope);
  mountQualitySettings(main);
  startRecordMotion($(".record", main), player.audio);
  rotateSuggestions(main);
  const filters = [
    { id: "collection-filter", param: "collection", defaultValue: "all" },
    { id: "feedback-filter", param: "feedback", defaultValue: "all" },
    { id: "sort", param: "sort", defaultValue: "hybrid" },
    { id: "search", param: "q", defaultValue: "" },
  ];
  const pageSize = 24;
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
  let cardsReady = false, partialTotal = null, startupPlayback = false;
  const defaultFilters = () => !$("#search").value && $("#collection-filter").value === "all"
    && $("#feedback-filter").value === "all" && $("#sort").value === "hybrid" && !favorites.onlySaved;
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
  function freshThenLoved(items) {
    const releasedAt = song => Date.parse(songPublishedAt(song, recentReleases.get(song.id))) || 0;
    const cutoff = Date.now() - freshWindow;
    return [...items].sort((a, b) => {
      const aReleased = releasedAt(a), bReleased = releasedAt(b);
      const aFresh = aReleased >= cutoff, bFresh = bReleased >= cutoff;
      if (aFresh !== bFresh) return bFresh - aFresh;
      if (aFresh && aReleased !== bReleased) return bReleased - aReleased;
      return (b.votes || 0) - (a.votes || 0);
    });
  }
  const audio = player.audio;
  const rowMarkup = new WeakMap();
  const favorites = mountFavorites($("#favorites"), { filter: true, onChange: () => {
    // Favorite history callbacks may run before our popstate listener. Restore
    // all URL filters together before clamping the requested page.
    restoreFilters(false);
    render({ preserveViewport: true });
  } });
  mountCatalogTools($(".catalog-tools"), scope);
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
    if (scope.left) return;
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
    const filterCount = $("#filter-count");
    filterCount.hidden = !activeFilters.length;
    filterCount.textContent = activeFilters.length;
    filterCount.setAttribute("aria-label", `${activeFilters.length} active filter${activeFilters.length === 1 ? "" : "s"}`);
    filterSummary.innerHTML = activeFilters.map((label) => `<span class="active-filter">${escape(label)}</span>`).join("");
    // A partial default page cannot answer searches, other sorts, or deep links.
    // Keep the requested filters/page intact until the full background read arrives.
    if (!cardsReady || (partialTotal !== null && (!defaultFilters() || catalogPage !== 1 || location.hash))) {
      visible = [];
      $("#tracks").setAttribute("aria-busy", "true");
      const loadingText = initialCatalogPending ? "Loading..." : "The full catalog is unavailable. Refresh to try again.";
      syncRows($("#tracks"), `<p class="empty" role="status">${loadingText}</p>`);
      $("#track-count").textContent = initialCatalogPending ? "Loading..." : "Catalog unavailable";
      $("#play-all").disabled = true;
      $("#shuffle").disabled = true;
      document.querySelectorAll("[data-catalog-pagination]").forEach(nav => { nav.hidden = true; });
      restoreViewport();
      return;
    }
    $("#tracks").setAttribute("aria-busy", "false");
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
    if ($("#sort").value === "hybrid") visible = freshThenLoved(visible);
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
    const hasStats = partialTotal === null && songs.some((song) => Number.isFinite(song.playCount)) &&
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
    const matchingTotal = partialTotal ?? visible.length;
    const pageCount = Math.max(1, Math.ceil(matchingTotal / pageSize));
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
      `${matchingTotal} ${matchingTotal === 1 ? "song" : "songs"}${pageSongs.length ? ` · Showing ${offset + 1}–${offset + pageSongs.length}` : ""}${partialTotal !== null ? " · Loading the rest…" : ""}`;
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
        <span class="track-number">${String(offset + index + 1).padStart(2, "0")}</span><button class="play-song" data-play="${escape(song.id)}" aria-label="Play ${escape(recordingTitle(song, recordings.get(song.id)))}" aria-pressed="false"><span class="play-icon" aria-hidden="true">▶</span><span class="pause-icon" aria-hidden="true">❚❚</span></button><div class="track-info"><div class="track-heading"><h3 title="${escape(song.title)}">${escape(song.title)}</h3>${remixBadge(song)}${recordingLabel(recordings.get(song.id), escape)}</div>${songMeta(song, recentReleases.get(song.id))}${qualityNotice(song.qualityIssues, song.reviewState, song.validationFailures, song.repairedAt)}<div class="song-menu"><button type="button" class="song-more" aria-label="More about ${escape(song.title)}" aria-expanded="false" aria-controls="song-menu-${escape(song.id)}" title="Song details and actions"><span aria-hidden="true">⋯</span></button><div class="song-menu-panel" id="song-menu-${escape(song.id)}" role="group" aria-label="Details and actions for ${escape(song.title)}"><p class="song-menu-title">${escape(recordingTitle(song, recordings.get(song.id)))}</p>${songLinks(song)}<p class="small track-listening" title="${escape(song.lastPlayedAt ? `Last listened ${date(song.lastPlayedAt)}` : "Listening history starts September 2026")}">${escape(listeningLabel(song))}</p><div class="song-actions" role="group" aria-label="Song actions">${pinButton(song)}${artButton(song)}<button type="button" class="song-action" data-feedback="downvote" data-song="${escape(song.id)}" ${song.feedback?.downvoted || !online ? "disabled" : ""}>${song.feedback?.downvoted ? "Downvoted" : "Downvote"}${Number(song.downvotes) ? ` · ${song.downvotes}` : ""}</button><button type="button" class="song-action" data-feedback="milquetoast" data-song="${escape(song.id)}" ${song.feedback?.milquetoast || !online ? "disabled" : ""}>${song.feedback?.milquetoast ? "Sent to agent" : "Milquetoast"}${Number(song.milquetoasts) ? ` · ${song.milquetoasts}` : ""}</button></div></div></div></div><span class="vote-hint" role="group"><button class="vote ${Number(song.votes) > 0 ? "has-votes" : ""}" data-vote="${escape(song.id)}" aria-label="Vote for ${escape(recordingTitle(song, recordings.get(song.id)))}"><span aria-hidden="true">${Number(song.votes) > 0 ? "♥" : "♡"}</span> <span>${online ? song.votes || 0 : "—"}</span></button><span class="vote-tooltip" role="tooltip" id="vote-tip-${escape(song.id)}"></span></span></article>`,
          )
          .join("")
      : `<p class="empty">${favorites.onlySaved ? escape(favorites.emptyMessage()) : "No songs match. Try another title or style."}</p>`);
    $("#tracks").querySelectorAll(".track-info").forEach((info) => {
      const song = songs.find((item) => item.id === info.closest("[data-id]").dataset.id);
      if (!info.querySelector("[data-save]")) info.insertAdjacentHTML("beforeend", favorites.button(song));
      if (info.querySelector("[data-remix]")) info.querySelector("[data-remix]").outerHTML = remixLink(song, escape);
      else info.querySelector(".track-links").insertAdjacentHTML("beforeend", remixLink(song, escape));
      decorateSongLinks(info.querySelector(".track-links"));
    });
    favorites.syncButtons();
    songMenus.sync();
    syncPlaybackButtons();
    if (favorites.onlySaved) $("#pending-tracks").hidden = true;
    $("#play-all").disabled = !visible.length || partialTotal !== null;
    $("#shuffle").disabled = !visible.length || partialTotal !== null;
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
    if (partialTotal !== null && newQueue) startupPlayback = true;
    await player.play(song, newQueue, { source: "main" });
  }
  function syncPlaybackButtons() {
    const isPlaying = player.playing;
    document.querySelectorAll("#tracks [data-play]").forEach((button) => {
      const playing = isPlaying && player.current?.id === button.dataset.play;
      button.dataset.playing = String(playing);
      button.setAttribute("aria-pressed", String(playing));
      // Preserve the recording alias authored by render when only play state changes.
      const title = button.getAttribute("aria-label").replace(/^(Play|Pause) /, "");
      button.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${title}`);
      button.closest(".track")?.classList.toggle("playing", playing);
    });
  }
  async function togglePlay(song, newQueue) {
    if (!song) return;
    if (partialTotal !== null && newQueue) startupPlayback = true;
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
      busy(artTrigger, true);
      try {
        const { openArtRemix } = await import("./art-remix.js");
        if (scope.left) return;
        openArtRemix(song, async (remix, prompt) => {
          await api(`/song-art/${encodeURIComponent(song.id)}`, { method: "POST", body: { remix, prompt } });
          message("Clip art redrawn for everyone.");
          await refresh();
        });
      } catch (error) {
        if (!scope.left) message(error.message, true);
      } finally { busy(artTrigger, false); }
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
  let refreshingQueue = null, catalogRevision = null;
  function refreshQueue() {
    if (refreshingQueue) return refreshingQueue;
    refreshingQueue = api("/queue?page=0").then(async upcoming => {
      if (scope.left || !Array.isArray(upcoming.inStudio) || !Array.isArray(upcoming.queued)) return;
      pending = [...upcoming.inStudio, ...(upcoming.needsAttention || []), ...upcoming.queued];
      recentReleases.clear();
      for (const song of upcoming.recent || [])
        if (song.id && song.publishedAt) recentReleases.set(song.id, song.publishedAt);
      render({ preserveViewport: true });
      await announceAttention(upcoming.needsAttention || []);
    }).catch(() => { /* Queue availability does not delay listening. */ })
      .finally(() => { refreshingQueue = null; });
    return refreshingQueue;
  }
  async function refresh() {
    if (document.hidden || scope.left) return;
    if (refreshing) { refreshAgain = true; return refreshing; }
    void refreshQueue();
    refreshing = (async () => {
      do {
        refreshAgain = false;
        const [catalog] = await Promise.allSettled([api("/songs/summary", { timeout: initialCatalogPending ? 5000 : 15000 })]);
        if (scope.left) return;
        if (catalog.status === "fulfilled" && Array.isArray(catalog.value.songs)) {
          songs = catalog.value.songs;
          catalogRevision = catalog.value.catalogRevision || null;
          if (Array.isArray(catalog.value.archived)) rememberArchived(catalog.value.archived);
          nextVoteAt = catalog.value.nextVoteAt;
          online = true;
          partialTotal = null;
          cardsReady = true;
        } else {
          online = false;
          if (initialCatalogPending) {
            try {
              const fallback = await (await fetch("/catalog-summary.json", { signal: AbortSignal.timeout(5000) })).json();
              if (scope.left) return;
              const hidden = knownArchived(), liveById = new Map(songs.map(song => [song.id, song]));
              songs = fallback.songs.filter(song => !hidden.has(song.id)).map(song => liveById.get(song.id) || song);
              partialTotal = null;
            } catch { message("The full catalog could not load. Refresh to try again.", true); }
            cardsReady = true;
          }
        }
        initialCatalogPending = false;
        if (scope.left) return;
        render({ preserveViewport: true });
        if (startupPlayback && partialTotal === null) {
          startupPlayback = false;
          if (player.source === "main") player.requeue(freshThenLoved(songs).sort((a, b) => (b.pins || 0) - (a.pins || 0)), { source: "main" });
        }
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
  // The first cards already have live pins, votes, artwork and visitor controls.
  // Full data and the queue run independently; late startup data never replaces them.
  if (defaultFilters() && catalogPage === 1 && !location.hash) {
    void api("/songs/first-page", { timeout: 5000 }).then(data => {
      if (scope.left || !initialCatalogPending || !Array.isArray(data.songs) || !Number.isInteger(data.total)) return;
      songs = data.songs;
      partialTotal = data.total;
      nextVoteAt = data.nextVoteAt;
      if (Array.isArray(data.archived)) rememberArchived(data.archived);
      online = true;
      cardsReady = true;
      render({ preserveViewport: true });
    }).catch(() => { /* The full read or static outage fallback still completes startup. */ });
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
  watchCatalog(refresh, { signal: scope.signal, getRevision: () => catalogRevision });
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

async function mountPage() {
  const scope = currentScope();
  const page = document.body.dataset.page;
  document.querySelector(`[data-nav="${page}"]`)?.setAttribute("aria-current", "page");
  mountModelInfo();
  mountBadgeSounds();
  try {
    if (page !== "queue") watchCompletions();
    let mount;
    if (page === "requests" || page === "admin") mount = (await import("./studio-pages.js"))[page];
    else if (page === "queue" || page === "queue-details")
      mount = (await import("./queue.js"))[page === "queue" ? "publicQueue" : "queueDetailsPage"];
    else if (page === "lyrics") mount = (await import("./lyrics.js")).lyricsPage;
    else if (page === "original-prompt") mount = (await import("./original-prompt.js")).originalPromptPage;
    else mount = library;
    if (!scope.left) await mount(main, { escape, date, badge, safeUrl });
  } catch (error) {
    if (!scope.left) message(error.message, true);
  }
}
definePage(import.meta.url, mountPage);
