import { test } from "node:test";
import assert from "node:assert/strict";
import { trackListening } from "../assets/listening.js";

function player(duration = 180) {
  const audio = Object.assign(new EventTarget(), { currentTime: 0, duration, playbackRate: 1, paused: true, seeking: false });
  let wall = 0;
  const sent = [];
  const tracking = trackListening(audio, { songId: "first", source: "main", now: () => wall, send: async (body) => { sent.push(body); return {}; } });
  const event = (name) => audio.dispatchEvent(new Event(name));
  const advance = (seconds, media = seconds) => { wall += seconds * 1000; audio.currentTime += media; event("timeupdate"); };
  const play = () => { audio.paused = false; event("playing"); };
  return { audio, sent, tracking, event, advance, play };
}
test("listens require audio progress, exclude seeks and buffering, and survive pause/resume", () => {
  const p = player();
  p.advance(20, 0);
  assert.equal(p.sent.length, 0);
  p.play(); p.advance(4);
  p.audio.paused = true; p.event("pause"); p.advance(60, 0);
  p.play(); p.advance(1, 100); // A jump cannot become listening time.
  p.event("seeking"); p.audio.currentTime = 140; p.event("seeked");
  p.event("waiting"); p.advance(60, 0);
  p.play(); p.advance(5);
  assert.equal(p.sent.length, 0);
  p.advance(1);
  assert.equal(p.sent.length, 1);
  p.audio.paused = true; p.event("pause"); p.play(); p.advance(20);
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].songId, "first");
  p.tracking.start("second"); p.audio.currentTime = 0; p.play(); p.advance(10);
  assert.equal(p.sent.length, 2);
  assert.equal(p.sent[1].songId, "second");
  assert.notEqual(p.sent[0].requestId, p.sent[1].requestId);
  p.tracking.stop();
});
test("short completed recordings count, but a seek to the end does not", () => {
  const p = player(6);
  p.play(); p.advance(6); p.audio.paused = true; p.event("pause"); p.event("ended");
  assert.equal(p.sent.length, 1);
  p.audio.currentTime = 0; p.play(); p.advance(0.1, 6); p.event("ended");
  assert.equal(p.sent.length, 1);
  p.tracking.stop();
});
test("playback speed measures listening time and natural replay starts a new session", () => {
  const p = player();
  p.audio.playbackRate = 2;
  p.play(); p.advance(5, 10);
  assert.equal(p.sent.length, 0);
  p.advance(5, 10);
  assert.equal(p.sent.length, 1);
  p.event("ended"); p.audio.currentTime = 0; p.play(); p.advance(10, 20);
  assert.equal(p.sent.length, 2);
  p.tracking.stop();
});
