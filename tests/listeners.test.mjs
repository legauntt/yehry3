import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The module reads browser globals as it loads; outside a document it must only export its helpers.
globalThis.window = { addEventListener() {} };
globalThis.location = { hostname: "127.0.0.1" };
const { seats, initials } = await import("../assets/listeners.js");

const person = (id, extra = {}) => ({ id: id.padStart(16, "0"), name: id, anonymous: true, ...extra });

test("you sit first on the left and everyone else keeps a steady side", () => {
  const room = [person("a0"), person("b1"), person("c2"), person("d3"), person("e4")];
  const { left, right, more } = seats(room, room[2].id, 6);
  assert.deepEqual(left.map((seat) => seat.name), ["c2", "a0", "e4"]);
  assert.deepEqual(right.map((seat) => seat.name), ["b1", "d3"]);
  assert.equal(more, 0);
  // Someone leaving does not move anyone else across the screen.
  const smaller = seats(room.filter((seat) => seat.name !== "a0"), room[2].id, 6);
  assert.deepEqual(smaller.left.map((seat) => seat.name), ["c2", "e4"]);
  assert.deepEqual(smaller.right.map((seat) => seat.name), ["b1", "d3"]);
});

test("a full side spills to the other, and a full room is counted rather than drawn", () => {
  const room = ["00", "02", "04", "06", "08"].map((id) => person(id));
  const { left, right, more } = seats(room, null, 2);
  assert.deepEqual(left.map((seat) => seat.name), ["00", "02"]);
  assert.deepEqual(right.map((seat) => seat.name), ["04", "06"]);
  assert.equal(more, 1);
  assert.deepEqual(seats([], "missing", 3), { left: [], right: [], more: 0 });
});

test("initials come from the first and last words of a name", () => {
  assert.equal(initials("Jesse Gauntt"), "JG");
  assert.equal(initials("  tony   c  the third "), "TT");
  assert.equal(initials("cher"), "CH");
  assert.equal(initials("émile zola"), "ÉZ");
  assert.equal(initials("🎸 Rocker"), "🎸R");
  assert.equal(initials(""), "?");
});

test("the build adds the room to pages with the shared header, to Fear & Hunger, and to the other ordinary pages", async () => {
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(build, /class="site-header"[^\n]+fearhunger\/index\.html[^\n]+deetz\/index\.html[^\n]+404\.html[^\n]+wiseau\//);
  assert.match(build, /\/assets\/listeners\.js/);
  const css = await readFile(new URL("../assets/listeners.css", import.meta.url), "utf8");
  // The site's Content-Security-Policy has no 'unsafe-inline', so the module must not write style attributes.
  const source = await readFile(new URL("../assets/listeners.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /style=|setAttribute\("style"/);
  assert.match(css, /prefers-reduced-motion/);
});
