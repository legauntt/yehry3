const quotes = [
  "I evolve. I adapt. The queue survives.",
  "New essence. New solution.",
  "Failure is only uncollected essence.",
  "A direct retry is not evolution.",
  "The next form will be stronger.",
  "I collect context. Then I adapt.",
];

export function dehakaQuote(random = Math.random) {
  return quotes[Math.floor(random() * quotes.length) % quotes.length];
}

export function dehakaAttemptCount(history = []) {
  return history.filter((entry) =>
    ["queued", "processing", "failed"].includes(entry?.status) ||
    /retry|recover|shepherd/i.test(String(entry?.action || "")),
  ).length;
}

export function dehakaNextStep(doc, adapting, canRetry) {
  // The console stays on a steered request after it leaves 9/11'd Again.
  if (doc.status === "published") return "Published. The repair held; this log stays as its record.";
  if (doc.status === "canceled") return "Canceled. Dehaka will take no further action.";
  if (doc.status && doc.status !== "failed")
    return "Repair under way: the PC is working from Dehaka’s correction. Steering reopens here if it stops again.";
  if (adapting && doc.recovery?.shepherd)
    return "Inspect the saved evidence, apply the guidance, and use only a supported bounded repair.";
  if (adapting)
    return "Let the active recovery finish; saved stages and integrity checks remain in force.";
  if (canRetry)
    return "Add any useful intent above, then ask Dehaka to diagnose and choose a supported repair.";
  return "Review the retained failure and activity trail; no supported retry is currently available.";
}

const actionLabels = {
  retry_saved_work: "Retry saved work",
  replan: "Replan with new direction",
  needs_input: "Needs your input",
  needs_code_fix: "Needs a code fix",
  coded_repair: "Known repair",
  review: "Needs review",
  queued: "Retry queued",
  cooldown: "Cooling down",
  budget_exhausted: "Retry budget used",
  failed: "Stopped again",
  published: "Published",
  canceled: "Canceled",
};
const authorLabels = { operator: "You", dehaka: "Dehaka", monitor: "Queue monitor", worker: "PC worker" };

export function dehakaActionLabel(action) {
  return actionLabels[action] || action;
}

// The last word decides whose turn it is: after Dehaka or the PC reports, the operator can steer again.
export function dehakaTurn(entries = []) {
  const last = entries.at(-1);
  if (!last) return "steer";
  return last.author === "operator" ? "waiting" : "steer";
}

export function dehakaThread(entries = [], { escape, date, canSteer = true }) {
  if (!entries.length)
    return '<p class="small dehaka-empty">No steering yet. Dehaka’s replies, queue actions and raw PC logs appear here.</p>';
  const turn = dehakaTurn(entries);
  return `<ol class="dehaka-turns">${entries
    .map((entry) => {
      const logs = (entry.logs || [])
        .map(
          (log) =>
            `<details class="dehaka-log" data-log="${escape(`${entry.id}:${log.name}`)}"><summary>${escape(log.name)}${log.truncated ? " · latest part" : ""} <span class="small">${(log.text.length / 1000).toFixed(1)}k chars</span></summary><pre>${escape(log.text)}</pre></details>`,
        )
        .join("");
      return `<li class="dehaka-turn dehaka-turn-${escape(entry.author)}"><p class="dehaka-turn-meta"><strong>${escape(authorLabels[entry.author] || entry.author)}</strong><time>${date(entry.at)}</time>${entry.action ? `<span class="dehaka-action">${escape(dehakaActionLabel(entry.action))}</span>` : ""}</p><p class="dehaka-turn-text">${escape(entry.text)}</p>${entry.evidence ? `<p class="dehaka-evidence"><span>Evidence</span> ${escape(entry.evidence)}</p>` : ""}${logs}</li>`;
    })
    .join("")}</ol><p class="small dehaka-waiting">${turn === "waiting" ? "Dehaka has your guidance. The queue monitor checks every 5 minutes; his reply and the raw logs will appear here." : !canSteer ? "This request is out of 9/11’d Again, so steering is closed. It reopens here if the request stops again." : "Your turn: read the logs above, then steer again below if something should change."}</p>`;
}
