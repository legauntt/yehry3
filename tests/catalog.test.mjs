import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
const catalog = JSON.parse(
  await readFile(new URL("../catalog.json", import.meta.url), "utf8"),
);
test("both catalogs use unique stable IDs and valid playable URLs", async () => {
  assert.ok(catalog.songs.length >= 50);
  assert.equal(
    new Set(catalog.songs.map((song) => song.id)).size,
    catalog.songs.length,
  );
  assert.equal(
    catalog.songs.filter((song) => song.collection === "fearhunger").length,
    3,
  );
  for (const song of catalog.songs) {
    assert.match(song.id, /^[a-z0-9-]+$/);
    assert.ok(song.duration > 0);
    assert.ok(
      song.url.startsWith("https://") ||
        song.url.startsWith("/fearhunger/audio/"),
    );
    assert.ok(song.lyrics?.cues?.length, `${song.title} needs lyric cues`);
    const lines = song.lyrics.text.split("\n");
    let previousLine = -1;
    let previousStart = -1;
    for (const cue of song.lyrics.cues) {
      assert.ok(Number.isInteger(cue.line) && cue.line > previousLine);
      assert.ok(lines[cue.line]?.trim());
      assert.ok(cue.start > previousStart && cue.start >= 0);
      assert.ok(cue.end > cue.start && cue.end <= song.duration);
      previousLine = cue.line;
      previousStart = cue.start;
    }
    if (song.url.startsWith("/"))
      assert.ok(
        (await stat(new URL(`..${song.url}`, import.meta.url))).size > 1000000,
      );
  }
});
test("all routes are built, unlisted, and contain no submission password or backend source", async () => {
  let updatedAt;
  for (const page of [
    "index.html",
    "404.html",
    "distonyc/index.html",
    "deetz/index.html",
    "admin/index.html",
    "queue/index.html",
    "lyrics/index.html",
    "original-prompt/index.html",
    "fearhunger/index.html",
    "arabic/index.html",
    "wiseau/index.html",
  ]) {
    const html = await readFile(
      new URL(`../dist/${page}`, import.meta.url),
      "utf8",
    );
    assert.match(html, /noindex,\s*nofollow,\s*noarchive/);
    const stamp = html.match(/class="deployment-stamp">Updated at <time datetime="([^"]+)">/);
    assert.ok(stamp && Number.isFinite(Date.parse(stamp[1])), `Missing build timestamp on ${page}`);
    updatedAt ??= stamp[1];
    assert.equal(stamp[1], updatedAt, "All pages must identify the same build");
    assert.match(html, /href="\/assets\/deployment.css"/);
  }
  const notFound = await readFile(
    new URL("../dist/404.html", import.meta.url),
    "utf8",
  );
  assert.match(notFound, /<h1>Lost between tracks\.<\/h1>/);
  const hosting = JSON.parse(
    await readFile(
      new URL("../dist/staticwebapp.config.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(hosting.responseOverrides?.["404"]?.rewrite, "/404.html");
  const files = await readdir(new URL("../dist/", import.meta.url), {
    recursive: true,
  });
  assert.ok(!files.some((file) => /(?:deetz-content|example-plan)\.json$/.test(file)), "Protected guide data entered the public build");
  const gate = await readFile(new URL("../dist/deetz/index.html", import.meta.url), "utf8");
  assert.match(gate, /id="login-form"/);
  assert.doesNotMatch(gate, /id="example"|id="stage-detail"/, "The public gate contains the protected guide");
  assert.ok(
    !files.some((file) =>
      /(^|[\\/])(node_modules|\.env|tests|scripts|\.git|yehry3\.js)/.test(file),
    ),
  );
  for (const file of files.filter((file) => /\.(js|html|json)$/.test(file))) {
    const content = await readFile(
      new URL(`../dist/${file.replaceAll("\\", "/")}`, import.meta.url),
      "utf8",
    );
    assert.ok(!content.includes("wishbone"), `Password leaked in ${file}`);
    assert.ok(
      !content.includes("MONGO_CONN_STR"),
      `Backend config leaked in ${file}`,
    );
  }
});
