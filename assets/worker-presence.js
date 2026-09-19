// Backstage summary of PC worker heartbeats. Chairlift computes online/offline; the browser only formats it.
const stateLabels = {
  starting: "Checking for requests",
  idle: "Idle",
  working: "Working",
  waiting_for_review: "Waiting for a review",
  needs_attention: "Last run stopped",
};

function ago(value, now) {
  const minutes = Math.max(0, Math.round((now - new Date(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ""} ago` : `${Math.floor(hours / 24)} days ago`;
}

export function workerPresence(workers = [], { escape, date, now = Date.now() }) {
  if (!workers.length)
    return '<section class="worker-presence" aria-label="PC worker"><span class="presence-pill offline">No heartbeat yet</span><span class="small">The PC worker has not connected.</span></section>';
  return workers
    .map((worker) => {
      const online = worker.status === "online";
      const since = online ? worker.onlineSince : worker.offlineSince;
      const outages = (worker.presence || []).filter((event) => event.status === "offline").slice(-3).reverse();
      return `<section class="worker-presence" aria-label="PC worker"><span class="presence-pill ${online ? "online" : "offline"}">PC worker ${online ? "online" : "offline"}</span><span class="small">${online ? `${escape(stateLabels[worker.state] || worker.state || "Idle")} · ${escape(worker.stage || "")} · online since ${date(since)} · heartbeat ${ago(worker.lastSeenAt, now)}` : `Last heartbeat ${date(since)} (${ago(since, now)}) · was ${escape(worker.stage || "idle")}`}</span>${outages.length ? `<details class="presence-history"><summary>Recent outages</summary><ul>${outages.map((event) => `<li>Offline ${date(event.from)} → ${date(event.to)}</li>`).join("")}</ul></details>` : ""}</section>`;
    })
    .join("");
}
