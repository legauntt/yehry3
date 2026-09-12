// Read-only post-deployment checks. Interactive writes are verified separately.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const api = process.env.YEHRY3_API_URL || "https://chairlift.fly.dev/yehry3";
const local = JSON.parse(
  await readFile(new URL("../catalog.json", import.meta.url), "utf8"),
);
async function get(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(response.ok, `${url} returned ${response.status}`);
  return response;
}
for (const route of ["/", "/distonyc/", "/admin/"]) {
  const response = await get(`${site}${route}`);
  assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
  const html = await response.text();
  assert.match(html, /\/assets\/app.js/);
  assert.match(html, /noindex,nofollow,noarchive/);
  console.log(`Page and headers verified: ${route}`);
}
for (const route of [
  "/distonyc",
  "/longtimecomin",
  "/longtimecomin/",
  "/longtimecomin/index.html",
]) {
  const response = await fetch(`${site}${route}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 301, `Missing permanent redirect: ${route}`);
  assert.equal(
    new URL(response.headers.get("location"), site).pathname,
    "/distonyc/",
  );
}
console.log("Distonyc route and legacy aliases verified.");
for (const name of ["app.js", "api.js", "config.js", "site.css"]) {
  const expected = createHash("sha256")
    .update(await readFile(new URL(`../assets/${name}`, import.meta.url)))
    .digest("hex");
  const actual = createHash("sha256")
    .update(
      Buffer.from(await (await get(`${site}/assets/${name}`)).arrayBuffer()),
    )
    .digest("hex");
  assert.equal(actual, expected, `${name} differs from the local release`);
}
const catalog = await (await get(`${site}/catalog.json`)).json();
assert.deepEqual(catalog, local);
const sample = local.songs.find((song) => song.collection === "fearhunger");
const range = await get(new URL(sample.url, site), {
  headers: { Range: "bytes=0-1023" },
});
assert.equal(range.status, 206);
assert.equal((await range.arrayBuffer()).byteLength, 1024);
const response = await get(`${api}/songs`, {
  headers: { "X-Visitor-ID": randomUUID(), Origin: site },
});
assert.equal(response.headers.get("access-control-allow-origin"), site);
const live = await response.json();
assert.ok(
  local.songs.every((song) => live.songs.some((item) => item.id === song.id)),
  "API is missing catalog songs",
);
console.log(
  `Verified exact public assets, ${local.songs.length} catalog songs, MP3 seeking, and API/CORS.`,
);
