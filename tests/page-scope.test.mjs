import test from "node:test";
import assert from "node:assert/strict";
import { currentScope, endPage } from "../assets/page-scope.js";

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a page's timers and listeners end when the visitor leaves it", async () => {
  const scope = currentScope();
  const target = new EventTarget();
  let ticks = 0, heard = 0, left = 0;
  scope.every(() => ticks++, 5);
  scope.on(target, "ping", () => heard++);
  scope.onLeave(() => left++);
  await tick(30);
  assert.ok(ticks > 0);
  target.dispatchEvent(new Event("ping"));
  assert.equal(heard, 1);
  endPage();
  const seen = ticks;
  await tick(30);
  assert.equal(ticks, seen, "the interval stopped");
  target.dispatchEvent(new Event("ping"));
  assert.equal(heard, 1, "the listener was removed");
  assert.equal(left, 1);
  assert.equal(scope.left, true);
});

test("work that finishes after the visitor has gone cannot attach itself to the next page", async () => {
  const gone = currentScope();
  endPage();
  const next = currentScope();
  let ticks = 0, late = 0;
  assert.equal(gone.every(() => ticks++, 5), 0, "no interval is started for a page that has been left");
  assert.equal(gone.later(() => late++, 5), 0);
  gone.onLeave(() => late++); // A page that is already gone is told at once.
  assert.equal(late, 1);
  await tick(30);
  assert.equal(ticks, 0);
  assert.equal(next.left, false);
  endPage();
  assert.equal(next.left, true);
});
