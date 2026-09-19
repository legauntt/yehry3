import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

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
  }
});

test("the published deployment record is never cached", async () => {
  const hosting = JSON.parse(await readFile(new URL("staticwebapp.config.json", dist), "utf8"));
  const route = hosting.routes.find((entry) => entry.route === "/deployment.json");
  assert.deepEqual(route?.headers, { "Cache-Control": "no-store" });
});
