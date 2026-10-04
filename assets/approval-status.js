// Public queue payloads carry the pause in progress; authenticated requests also
// include the review state. Never infer a pending decision from review settings.
export function approvalWaiting(request) {
  if (!["queued", "processing"].includes(request?.status)) return null;
  const review = request.generationReview;
  if (review) return review.state === "pending" && ["lyrics", "composition"].includes(review.kind) ? review.kind : null;
  const stage = (request.workerProgress || request.progress)?.stage;
  if (stage === "Waiting for your lyric approval") return "lyrics";
  if (stage === "Waiting for your composition choice") return "composition";
  return null;
}

export function approvalLabel(request) {
  const kind = approvalWaiting(request);
  if (!kind) return "";
  const name = typeof request.authoredBy === "string" ? request.authoredBy.trim() : "";
  return `Waiting for ${name || "the requester"} to ${kind === "lyrics" ? "approve lyrics" : "choose a composition"}`;
}

export function approvalNotice(request, escape) {
  const label = approvalLabel(request);
  return label ? `<p class="approval-wait-notice" role="status"><span aria-hidden="true">✋</span> <strong>${escape(label)}</strong><span class="small">Generation is paused and will resume after approval in the requester’s saved request.</span></p>` : "";
}
