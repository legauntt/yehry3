// Reservations survive failures and process exits. Cached results are free to
// install; uncertain jobs are never retried just because the process restarted.
export function reserveJobs(jobs, ledger, { budget, limit, retry = false, cached = new Set(), now = new Date().toISOString() }) {
  let reserved = Number(ledger.reservations), paidJobs = 0;
  if (!Number.isFinite(reserved) || reserved < 0 || !ledger.jobs || typeof ledger.jobs !== "object") throw new Error("Invalid artwork spend ledger");
  const selected = [], next = { ...ledger, jobs: { ...ledger.jobs } };
  for (const job of jobs) {
    if (!Number.isFinite(job.estimate) || job.estimate <= 0) throw new Error("Invalid artwork cost estimate");
    if (cached.has(job.key)) { selected.push({ ...job, cached: true }); continue; }
    const prior = ledger.jobs[job.key];
    if (prior && !retry) continue;
    if (paidJobs >= limit || Math.round((reserved + job.estimate) * 10000) > Math.round(budget * 10000)) continue;
    reserved += job.estimate;
    paidJobs++;
    next.jobs[job.key] = { status: "reserved", estimate: job.estimate, attempts: (prior?.attempts || 0) + 1, at: now };
    selected.push(job);
  }
  next.reservations = +reserved.toFixed(4);
  return { selected, ledger: next };
}
