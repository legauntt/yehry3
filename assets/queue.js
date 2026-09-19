import { musicBackendBadge } from "./music-provenance.js";
import { gpuWaitNotice } from "./gpu-status.js";
import { songPlanLink } from "./song-plan.js";
import { recoveryActive, recoveryStatus } from "./recovery.js";
import { authoredByLine } from "./authored-by.js";
import { api } from "./api.js";
import { qualityNotice } from "./quality.js";
import { completionAlerts } from "./notifications.js";

export async function publicQueue(main, { escape, date, badge, safeUrl }) {
  main.innerHTML = `<section class="queue-intro"><p class="eyebrow">The open studio</p><h1>Hear what’s<br><em>coming next.</em></h1><p class="lede">Everyone can follow the queue. Tony’s next song starts with someone’s wild idea.</p><a class="text-link" href="/distonyc/">Add your idea →</a></section><section class="queue-alerts"><div><h2>A little heads-up.</h2><p id="alert-status" class="small">Get an alert when anyone’s song is published. Keep any yehry3 tab open.</p></div><button class="quiet" id="enable-alerts">Enable browser alerts</button></section><p id="release-announcement" role="status" aria-live="polite"></p><div class="toolbar public-queue-toolbar"><p class="small" id="queue-updated">Opening the studio…</p><button class="quiet" id="refresh-queue">Refresh ↻</button></div><p class="field-error" id="queue-error" role="status"></p><section aria-labelledby="studio-title"><div class="section-heading"><h2 id="studio-title">In the studio</h2><span class="small" id="studio-count"></span></div><div id="in-studio"><p class="empty">Checking the studio…</p></div></section><section id="attention-section" class="public-attention" aria-labelledby="attention-title" hidden><div class="section-heading"><h2 id="attention-title">9/11'd Again</h2><span class="small" id="attention-count"></span></div><p class="small">Completed work stays saved while these requests wait for a retry.</p><div id="needs-attention"></div></section><section class="public-waiting" aria-labelledby="waiting-title"><div class="section-heading"><h2 id="waiting-title">Waiting for a turn</h2><span class="small" id="waiting-count"></span></div><p class="small">Shown in production order. Priorities can change before a song starts.</p><div id="waiting-queue"></div><div class="pagination"><button class="quiet" id="queue-prev">← Previous</button><span id="queue-page"></span><button class="quiet" id="queue-next">Next →</button></div></section><section class="public-releases" aria-labelledby="releases-title"><div class="section-heading"><h2 id="releases-title">Fresh from the studio</h2><a class="text-link" href="/">The whole collection →</a></div><div id="recent-releases"></div></section>`;
  const $ = (selector) => main.querySelector(selector);
  const observe = completionAlerts(
    $("#enable-alerts"),
    $("#alert-status"),
    (songs) => {
      const region = $("#release-announcement");
      region.textContent =
        songs.length === 1
          ? `Ready to hear: ${songs[0].title || songs[0].idea}.`
          : `${songs.length} new songs are ready to hear below.`;
    },
  );
  let page = 0,
    busy = false,
    timer,
    revealRelease = true;
  function card(song, position) {
    const model = (/^v\d+$/i.test(song.voiceModel || "") ? song.voiceModel : "v6").toUpperCase();
    const progress = Math.max(
      0,
      Math.min(100, Number(song.progress?.percent) || 0),
    );
    return `<article class="queue-card public-queue-card" id="${escape(song.id)}"><div class="queue-heading"><div>${badge(recoveryStatus(song))} <span class="voice-model-badge${model === "V7" ? " v7" : model === "V8" ? " v8" : ""}">${model}</span> ${musicBackendBadge(song)}${position ? `<span class="queue-position">No. ${position}</span>` : ""}<h3><a href="${queueItemHref(song)}">${escape(song.title || song.idea)}</a></h3>${authoredByLine(song.authoredBy, escape)}</div></div>${gpuWaitNotice(song)}${qualityNotice(song.qualityIssues)}${song.title ? `<p class="small">The idea: ${escape(song.idea)}</p>` : ""}${recoveryActive(song) ? '<p class="small">Automatic recovery is working on this request. Completed work is saved.</p>' : ""}${song.status === "failed" && !recoveryActive(song) ? `<p class="attention-note">Production needs attention. Completed work is saved; retry resumes completed stages.</p>` : ""}${song.progress && song.status !== "published" ? `<p class="small">${escape(song.progress.stage)} · ${Math.round(progress)}%</p>${song.status !== "failed" ? `<progress max="100" value="${progress}" aria-label="Song production progress"></progress>` : ""}<p class="small">Last update ${date(song.updatedAt)}</p>` : ""}${song.status === "published" ? `<p class="small">Released ${date(song.publishedAt)}</p><a class="primary" href="${escape(safeUrl(song.url))}" target="_blank" rel="noopener">Hear the song ↗</a>` : ""}<div class="actions"><a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}">View original prompt ↗</a>${songPlanLink(song, escape)}<a class="text-link queue-details-link" href="${queueItemHref(song)}">View details →</a></div></article>`;
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    $("#refresh-queue").disabled = true;
    try {
      let data = await api(`/queue?page=${page}`);
      if (page > 0 && !data.queued.length) {
        page = Math.max(0, Math.ceil(data.queuedTotal / data.pageSize) - 1);
        data = await api(`/queue?page=${page}`);
      }
      $("#in-studio").innerHTML = data.inStudio.length
        ? data.inStudio.map((song) => card(song)).join("")
        : '<p class="empty">The studio is between songs. The next idea could be yours.</p>';
      const needsAttention = data.needsAttention || [];
      $("#attention-section").hidden = !needsAttention.length;
      $("#needs-attention").innerHTML = needsAttention.map((song) => card(song)).join("");
      $("#attention-count").textContent = `${data.needsAttentionTotal ?? needsAttention.length} ${needsAttention.length === 1 ? "request" : "requests"}`;
      $("#waiting-queue").innerHTML = data.queued.length
        ? data.queued
            .map((song, index) => card(song, page * data.pageSize + index + 1))
            .join("")
        : '<p class="empty">There’s room in the queue.</p>';
      $("#recent-releases").innerHTML = data.recent.length
        ? data.recent.map((song) => card(song)).join("")
        : '<p class="empty">Newly finished requests will appear here.</p>';
      $("#studio-count").textContent =
        `${data.inStudioTotal} ${data.inStudioTotal === 1 ? "song" : "songs"}`;
      $("#waiting-count").textContent = `${data.queuedTotal} waiting`;
      $("#queue-page").textContent =
        `Page ${page + 1} of ${Math.max(1, Math.ceil(data.queuedTotal / data.pageSize))}`;
      $("#queue-prev").disabled = page === 0;
      $("#queue-next").disabled =
        (page + 1) * data.pageSize >= data.queuedTotal;
      $("#queue-updated").textContent =
        `Updated ${date(new Date())} · Refreshes every 30 seconds`;
      $("#queue-error").textContent = "";
      if (revealRelease && /^#distonyc-[a-f0-9]{24}$/.test(location.hash)) {
        document.getElementById(location.hash.slice(1))?.scrollIntoView();
      }
      revealRelease = false;
      await observe(data.recent);
    } catch (error) {
      $("#queue-error").textContent =
        `${error.message} The last loaded queue stays below; it may be out of date.`;
    } finally {
      busy = false;
      $("#refresh-queue").disabled = false;
    }
  }
  $("#refresh-queue").onclick = refresh;
  $("#queue-prev").onclick = () => {
    if (!busy && page > 0) {
      page--;
      refresh();
    }
  };
  $("#queue-next").onclick = () => {
    if (!busy) {
      page++;
      refresh();
    }
  };
  await refresh();
  timer = setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  addEventListener("pagehide", () => clearInterval(timer));
  addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clearInterval(timer);
      timer = setInterval(refresh, 30000);
      refresh();
    }
  });
}

export function queueItemHref(song) {
  return /^distonyc-[a-f0-9]{24}$/.test(song?.id || "")
    ? `/queue/details/?request=${encodeURIComponent(song.id)}`
    : "/queue/";
}

export async function queueDetailsPage(main, { escape, date, badge, safeUrl }) {
  const id = new URLSearchParams(location.search).get("request");
  if (!/^distonyc-[a-f0-9]{24}$/.test(id || "")) {
    main.innerHTML = '<section class="queue-detail"><p class="eyebrow">The open studio</p><h1>This queue item is not available.</h1><a class="text-link" href="/queue/">The full queue →</a></section>';
    return;
  }
  let timer;
  async function refresh() {
    try {
      const song = await api(`/queue/${encodeURIComponent(id)}`);
      document.title = `${song.title || song.idea} · Queue details — yehry3`;
      const progress = Math.max(0, Math.min(100, Number(song.progress?.percent) || 0));
      const model = (/^v\d+$/i.test(song.voiceModel || "") ? song.voiceModel : "v6").toUpperCase();
      main.innerHTML = `<article class="queue-detail"><p class="eyebrow">The open studio · Request details</p><div class="queue-detail-status">${badge(recoveryStatus(song))} <span class="voice-model-badge${model === "V7" ? " v7" : model === "V8" ? " v8" : ""}">${model}</span> ${musicBackendBadge(song)}</div><h1>${escape(song.title || song.idea)}</h1>${authoredByLine(song.authoredBy, escape)}<p class="small">Received ${date(song.submittedAt)}</p>${gpuWaitNotice(song)}${song.title ? `<section><h2>The idea</h2><p>${escape(song.idea)}</p></section>` : ""}${recoveryActive(song) ? '<p class="small">Automatic recovery is working on this request. Completed work is saved.</p>' : ""}${song.status === "failed" && !recoveryActive(song) ? `<p class="attention-note">${song.progress?.stage ? `Production stopped during ${escape(song.progress.stage)}. ` : ""}Completed work is saved; retry resumes completed stages.</p>` : ""}${song.progress && !["failed", "published"].includes(song.status) ? `<section><h2>Current progress</h2><p>${escape(song.progress.stage)} · ${Math.round(progress)}%</p><progress max="100" value="${progress}" aria-label="Song production progress"></progress><p class="small">Last update ${date(song.updatedAt)}</p></section>` : ""}${song.status === "published" ? `<p class="small">Released ${date(song.publishedAt)}</p><a class="primary" href="${escape(safeUrl(song.url))}" target="_blank" rel="noopener">Hear the song ↗</a>` : ""}<div class="actions"><a class="text-link" href="/original-prompt/?song=${encodeURIComponent(song.id)}">View original prompt ↗</a>${songPlanLink(song, escape)}<a class="text-link" href="/queue/#${encodeURIComponent(song.id)}">Back to the full queue →</a><a class="text-link" href="/distonyc/">Make a request →</a></div></article>`;
    } catch (error) {
      main.innerHTML = `<section class="queue-detail"><p class="eyebrow">The open studio</p><h1>This queue item is not available.</h1><p>${escape(error.message)}</p><a class="text-link" href="/queue/">The full queue →</a></section>`;
      clearInterval(timer);
    }
  }
  await refresh();
  timer = setInterval(refresh, 30000);
  addEventListener("pagehide", () => clearInterval(timer));
}
