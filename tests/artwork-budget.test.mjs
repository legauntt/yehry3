import test from "node:test";
import assert from "node:assert/strict";
import { reserveJobs } from "../scripts/artwork-budget.mjs";

test("restarts, uncertain calls and retries cannot silently reset the spend cap", () => {
  const jobs = [{ key: "a", estimate: .1 }, { key: "b", estimate: .2 }, { key: "c", estimate: .1 }];
  const first = reserveJobs(jobs, { reservations: 0, jobs: {} }, { budget: .3, limit: 3 });
  assert.deepEqual(first.selected.map(j => j.key), ["a", "b"]);
  assert.equal(first.ledger.reservations, .3);
  const restart = reserveJobs(jobs, first.ledger, { budget: .3, limit: 3 });
  assert.deepEqual(restart.selected, []);
  const retry = reserveJobs(jobs, first.ledger, { budget: .4, limit: 1, retry: true });
  assert.deepEqual(retry.selected.map(j => j.key), ["a"]);
  assert.equal(retry.ledger.jobs.a.attempts, 2);
  assert.equal(retry.ledger.reservations, .4);
  assert.equal(first.ledger.reservations, .3, "reservation does not mutate the previous receipt");
});

test("cached output recovers without paid budget; the job limit applies to API calls", () => {
  const jobs = [{ key: "cached", estimate: .1 }, { key: "next", estimate: .1 }, { key: "defer", estimate: .1 }];
  const previous = { reservations: .1, jobs: { cached: { status: "reserved", attempts: 1 } } };
  const recovered = reserveJobs(jobs, previous, { budget: .1, limit: 1, cached: new Set(["cached"]) });
  assert.deepEqual(recovered.selected.map(j => [j.key, j.cached]), [["cached", true]]);
  assert.equal(recovered.ledger.reservations, .1);
  const next = reserveJobs(jobs, previous, { budget: 1, limit: 1, cached: new Set(["cached"]) });
  assert.deepEqual(next.selected.map(j => j.key), ["cached", "next"]);
  assert.equal(next.ledger.reservations, .2);
  assert.throws(() => reserveJobs(jobs, { jobs: {} }, { budget: 10, limit: 3 }), /ledger/);
});
