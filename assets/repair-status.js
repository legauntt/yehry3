// A repair is a completed outcome, never just a retry or a kept version.
export function repairTime(item) {
  let value = item?.repairedAt ?? item?.result?.repairedAt;
  // Older Backstage requests retain the failure and successful publication history.
  // Their publication time is the completion time, not the time this card is opened.
  if (!value && item?.status === "published" && item.result &&
      !item.result.validationFailures?.length && !item.validationFailures?.length &&
      item.history?.some(entry => entry.status === "failed")) value = item.publishedAt;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time : null;
}

export function needsReview(item) {
  return !repairTime(item) && (item?.reviewState ?? item?.result?.reviewState) === "needs_review";
}

export function repairBadge(item) {
  const time = repairTime(item);
  if (!time) return "";
  const label = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "long", timeZone: "America/Los_Angeles",
  }).format(time);
  return `<span class="repair-badge"><button type="button" aria-label="Repaired ${label}" title="Repaired ${label}"><span aria-hidden="true">🔧</span></button><span class="repair-time" aria-hidden="true">Repaired <time datetime="${time.toISOString()}">${label}</time></span></span>`;
}
