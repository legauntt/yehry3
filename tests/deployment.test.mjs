import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codeVersion } from "../scripts/code-version.mjs";

const dist = new URL("../dist/", import.meta.url);

test("every built page carries a comparable build stamp and the update watcher", async () => {
  const published = JSON.parse(await readFile(new URL("deployment.json", dist), "utf8"));
  const updatedAt = Date.parse(published.updatedAt);
  assert.ok(Number.isFinite(updatedAt), "deployment.json needs a parsable updatedAt");
  assert.match(published.updatedLabel, /[A-Z][a-z]{2}-\d{2}-\d{4} \d{2}:\d{2} [A-Z]{2,5}/);
  const pages = (await readdir(dist, { recursive: true })).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length > 10);
  for (const page of pages) {
    const html = await readFile(new URL(page.replaceAll("\\", "/"), dist), "utf8");
    assert.ok(html.includes('<script type="module" src="/assets/deployment.js"></script>'), `${page} is missing the update watcher`);
    const stamp = /<small class="deployment-stamp">Updated at <time datetime="([^"]+)">/.exec(html);
    assert.ok(stamp, `${page} is missing its build stamp`);
    assert.equal(Date.parse(stamp[1]), updatedAt, `${page} disagrees with deployment.json`);
    assert.match(published.code, /^[0-9a-f]{16}$/);
    assert.ok(html.includes(`<meta name="yehry3-code" content="${published.code}" />`), `${page} disagrees with deployment.json about the code version`);
  }
});

async function tree(files) {
  const root = await mkdtemp(path.join(tmpdir(), "yehry3-code-version-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return root;
}

test("publishing songs, lyrics and clips leaves the code version alone; code changes move it", async () => {
  const base = {
    "index.html": "<html></html>",
    "assets/app.js": "export const a = 1;\n",
    "assets/site.css": "body{}",
    "staticwebapp.config.json": '{"routes":[]}',
    "catalog.json": '{"songs":[]}',
    "basis-songs.json": "[]",
    "wiseau/clips.json": '{"clips":[]}',
    "wiseau/index.html": "<html>wiseau</html>",
    "wiseau/aaaaaaaa.mp3": "audio",
  };
  const entries = ["index.html", "assets", "staticwebapp.config.json", "catalog.json", "basis-songs.json", "wiseau"];
  const before = await codeVersion(await tree(base), entries);
  assert.match(before, /^[0-9a-f]{16}$/);
  const data = await codeVersion(await tree({
    ...base,
    "catalog.json": '{"songs":[{"id":"x","lyrics":{"text":"new words"}}]}',
    "basis-songs.json": '["x"]',
    "wiseau/clips.json": '{"clips":[{"id":"bbbbbbbb"}]}',
    "wiseau/bbbbbbbb.mp3": "more audio",
  }), entries);
  assert.equal(data, before, "a data-only publication must not look like a new version of the site");
  // Windows checkouts convert line endings; the deploy build must agree with them.
  assert.equal(await codeVersion(await tree({ ...base, "assets/app.js": "export const a = 1;\r\n" }), entries), before);
  for (const change of [
    { "assets/app.js": "export const a = 2;\n" },
    { "assets/site.css": "body{color:red}" },
    { "index.html": "<html><body></body></html>" },
    { "staticwebapp.config.json": '{"routes":[{"route":"/x"}]}' },
    { "assets/new-feature.js": "export {};" },
  ]) {
    assert.notEqual(await codeVersion(await tree({ ...base, ...change }), entries), before, `${Object.keys(change)} should change the version`);
  }
});

test("the published deployment record is never cached", async () => {
  const hosting = JSON.parse(await readFile(new URL("staticwebapp.config.json", dist), "utf8"));
  const route = hosting.routes.find((entry) => entry.route === "/deployment.json");
  assert.deepEqual(route?.headers, { "Cache-Control": "no-store" });
});
