import test from "node:test";
import assert from "node:assert/strict";
import { dehakaAttemptCount, dehakaNextStep, dehakaQuote } from "../assets/dehaka.js";

test("Dehaka rotates bounded quotes and summarizes saved recovery context", () => {
  assert.equal(dehakaQuote(() => 0), "I evolve. I adapt. The queue survives.");
  assert.equal(dehakaQuote(() => 0.999), "I collect context. Then I adapt.");
  assert.equal(dehakaAttemptCount([
    { action: "status", status: "processing" },
    { action: "status", status: "failed" },
    { action: "note" },
    { action: "shepherd" },
  ]), 3);
  assert.match(dehakaNextStep({ recovery: { shepherd: {} } }, true, false), /saved evidence/);
  assert.match(dehakaNextStep({}, false, true), /Add any useful intent/);
  // A steered request keeps its console after it leaves 9/11'd Again.
  assert.match(dehakaNextStep({ status: "failed" }, false, true), /Add any useful intent/);
  assert.match(dehakaNextStep({ status: "processing" }, false, false), /Repair under way/);
  assert.match(dehakaNextStep({ status: "published" }, false, false), /repair held/);
  assert.match(dehakaNextStep({ status: "canceled" }, false, false), /no further action/);
});

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const date = (value) => new Date(value).toISOString();

test("Dehaka thread alternates turns and renders escaped raw logs", async () => {
  const { dehakaThread, dehakaTurn } = await import("../assets/dehaka.js");
  const steer = { id: "a", author: "operator", kind: "steer", at: "2026-09-19T10:00:00Z", text: "Keep the vocal", logs: [] };
  const reply = { id: "b", author: "dehaka", kind: "reply", action: "retry_saved_work", at: "2026-09-19T10:05:00Z", text: "Retrying",
    evidence: "journal", logs: [{ name: "renderer.log", text: "<script>boom</script>", truncated: true }] };
  assert.equal(dehakaTurn([]), "steer");
  assert.equal(dehakaTurn([steer]), "waiting");
  assert.equal(dehakaTurn([steer, reply]), "steer");
  const html = dehakaThread([steer, reply], { escape, date });
  assert.match(html, /Retry saved work/);
  assert.match(html, /renderer\.log · latest part/);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /Your turn/);
  assert.match(dehakaThread([steer], { escape, date }), /Dehaka has your guidance/);
  assert.match(dehakaThread([], { escape, date }), /No steering yet/);
  const replanned = dehakaThread([steer, { ...reply, action: "replan" }], { escape, date, canSteer: false });
  assert.match(replanned, /Replan with new direction/);
  assert.match(replanned, /steering is closed/);
  assert.doesNotMatch(replanned, /steer again below/);
});

test("worker presence shows online and offline heartbeats", async () => {
  const { workerPresence } = await import("../assets/worker-presence.js");
  const now = Date.parse("2026-09-19T12:00:00Z");
  const online = workerPresence([{ status: "online", state: "working", stage: "Rendering", onlineSince: "2026-09-19T09:00:00Z", lastSeenAt: "2026-09-19T11:59:40Z",
    presence: [{ status: "offline", from: "2026-09-19T01:00:00Z", to: "2026-09-19T09:00:00Z" }] }], { escape, date, now });
  assert.match(online, /PC worker online/);
  assert.match(online, /Working · Rendering/);
  assert.match(online, /heartbeat just now/);
  assert.match(online, /Recent outages/);
  const offline = workerPresence([{ status: "offline", stage: "Waiting for requests", offlineSince: "2026-09-19T11:00:00Z", lastSeenAt: "2026-09-19T11:00:00Z" }], { escape, date, now });
  assert.match(offline, /PC worker offline/);
  assert.match(offline, /(1 hr ago)/);
  assert.match(workerPresence([], { escape, date }), /No heartbeat yet/);
});
