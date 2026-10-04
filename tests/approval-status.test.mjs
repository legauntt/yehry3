import test from "node:test";
import assert from "node:assert/strict";
import { approvalWaiting, approvalLabel, approvalNotice } from "../assets/approval-status.js";

test("approval pauses use current reviews or public progress, never the review setting alone", () => {
  const doc = { status: "queued", authoredBy: " Scythe ", progress: { stage: "Waiting for your lyric approval" } };
  assert.equal(approvalWaiting(doc), "lyrics");
  assert.equal(approvalLabel(doc), "Waiting for Scythe to approve lyrics");
  assert.equal(approvalLabel({ ...doc, authoredBy: "" }), "Waiting for the requester to approve lyrics");
  assert.equal(approvalWaiting({ status: "queued", details: { generation: { reviewLyrics: true } } }), null);
  assert.equal(approvalWaiting({ ...doc, generationReview: { kind: "lyrics", state: "approved" } }), null);
  for (const status of ["failed", "canceled", "cancel_requested", "completed", "publishing", "published"]) {
    assert.equal(approvalWaiting({ ...doc, status }), null);
  }
  assert.equal(approvalWaiting(null), null);
});

test("private pending reviews identify their kind and the notice escapes public display names", () => {
  const doc = { status: "queued", authoredBy: "<Scythe>", generationReview: { kind: "lyrics", state: "pending" } };
  const escape = value => value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.match(approvalNotice(doc, escape), /Waiting for &lt;Scythe&gt; to approve lyrics/);
  assert.match(approvalNotice(doc, escape), /will resume after approval/);
  assert.match(approvalLabel({ ...doc, generationReview: { kind: "composition", state: "pending" } }), /choose a composition/);
});
