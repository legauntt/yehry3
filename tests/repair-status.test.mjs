import test from "node:test";
import assert from "node:assert/strict";
import { repairTime, needsReview, repairBadge } from "../assets/repair-status.js";
import { qualityNotice } from "../assets/quality.js";

const repairedAt = "2026-09-25T19:42:00.000Z";
test("a recorded repair replaces stale review UI and retains independent issue notices", () => {
  const item = { repairedAt, reviewState: "needs_review" };
  assert.equal(needsReview(item), false);
  assert.equal(repairTime({ result: { repairedAt } }).toISOString(), repairedAt);
  assert.match(repairBadge(item), /Sep 25, 2026/);
  assert.match(repairBadge(item), /12:42:00 PM PDT/);
  assert.equal(qualityNotice([], "needs_review", ["voice_validation"], repairedAt), "");
  const notice = qualityNotice([{ code: "long_instrumental_break", seconds: 12 }], "needs_review", ["voice_validation"], repairedAt);
  assert.match(notice, /12 seconds between/);
  assert.doesNotMatch(notice, /Needs review|voice checks/);
});

test("retries, kept versions and invalid timestamps cannot claim a repair", () => {
  for (const item of [{}, { repairedAt: "<script>" }, { repairedAt: "2026-invalid" },
    { status: "processing", publishedAt: repairedAt, result: {}, history: [{ status: "failed" }] },
    { status: "published", publishedAt: repairedAt, result: { validationFailures: ["unfinished_ending"], reviewDecision: "kept" }, history: [{ status: "failed" }] }]) {
    assert.equal(repairTime(item), null);
    assert.equal(repairBadge(item), "");
  }
  assert.equal(needsReview({ reviewState: "needs_review", repairedAt: "invalid" }), true);
  const older = { status: "published", publishedAt: repairedAt, result: {}, history: [{ status: "failed" }, { status: "published" }] };
  assert.equal(repairTime(older).toISOString(), repairedAt);
});
