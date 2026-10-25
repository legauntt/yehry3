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
const authorLabels = { operator: "You", dehaka: "Dehaka (retired)", monitor: "Queue monitor", worker: "PC worker" };

export function dehakaActionLabel(action) {
  return actionLabels[action] || action;
}

// Raw logs the PC attaches to every song that just published; they carry an expiry and no conversation.
export function dehakaCompletionOnly(entries = []) {
  return entries.length > 0 && entries.every((entry) => entry.kind === "log" && entry.expiresAt);
}

export function dehakaThread(entries = [], { escape, date, completion = false }) {
  if (!entries.length && completion)
    return '<p class="small dehaka-empty">No raw logs are kept for this song. The PC saves them for 24 hours after it publishes, and only while it can still read the job folder.</p>';
  if (!entries.length)
    return '<p class="small dehaka-empty">No diagnostic entries yet. The queue monitor uploads failures and available raw PC logs here.</p>';
  return `<ol class="dehaka-turns">${entries
    .map((entry) => {
      const logs = (entry.logs || [])
        .map(
          (log) =>
            `<details class="dehaka-log" data-log="${escape(`${entry.id}:${log.name}`)}"><summary>${escape(log.name)}${log.truncated ? " · latest part" : ""} <span class="small">${(log.text.length / 1000).toFixed(1)}k chars</span></summary><pre>${escape(log.text)}</pre></details>`,
        )
        .join("");
      return `<li class="dehaka-turn dehaka-turn-${escape(entry.author)}"><p class="dehaka-turn-meta"><strong>${escape(authorLabels[entry.author] || entry.author)}</strong><time>${date(entry.at)}</time>${entry.action ? `<span class="dehaka-action">${escape(dehakaActionLabel(entry.action))}</span>` : ""}${entry.expiresAt ? `<span class="small dehaka-expiry">expires ${date(entry.expiresAt)}</span>` : ""}</p><p class="dehaka-turn-text">${escape(entry.text)}</p>${entry.evidence ? `<p class="dehaka-evidence"><span>Evidence</span> ${escape(entry.evidence)}</p>` : ""}${logs}</li>`;
    })
    .join("")}</ol><p class="small dehaka-waiting">${dehakaCompletionOnly(entries) ? `Raw PC logs from the render, kept for 24 hours after publication. They disappear ${date(entries.at(-1).expiresAt)}.` : "Retained diagnostic history. Dehaka is retired; these entries and raw logs remain available for analysis."}</p>`;
}
