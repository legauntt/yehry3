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
    if (song.url.startsWith("/"))
      assert.ok(
        (await stat(new URL(`..${song.url}`, import.meta.url))).size > 1000000,
      );
  }
});
test("all routes are built, unlisted, and contain no submission password or backend source", async () => {
  for (const page of [
    "index.html",
    "distonyc/index.html",
    "admin/index.html",
    "queue/index.html",
    "lyrics/index.html",
    "original-prompt/index.html",
  ]) {
    const html = await readFile(
      new URL(`../dist/${page}`, import.meta.url),
      "utf8",
    );
    assert.match(html, /noindex,nofollow,noarchive/);
  }
  const files = await readdir(new URL("../dist/", import.meta.url), {
    recursive: true,
  });
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
