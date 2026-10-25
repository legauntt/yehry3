import test from "node:test";
import assert from "node:assert/strict";
import { digest, makeReviewedPrompt } from "../scripts/artwork-policy.mjs";

const packet = { song: { id: "example", lyrics: { text: "Original source words stay in the audit." }, songPlan: { bpm: 92 } } };
const brief = { sourceHash: digest(packet), kind: "non-explicit-scene", rationale: "Replace literal events with an empty landscape.", scene: "An empty street after rain.", musicalContext: "Reflective protest rock, 92 BPM; restrained charcoal texture.", alt: "A rain-washed street." };

test("reviewed alternatives send only the authored visual interpretation, retaining source identity", () => {
  const prompt = makeReviewedPrompt(packet, "basic", brief);
  assert.ok(prompt.includes(brief.scene));
  assert.ok(prompt.includes(brief.musicalContext));
  assert.ok(!prompt.includes(packet.song.lyrics.text));
  assert.match(prompt, /No text, letters/);
  assert.match(prompt, /Gatsby cap/);
});

test("changed sources or incomplete review cannot produce a paid prompt", () => {
  assert.throws(() => makeReviewedPrompt({ ...packet, missing: ["lyrics"] }, "basic", brief), /review again/);
  assert.throws(() => makeReviewedPrompt(packet, "basic", { ...brief, rationale: "" }), /requires rationale/);
  assert.throws(() => makeReviewedPrompt(packet, "basic", { ...brief, kind: "auto-retry" }), /Invalid reviewed brief kind/);
});

test("an explicitly reviewed humorous fallback permits only its short sign", () => {
  const prompt = makeReviewedPrompt(packet, "basic", { ...brief, kind: "humorous-fallback" });
  assert.match(prompt, /short comic sign/);
  assert.match(prompt, /picture must dominate/);
});
