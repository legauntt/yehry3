// Read-only post-deployment checks. Interactive writes are verified separately.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const api = process.env.YEHRY3_API_URL || "https://chairlift.fly.dev/yehry3";
// Windows checkouts may use CRLF; compare the same source text deployed on Linux.
const sourceText = (value) => String(value).replace(/\r\n/g, "\n");
const assetContent = (bytes, name) =>
  /\.(js|css|svg)$/.test(name) ? sourceText(bytes) : bytes;
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
let updatedAt;
function verifyTimestamp(html, route) {
  const stamp = html.match(/class="deployment-stamp">Updated at <time datetime="([^"]+)">([^<]+)<\/time>/);
  assert.ok(stamp && Number.isFinite(Date.parse(stamp[1])), `Missing deployment timestamp: ${route}`);
  updatedAt ??= stamp[1];
  assert.equal(stamp[1], updatedAt, `Deployment timestamp differs: ${route}`);
  assert.match(stamp[2], /\d{2}:\d{2} P[DS]T$/);
}
for (const route of [
  "/",
  "/distonyc",
  "/distonyc/",
  "/admin/",
  "/queue/",
  "/lyrics/",
  "/original-prompt/",
]) {
  const response = await get(`${site}${route}`);
  assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
  const html = await response.text();
  verifyTimestamp(html, route);
  assert.match(html, /\/assets\/(app|details).js/);
  assert.match(html, /noindex,nofollow,noarchive/);
  console.log(`Page and headers verified: ${route}`);
}
for (const route of [
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
verifyTimestamp(await (await get(`${site}/deetz/`)).text(), "/deetz/");
for (const path of ["/fearhunger", "/fearhunger/"]) {
  const fearPage = await get(`${site}${path}`);
  const html = await fearPage.text();
  verifyTimestamp(html, path);
  assert.match(
    html,
    /type="module" src="\/fearhunger\/fearhunger.js"/,
  );
}
for (const name of ["fearhunger.js", "fearhunger.css"]) {
  const response = await get(`${site}/fearhunger/${name}`);
  assert.match(response.headers.get("cache-control") || "", /no-cache/);
  assert.equal(
    sourceText(await response.text()),
    sourceText(
      await readFile(new URL(`../fearhunger/${name}`, import.meta.url), "utf8"),
    ),
  );
}
for (const name of [
  "app.js",
  "recording-label.js",
  "details.js",
  "song-data.js",
  "song-summary.js",
  "favorites.js",
  "favorites.css",
  "request-tabs.js",
  "model-info.js",
  "authored-by.js",
  "api.js",
  "config.js",
  "basis.js",
  "remix.js",
  "remix-comparison.js",
  "queue.js",
  "recovery.js",
  "notifications.js",
  "suggestions.js",
  "record-motion.js",
  "record-preferences.js",
  "quality-preference.js",
  "quality-preference.css",
  "lyrics.js",
  "listening.js",
  "original-prompt.js",
  "prompt-brief.js",
  "prompt-brief.css",
  "request-materials.js",
  "request-materials.css",
  "song-plan.js",
  "quality.js",
  "site.css",
  "deployment.css",
  "band-vinyl-v1.webp",
  "record-shoes.svg",
]) {
  const expected = createHash("sha256")
    .update(
      assetContent(
        await readFile(new URL(`../assets/${name}`, import.meta.url)),
        name,
      ),
    )
    .digest("hex");
  const actual = createHash("sha256")
    .update(
      assetContent(
        Buffer.from(await (await get(`${site}/assets/${name}`)).arrayBuffer()),
        name,
      ),
    )
    .digest("hex");
  assert.equal(actual, expected, `${name} differs from the local release`);
}
console.log(`Deployment timestamp verified across all pages: ${updatedAt}`);
const notificationWorker = await get(`${site}/notifications-sw.js`);
assert.match(
  notificationWorker.headers.get("content-type") || "",
  /javascript/,
);
assert.match(notificationWorker.headers.get("cache-control") || "", /no-cache/);
assert.equal(
  sourceText(await notificationWorker.text()),
  sourceText(
    await readFile(new URL("../notifications-sw.js", import.meta.url), "utf8"),
  ),
  "Notification service worker differs from the local release",
);
const queueResponse = await get(`${api}/queue?page=0`, {
  headers: { Origin: site },
});
assert.equal(queueResponse.headers.get("access-control-allow-origin"), site);
const queue = await queueResponse.json();
assert.equal(queue.pageSize, 50);
assert.ok(
  Array.isArray(queue.inStudio) &&
    Array.isArray(queue.needsAttention) &&
    Array.isArray(queue.queued) &&
    Array.isArray(queue.recent),
);
for (const request of [
  ...queue.inStudio,
  ...queue.needsAttention,
  ...queue.queued,
  ...queue.recent,
]) {
  assert.match(request.id, /^distonyc-[a-f0-9]{24}$/);
  for (const field of Object.keys(request))
    assert.ok(
      [
        "id",
        "idea",
        "authoredBy",
        "status",
        "title",
        "submittedAt",
        "updatedAt",
        "progress",
        "publishedAt",
        "url",
        "qualityIssues",
        "voiceModel",
        "originalPrompt",
        "hasSongPlan",
        "recovery",
      ].includes(field),
      `Unexpected public field: ${field}`,
    );
  assert.match(request.voiceModel, /^v[1-9][0-9]*$/);
  if (request.hasSongPlan !== undefined) assert.equal(request.hasSongPlan, true);
  if (request.recovery) {
    assert.equal(request.status, "failed");
    assert.deepEqual(Object.keys(request.recovery).sort(), ["expiresAt", "phase"]);
    assert.ok(["recovering", "attention"].includes(request.recovery.phase));
    assert.ok(Number.isFinite(Date.parse(request.recovery.expiresAt)));
  }
  assert.deepEqual(
    Object.keys(request.originalPrompt).sort(),
    ["basisSongs", "direction", "idea", "keep", "voiceModel"],
  );
  assert.equal(typeof request.originalPrompt.idea, "string");
  assert.equal(typeof request.originalPrompt.direction, "string");
  assert.equal(typeof request.originalPrompt.keep, "string");
  assert.match(request.originalPrompt.voiceModel, /^v[1-9][0-9]*$/);
  assert.ok(
    Array.isArray(request.originalPrompt.basisSongs) &&
      request.originalPrompt.basisSongs.length <= 5,
  );
  if (request.authoredBy !== undefined) {
    assert.equal(typeof request.authoredBy, "string");
    assert.ok(request.authoredBy.length <= 100);
  }
  if (request.qualityIssues) {
    assert.ok(
      Array.isArray(request.qualityIssues) && request.qualityIssues.length <= 3,
    );
    assert.equal(new Set(request.qualityIssues.map((issue) => issue.code)).size, request.qualityIssues.length);
    for (const issue of request.qualityIssues) {
      assert.deepEqual(Object.keys(issue).sort(), ["code", "seconds"]);
      assert.ok(["long_instrumental_outro", "long_instrumental_break", "vocal_dropout"].includes(issue.code));
      assert.ok(
        Number.isFinite(issue.seconds) &&
          ((issue.code === "long_instrumental_outro" && issue.seconds > 13) ||
            (issue.code === "long_instrumental_break" && issue.seconds >= 9.5) ||
            (issue.code === "vocal_dropout" && issue.seconds > 0.4)) &&
          issue.seconds <= 600,
      );
    }
  }
}
const modelsResponse = await get(`${api}/voice-models`, {
  headers: { Origin: site },
});
const models = (await modelsResponse.json()).models;
assert.deepEqual(models.slice(0, 2).map(({ id }) => id), ["v6", "v7"]);
console.log(
  `Anonymous public queue verified: ${queue.inStudioTotal} in studio, ${queue.queuedTotal} waiting, ${queue.recent.length} recent releases.`,
);
const capacityResponse = await get(`${api}/capacity`, { headers: { Origin: site } });
assert.equal(capacityResponse.headers.get("access-control-allow-origin"), site);
assert.equal(capacityResponse.headers.get("cache-control"), "no-store");
const capacity = await capacityResponse.json();
assert.deepEqual(Object.keys(capacity).sort(), ["active", "available", "full", "limit"]);
assert.equal(capacity.limit, 10);
assert.ok(Number.isSafeInteger(capacity.active) && capacity.active >= 0);
assert.equal(capacity.available, Math.max(0, 10 - capacity.active));
assert.equal(capacity.full, capacity.active >= 10);
console.log(`Request capacity verified: ${capacity.active} unfinished, ${capacity.available} available.`);
const catalog = await (await get(`${site}/catalog.json`)).json();
assert.deepEqual(catalog, local);
assert.deepEqual(
  await (await get(`${site}/basis-songs.json`)).json(),
  JSON.parse(
    await readFile(new URL("../basis-songs.json", import.meta.url), "utf8"),
  ),
);
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
for (const song of local.songs) {
  const published = live.songs.find((item) => item.id === song.id);
  if (song.songPlan)
    assert.deepEqual(published?.songPlan, song.songPlan, `Song plan differs for ${song.title}`);
  assert.equal(
    published?.voiceModel,
    song.voiceModel || "v6",
    `Voice model differs for ${song.title}`,
  );
  if (song.qualityIssues)
    assert.deepEqual(
      published?.qualityIssues,
      song.qualityIssues,
      `Quality issues differ for ${song.title}`,
    );
  if (song.lyrics)
    assert.deepEqual(
      published?.lyrics,
      song.lyrics,
      `Lyrics differ for ${song.title}`,
    );
  if (song.collections)
    assert.deepEqual(
      published?.collections,
      song.collections,
      `Collections differ for ${song.title}`,
    );
  if (song.originalPrompt)
    assert.deepEqual(
      published?.originalPrompt,
      {
        ...song.originalPrompt,
        voiceModel:
          song.originalPrompt.voiceModel || song.voiceModel || "v6",
      },
      `Original prompt differs for ${song.title}`,
    );
}
assert.ok(
  local.songs.every((song) => live.songs.some((item) => item.id === song.id)),
  "API is missing catalog songs",
);
console.log(
  `Verified exact public assets, ${local.songs.length} catalog songs, MP3 seeking, and API/CORS.`,
);
