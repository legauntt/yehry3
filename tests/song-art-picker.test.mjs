import { test } from "node:test";
import assert from "node:assert/strict";
import { artChoices, characterIcon, doodleLimits, parseDoodle, remixFromPicks, serializeDoodle, shuffleSeed, songArtwork } from "../assets/song-art.js";
import { inkBudget, settle, simplify } from "../assets/art-draw.js";

const svgOf = art => decodeURIComponent(art.src.split(",")[1]);

test("the picker offers only what the drawing code can draw, and says what the picture shows now", () => {
  const song = { id: "pick-1", title: "Robot Morning" };
  const choices = artChoices(song);
  assert.deepEqual(choices.open, ["theme", "palette", "pose", "prop", "extra", "eyes", "mouth", "backdrop", "confetti", "tilt", "flip"]);
  const names = choices.characters.map(character => character.value);
  assert.ok(names.length >= 50 && names.includes("robot") && names.includes("ghost") && names.includes("guitar"), String(names.length));
  for (const mascot of ["gem", "rocket", "rosette", "medal"]) assert.ok(!names.includes(mascot), mascot);
  assert.ok(choices.characters.every(character => character.label && character.words instanceof RegExp));
  assert.equal(choices.characters.find(character => character.value === "save").label, "floppy disk");
  assert.ok(choices.characters.find(character => character.value === "bee").words.test("bumblebee"));
  assert.equal(choices.swatches.length, 12);
  assert.equal(choices.swatches[3].label, "blue");
  assert.deepEqual(choices.swatches[3].colors, ["#dbe9ef", "#7fa8c3", "#e79e89"]);
  assert.equal(choices.pens.length, 6);
  // What the picture shows now is what the picker marks.
  assert.equal(choices.current.theme, songArtwork(song).theme);
  for (const trait of ["palette", "pose", "prop", "extra", "eyes", "mouth", "backdrop", "confetti", "tilt", "flip"]) assert.ok(Number.isInteger(choices.current[trait]), trait);
  const pinned = artChoices({ ...song, artRemix: { theme: "ghost", palette: 4, eyes: 1, prop: 3, extra: 1 } });
  assert.equal(pinned.current.theme, "ghost");
  assert.equal(pinned.current.palette, 4);
  assert.equal(pinned.current.eyes, 1);
  assert.equal(pinned.current.prop, 3);
  // The three empty-hand and bare-face indexes all read as the first chip.
  assert.equal(pinned.current.extra, 0);
  // Every chip draws a picture different from every other chip in its row.
  for (const trait of ["pose", "prop", "extra", "eyes", "mouth", "backdrop", "confetti", "tilt", "flip"]) {
    const sources = choices.choices[trait].map(([value]) => songArtwork({ ...song, artRemix: { extra: 0, [trait]: value } }).src);
    assert.equal(new Set(sources).size, sources.length, trait);
  }
  const sources = choices.characters.map(({ value }) => songArtwork({ ...song, artRemix: { theme: value } }).src);
  assert.equal(new Set(sources).size, sources.length);
  // Award art keeps its mascots, stage, sprinkles and empty hands; a gold record also keeps its pose.
  const loved = artChoices({ ...song, votes: 3 });
  assert.deepEqual(loved.open, ["palette", "pose", "extra", "eyes", "mouth", "tilt", "flip"]);
  assert.equal(loved.tier, 3);
  assert.deepEqual(loved.swatches.map(swatch => swatch.label), ["Colors 1", "Colors 2"]);
  assert.deepEqual(artChoices({ ...song, votes: 5 }).open, ["palette", "extra", "eyes", "mouth", "tilt", "flip"]);
  // Heart eyes are the award's, not a chip's.
  const hearts = Array.from({ length: 30 }, (_, index) => artChoices({ id: "loved-" + index, title: "Untitled", votes: 1 }).current.eyes);
  assert.ok(hearts.includes(null) && hearts.some(Number.isInteger));
  const seesaw = artChoices({ id: "s", title: "See-saw Blues" });
  assert.equal(seesaw.seesaw, true);
  assert.ok(!seesaw.open.includes("mouth"));
  assert.match(svgOf({ src: characterIcon("robot", 3) }), /^<svg .*#7fa8c3/);
  // Sunglasses hide the eyes, so the picker says so instead of marking a chip.
  const shaded = artChoices({ ...song, artRemix: { extra: 3 } });
  assert.equal(shaded.current.eyes, null);
  assert.equal(shaded.eyesNote, "behind the sunglasses");
  assert.equal(artChoices({ ...song, artRemix: { extra: 4 } }).eyesNote, "");
  assert.equal(characterIcon("nobody"), "");
});

test("picks layer on the picture, a shuffle starts a new one under the pins, and nothing is sent for no change", () => {
  const song = { id: "pick-2", title: "Untitled" };
  const nothing = remixFromPicks(song, {});
  assert.deepEqual(nothing.remix, {});
  assert.equal(nothing.changed, false);
  const pinned = remixFromPicks(song, { pins: { theme: "robot", palette: 3, extra: 3 } });
  assert.deepEqual(pinned.remix, { theme: "robot", palette: 3, extra: 3 });
  assert.equal(pinned.changed, true);
  assert.equal(pinned.art.theme, "robot");
  assert.equal(pinned.art.src, songArtwork({ ...song, artRemix: pinned.remix }).src);
  const layered = remixFromPicks({ ...song, artRemix: pinned.remix }, { pins: { eyes: 1 } });
  assert.deepEqual(layered.remix, { eyes: 1 });
  assert.deepEqual(layered.state, { theme: "robot", palette: 3, extra: 3, eyes: 1 });
  assert.equal(remixFromPicks({ ...song, artRemix: pinned.remix }, { pins: { theme: "robot" } }).changed, false);
  assert.deepEqual(remixFromPicks(song, { pins: { eyes: null, mouth: undefined, tilt: 0 } }).remix, { tilt: 0 });
  const seed = shuffleSeed(song, 1);
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  assert.notEqual(shuffleSeed(song, 2), seed);
  assert.notEqual(shuffleSeed({ ...song, artRemix: { seed } }, 1), seed, "a shuffle never repeats the seed the picture has");
  const shuffled = remixFromPicks({ ...song, artRemix: pinned.remix }, { pins: { theme: "robot" }, seed });
  assert.deepEqual(shuffled.remix, { seed, theme: "robot" });
  assert.deepEqual(shuffled.state, shuffled.remix);
  assert.equal(shuffled.art.theme, "robot");
  assert.equal(shuffled.changed, true);
});

test("a doodle is pen strokes in a short string that survives a round trip, and garbage never draws", () => {
  const strokes = [{ pen: 0, width: 1, points: [[120, 100], [123, 98], [128, 99]] }, { pen: 4, width: 2, points: [[30, 40]] }];
  const text = serializeDoodle(strokes);
  assert.equal(text, "0 1 120 100 3 -2 5 1;4 2 30 40");
  assert.deepEqual(parseDoodle(text), strokes);
  assert.deepEqual(parseDoodle(""), []);
  assert.deepEqual(parseDoodle(undefined), []);
  for (const bad of ["1 1 1", "6 0 1 1", "0 3 1 1", "0 0 -1 1", "0 0 1000 1", "0 0 1 1;", ";0 0 1 1", "0 0 1 1 x", "0 0 1 1 <svg>", 7, {}, "0".repeat(3001), Array.from({ length: 81 }, () => "0 0 1 1").join(";"), "0 0 1 1" + " 1 1".repeat(400)])
    assert.equal(parseDoodle(bad), null, String(bad).slice(0, 30));
  // Points past the edge are held at it rather than refused.
  assert.deepEqual(parseDoodle("0 0 999 999 -999 5")[0].points, [[240, 200], [0, 200]]);
  const song = { id: "doodle-1", title: "Untitled" };
  const plain = songArtwork(song), drawn = songArtwork({ ...song, artRemix: { doodle: text } });
  assert.notEqual(drawn.src, plain.src);
  assert.equal(drawn.remixed, true);
  assert.match(drawn.alt, /with a listener's doodle, redrawn by listeners\.$/);
  assert.match(svgOf(drawn), /<path d="M120 100L123 98L128 99" stroke="#303f38" stroke-width="6"\/>/);
  assert.match(svgOf(drawn), /<path d="M30 40L30 40" stroke="#e8557c" stroke-width="11"\/>/);
  // The pens are the picture's inks, so the third and fourth follow the palette.
  assert.deepEqual(artChoices({ ...song, artRemix: { palette: 3 } }).pens, ["#303f38", "#fffaf0", "#7fa8c3", "#e79e89", "#e8557c", "#f7c948"]);
  assert.equal(songArtwork({ ...song, artRemix: { doodle: "<svg onload=alert(1)>" } }).src, plain.src);
  assert.equal(songArtwork({ ...song, artRemix: { doodle: "" } }).src, plain.src);
  assert.equal(songArtwork({ ...song, artRemix: { doodle: "" } }).remixed, false);
  assert.match(svgOf(songArtwork({ ...song, artRemix: { doodle: text } }, { wide: true })), /M120 100L123 98L128 99/);
  // A changed doodle is sent, an unchanged one is not, and a shuffle carries it along.
  const held = { ...song, artRemix: { doodle: text } };
  assert.deepEqual(remixFromPicks(held, { doodle: parseDoodle(text) }).remix, {});
  assert.deepEqual(remixFromPicks(held, { doodle: [] }).remix, { doodle: "" });
  assert.equal(remixFromPicks(held, { doodle: [] }).changed, true);
  const seed = shuffleSeed(held);
  assert.deepEqual(remixFromPicks(held, { seed, doodle: parseDoodle(text) }).remix, { seed, doodle: text });
  assert.deepEqual(remixFromPicks(held, { seed, doodle: [] }).remix, { seed });
  assert.deepEqual(remixFromPicks(song, { doodle: strokes }).remix, { doodle: text });
});

test("a pen stroke settles to a few integer points and never past Chairlift's allowance", () => {
  const line = Array.from({ length: 50 }, (_, index) => [10 + index * 4, 50 + (index % 2) * .4]);
  assert.deepEqual(settle(line), [[10, 50], [206, 50]]);
  assert.deepEqual(settle([[0, 0], [50, .2], [100, 0], [100, 50], [100, 100]]), [[0, 0], [100, 0], [100, 100]]);
  assert.deepEqual(settle([[12.4, 13.6]]), [[12, 14]]);
  const loop = Array.from({ length: 200 }, (_, index) => [100 + 40 * Math.cos(index / 200 * Math.PI * 2), 100 + 40 * Math.sin(index / 200 * Math.PI * 2)]);
  const settled = settle(loop);
  assert.ok(settled.length >= 8 && settled.length <= 40, String(settled.length));
  const wobble = Array.from({ length: 5000 }, (_, index) => [index % 240, (index * 37) % 200]);
  assert.ok(settle(wobble).length <= doodleLimits.points);
  assert.equal(simplify([[0, 0], [1, 1]]).length, 2);
  assert.ok(inkBudget < doodleLimits.length);
  assert.ok(serializeDoodle([{ pen: 0, width: 0, points: settle(wobble) }]).length <= doodleLimits.length);
});
