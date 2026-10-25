// Reservations survive failures and process exits. Cached results are free to
// install; uncertain jobs are never retried just because the process restarted.
export function budgetMonth(now = new Date().toISOString()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

export function reserveJobs(jobs, ledger, { budget, limit, retry = false, cached = new Set(), now = new Date().toISOString(), budgetPeriod = "cumulative" }) {
  if (!["cumulative", "monthly"].includes(budgetPeriod)) throw new Error("Invalid budget period");
  let lifetime = Number(ledger.reservations), paidJobs = 0;
  if (!Number.isFinite(lifetime) || lifetime < 0 || !ledger.jobs || typeof ledger.jobs !== "object") throw new Error("Invalid artwork spend ledger");
  const period = budgetPeriod === "monthly" ? budgetMonth(now) : "backfill";
  const monthly = { ...(ledger.monthlyReservations || {}) };
  const oneOff = ledger.oneOffReservations ?? lifetime;
  let reserved = budgetPeriod === "monthly" ? monthly[period] || 0 : oneOff;
  if (![reserved, oneOff, ...Object.values(monthly)].every(value => Number.isFinite(value) && value >= 0)) throw new Error("Invalid artwork spend ledger periods");
  const events = [...(ledger.events || [])];
  if (!ledger.events && lifetime) events.push({ type: "legacy-backfill-balance", at: now, estimate: lifetime, note: "Original per-job receipts remain in jobs; no historical spending was reset." });
  const selected = [], next = { ...ledger, jobs: { ...ledger.jobs }, monthlyReservations: monthly, oneOffReservations: oneOff, events };
  for (const job of jobs) {
    if (!Number.isFinite(job.estimate) || job.estimate <= 0) throw new Error("Invalid artwork cost estimate");
    if (cached.has(job.key)) { selected.push({ ...job, cached: true }); continue; }
    const prior = ledger.jobs[job.key];
    if (prior && !retry && prior.status !== "deferred-period-change") continue;
    if (paidJobs >= limit || Math.round((reserved + job.estimate) * 10000) > Math.round(budget * 10000)) continue;
    reserved += job.estimate;
    lifetime += job.estimate;
    paidJobs++;
    next.jobs[job.key] = { ...prior, status: "reserved", songId: job.id, title: job.title, treatment: job.treatment, estimate: job.estimate, attempts: (prior?.attempts || 0) + 1, at: now, budgetPeriod, period };
    events.push({ type: "reservation", at: now, key: job.key, title: job.title, treatment: job.treatment, estimate: job.estimate, attempt: next.jobs[job.key].attempts, budgetPeriod, period });
    selected.push(job);
  }
  next.reservations = +lifetime.toFixed(4);
  if (budgetPeriod === "monthly") next.monthlyReservations[period] = +reserved.toFixed(4);
  else next.oneOffReservations = +reserved.toFixed(4);
  return { selected, ledger: next };
}
