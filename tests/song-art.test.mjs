import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { remixFromPrompt, songArtwork, songArtworkMarkup, voteTier } from "../assets/song-art.js";
import { songSummary } from "../assets/song-summary.js";

const catalog = async () => JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8")).songs;
const svgOf = art => decodeURIComponent(art.src.split(",")[1]);

test("every published recording gets distinct, stable artwork using compact metadata", async () => {
  const songs = await catalog();
  const images = songs.map(song => songArtwork(song));
  assert.equal(new Set(images.map(art => art.src)).size, songs.length);
  for (const song of songs) {
    const full = songArtwork(song), summary = songArtwork(songSummary(song));
    assert.deepEqual(full, summary);
    assert.match(full.alt, /^Silly clip art: /);
    assert.match(decodeURIComponent(full.src), /viewBox="0 0 240 200"/);
  }
});
test("recognizable title subjects receive matching illustrations", () => {
  for (const [title, expected] of [
    ["Arbys at Eleven", ["burger"]], ["The Save File Has Teeth", ["save"]],
    ["The Book of Parallel Cs", ["book"]], ["Medusa", ["snake"]],
    // Several subjects in one title share the spotlight between recordings.
    ["Blood on My Shoes at Daybreak", ["shoe", "sun"]], ["The Midnight Chrome Express", ["train", "car", "moon"]],
    ["Round and Round (Acoustic)", ["donut", "guitar"]],
  ]) {
    const seen = new Set(Array.from({ length: 40 }, (_, index) => songArtwork({ id: title + index, title }).theme));
    assert.deepEqual([...seen].sort(), [...expected].sort(), title);
  }
});
test("the catalog no longer leans on one fallback or one drawing per remix family", async () => {
  const songs = await catalog();
  const counts = new Map();
  for (const song of songs) counts.set(songArtwork(song).theme, (counts.get(songArtwork(song).theme) || 0) + 1);
  // The old first-match picker put 19 of 183 songs on the record and used 43 drawings.
  assert.ok(Math.max(...counts.values()) <= Math.ceil(songs.length * 0.07), "one drawing dominates: " + JSON.stringify([...counts]));
  assert.ok(counts.size >= 45);
  // Recordings that share a title still differ in more than color.
  const looks = Array.from({ length: 12 }, (_, index) => svgOf(songArtwork({ id: "untitled-" + index, title: "Untitled" })).replace(/#[0-9a-f]{6}/g, ""));
  assert.equal(new Set(looks).size, looks.length);
  assert.ok(new Set(Array.from({ length: 40 }, (_, index) => songArtwork({ id: "plain-" + index, title: "Untitled" }).theme)).size >= 6);
});
test("upvoted songs switch to distinct award art at 1, 3, 5, and 7 votes", async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 40, -2, "3", null, undefined, NaN].map(votes => voteTier(votes)?.votes || 0), [0, 1, 1, 3, 3, 5, 5, 7, 7, 0, 3, 0, 0, 0]);
  const regular = new Set(["record", ...(await catalog()).map(song => songArtwork(song).theme)]);
  const casts = new Map(), backgrounds = new Map();
  for (const votes of [1, 3, 5, 7]) for (let index = 0; index < 40; index++) {
    const song = { id: "loved-" + index, title: "Round and Round " + index };
    const art = songArtwork({ ...song, votes }), plain = songArtwork(song);
    assert.equal(art.tier, votes);
    assert.equal(plain.tier, 0);
    assert.notEqual(art.src, plain.src);
    assert.ok(!regular.has(art.theme), art.theme + " is also regular art");
    assert.match(art.alt, /^Silly clip art: /);
    casts.set(votes, (casts.get(votes) || new Set()).add(art.theme));
    backgrounds.set(votes, (backgrounds.get(votes) || new Set()).add(svgOf(art).match(/<rect width="240" height="200" fill="(#[0-9a-f]{6})"/)[1]));
    // One heart per tier reached, and the votes inside a tier do not reshuffle the art.
    assert.equal(svgOf(art).split('scale(.85)" d="M10 18').length - 1, [1, 3, 5, 7].indexOf(votes) + 1);
    assert.equal(songArtwork({ ...song, votes: votes + 1 }).src, art.src);
    // The grid view's track number sits on the top-left corner of the art.
    for (const [, x] of svgOf(art).matchAll(/translate\((\d+) 11\) scale\(\.85\)/g)) assert.ok(Number(x) > 120, "tier hearts would hide under the track number");
  }
  const all = [...casts.values()].flatMap(cast => [...cast]);
  assert.equal(new Set(all).size, all.length, "tiers share a mascot");
  for (const cast of casts.values()) assert.ok(cast.size >= 2);
  const colors = [...backgrounds.values()].flatMap(set => [...set]);
  assert.equal(new Set(colors).size, colors.length, "tiers share a background");
  assert.match(songArtworkMarkup({ id: "a", title: "A", votes: 5 }, value => value), /data-art-tier="5"/);
  assert.doesNotMatch(songArtworkMarkup({ id: "a", title: "A", votes: 0 }, value => value), /data-art-tier/);
});
test("new and unusual titles are safe and do not need lyrics or remote image URLs", () => {
  const hostile = '<script>alert("hi")</script><image href="https://example.com/track"/>';
  for (const votes of [0, 7]) {
    const art = songArtwork({ id: hostile, title: hostile, votes });
    assert.doesNotMatch(svgOf(art), /script|https:|href=|onload=/);
  }
  assert.notEqual(songArtwork({ id: "one", title: "Untitled" }).src, songArtwork({ id: "two", title: "Untitled" }).src);
  assert.ok(songArtwork({}).src.startsWith("data:image/svg+xml,"));
});
test("every See-saw recording wears the same comically huge black mouth", async () => {
  const seesawMouth = /<rect x="70" y="114" width="64" height="38" rx="3" fill="#000"\/>/;
  const isSeesaw = song => /\b(?:see[-\s]?saw|c-?saw)/i.test(song.title || "");
  const cast = (await catalog()).filter(isSeesaw);
  assert.ok(cast.length >= 3, "the catalog lost its See-saw recordings");
  for (const song of cast) {
    assert.match(svgOf(songArtwork(song)), seesawMouth, song.title);
    assert.match(songArtwork(song).alt, /comically enormous black rectangle for a mouth\.$/);
  }
  // The gag follows the character through retitles, remixes, and votes.
  for (const title of ["See-saw'd Again", "See-saw'd Again (Empty Frame Mix)", "See-saw in Every Picture",
    "Seesaw Rides Again", "See Saw Blues", "Csaw Knows the Words", "The C-Saw Waltz"]) {
    for (const votes of [0, 1, 7]) assert.match(svgOf(songArtwork({ id: title + votes, title, votes })), seesawMouth, title);
  }
  // Tony C saw plenty of things without being See-saw.
  for (const title of ["Tony C Saw the Light", "What Tony C Saw", "The Sawmill", "McSawyer Street"]) {
    assert.doesNotMatch(svgOf(songArtwork({ id: title, title })), seesawMouth, title);
  }
  for (const song of (await catalog()).filter(song => !isSeesaw(song))) {
    assert.doesNotMatch(svgOf(songArtwork(song)), seesawMouth, song.title);
  }
});
test("a redraw prompt changes only what it names, layers on earlier redraws, and previews honestly", () => {
  const song = { id: "plain-1", title: "Untitled" }, plain = songArtwork(song);
  const drawn = remixFromPrompt(song, "A ROBOT in sunglasses, blue, holding a balloon!");
  assert.deepEqual(drawn.remix, { theme: "robot", extra: 3, palette: 3, prop: 3 });
  assert.deepEqual(drawn.understood, ["robot", "sunglasses", "blue", "a balloon"]);
  assert.deepEqual(drawn.diced, []);
  assert.equal(drawn.changed, true);
  const redrawn = songArtwork({ ...song, artRemix: drawn.remix });
  assert.equal(redrawn.src, drawn.art.src);
  assert.equal(redrawn.theme, "robot");
  assert.equal(redrawn.remixed, true);
  assert.match(redrawn.alt, /robot.*redrawn by listeners/);
  assert.match(svgOf(redrawn), /#dbe9ef/);
  assert.equal(plain.remixed, false);
  assert.match(songArtworkMarkup({ ...song, artRemix: drawn.remix }, value => value), /data-art-remixed/);
  assert.doesNotMatch(songArtworkMarkup(song, value => value), /data-art-remixed/);
  // A second listener's words build on the first: the robot and its shades stay.
  const second = remixFromPrompt({ ...song, artRemix: drawn.remix }, "pink with polka dots");
  assert.deepEqual(second.remix, { palette: 4, backdrop: 3 });
  assert.equal(second.art.theme, "robot");
  // The word written first wins a trait, and asking for what is already there is refused.
  assert.equal(remixFromPrompt(song, "a ghost, not a robot").remix.theme, "ghost");
  assert.equal(remixFromPrompt({ ...song, artRemix: drawn.remix }, "robot blue").changed, false);
  assert.deepEqual(remixFromPrompt(song, "   ").remix, {});
  assert.equal(remixFromPrompt(song, "").changed, false);
});
test("unknown prompts roll a few visible dice, the same way every time", () => {
  for (let index = 0; index < 40; index++) {
    const song = { id: "dice-" + index, title: "Untitled", votes: index % 4 === 3 ? 7 : 0 };
    const drawn = remixFromPrompt(song, "xyzzy plugh " + index);
    assert.deepEqual(drawn.understood, []);
    assert.equal(drawn.diced.length, 3);
    assert.equal(drawn.changed, true, song.id);
    assert.deepEqual(remixFromPrompt(song, "xyzzy plugh " + index).remix, drawn.remix);
  }
  const mixed = remixFromPrompt({ id: "dice", title: "Untitled" }, "surprise me with a monocle");
  assert.deepEqual(mixed.understood, ["a monocle"]);
  assert.equal(mixed.remix.extra, 7);
  assert.equal(mixed.diced.length, 3);
  assert.ok(!mixed.diced.includes("accessory"));
});
test("every word the prompt knows draws, and stored redraws cannot break the art", () => {
  const song = { id: "vocabulary", title: "Untitled" };
  for (const word of ["floppy", "disco ball", "wishing well", "music note", "washing machine", "lightning", "band-aid", "mixtape"])
    assert.equal(remixFromPrompt(song, word).understood.length, 1, word);
  assert.equal(remixFromPrompt(song, "music notes").remix.prop, 5);
  assert.equal(remixFromPrompt(song, "flip it").remix.flip, 1 - remixFromPrompt({ ...song, artRemix: remixFromPrompt(song, "flip it").remix }, "flip it").remix.flip);
  // Award mascots are earned, prototype names are not drawings, and odd indexes wrap.
  for (const artRemix of [{ theme: "gem" }, { theme: "constructor" }, { theme: 7 }, { palette: -1, eyes: "3", pose: 1.5 }, "robot", null])
    assert.equal(songArtwork({ ...song, artRemix }).theme, songArtwork(song).theme);
  assert.ok(songArtwork({ ...song, artRemix: { palette: 63, pose: 63, prop: 63, extra: 63, eyes: 63, mouth: 63, backdrop: 63, confetti: 63, tilt: 63, flip: 63 } }).src.startsWith("data:image/svg+xml,"));
  // Award art keeps its mascot; the requested character becomes the small nod.
  const loved = songArtwork({ ...song, votes: 3, artRemix: { theme: "robot" } });
  assert.ok(["medal", "megaphone"].includes(loved.theme));
  assert.notEqual(loved.src, songArtwork({ ...song, votes: 3 }).src);
});
test("a redraw never takes a See-saw song's mouth", () => {
  const song = { id: "seesaw", title: "See-saw'd Again" }, seesawMouth = /<rect x="70" y="114" width="64" height="38" rx="3" fill="#000"\/>/;
  assert.equal(remixFromPrompt(song, "laughing").changed, false);
  const drawn = remixFromPrompt(song, "a laughing robot");
  assert.equal(drawn.changed, true);
  assert.match(svgOf(drawn.art), seesawMouth);
  assert.match(drawn.art.alt, /black rectangle for a mouth, redrawn by listeners\.$/);
  for (let index = 0; index < 20; index++) assert.ok(!remixFromPrompt({ ...song, id: "seesaw-" + index }, "xyzzy").diced.includes("mouth"));
});
