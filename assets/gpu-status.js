// Only a current worker wait stage identifies GPU contention. Error messages
// remain diagnostics and must never be reclassified by matching their wording.
export function gpuWaiting(request) {
  if (request?.status !== "processing") return false;
  const stage = (request.workerProgress || request.progress)?.stage;
  return typeof stage === "string" && /^(?:Movement [1-9]\d* of [1-9]\d* · )?Waiting for (?:the GPU|the current renderer)$/.test(stage);
}

export function gpuWaitNotice(request) {
  return gpuWaiting(request)
    ? '<p class="small gpu-wait-notice" role="status">Waiting for the GPU. Another job is using it; this request will continue automatically.</p>'
    : "";
}
