// Read-only post-deployment checks. Interactive writes are verified separately.
import assert from "node:assert/strict";
import { normalizeGeneration } from "../assets/generation-options.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { publicCatalog } from "./archived-songs.mjs";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const api = process.env.YEHRY3_API_URL || "https://chairlift.fly.dev/yehry3";
// Windows checkouts may use CRLF; compare the same source text deployed on Linux.
const sourceText = (value) => String(value).replace(/\r\n/g, "\n");
const assetContent = (bytes, name) =>
  /\.(js|css|svg)$/.test(name) ? sourceText(bytes) : bytes;
const local = JSON.parse(
  await readFile(new URL("../catalog.json", import.meta.url), "utf8"),
);
async function get(url, { timeoutMs = 20000, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
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
{
  // Open tabs compare this record against the stamp their own page carries.
  const response = await get(`${site}/deployment.json`);
  assert.match(response.headers.get("cache-control") || "", /no-store|no-cache/);
  const published = await response.json();
  assert.equal(published.updatedAt, updatedAt, "Deployment record differs from the served pages");
  console.log(`Deployment record verified: ${published.updatedLabel}`);
}
verifyTimestamp(await (await get(`${site}/deetz/`)).text(), "/deetz/");
{
  // Azure's default directory handling serves all three forms without a redirect.
  for (const route of ["/aci", "/aci/", "/aci/index.html"]) {
    const response = await get(`${site}${route}`);
    assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(response.headers.get("cache-control") || "", /no-cache/);
    const html = await response.text();
    verifyTimestamp(html, route);
    assert.match(html, /DEMO PREVIEW/);
    assert.match(html, /\/aci\/aci.js/);
    assert.doesNotMatch(html, /\/assets\/(listeners|app|player|api|shell)\.js/);
  }
  for (const name of ["aci.js", "aci.css", "model.js"]) {
    const asset = await get(`${site}/aci/${name}`);
    assert.match(asset.headers.get("cache-control") || "", /no-cache/);
    assert.equal(sourceText(await asset.text()), sourceText(await readFile(new URL(`../aci/${name}`, import.meta.url), "utf8")));
  }
  console.log("ACI demo, isolated assets, directory routes and headers verified.");
}
{
  const response = await get(`${site}/sausage/`);
  assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
  const html = await response.text();
  verifyTimestamp(html, "/sausage/");
  assert.match(html, /\/assets\/sausage.js/);
  for (const name of ["sausage.js", "sausage.css"]) {
    assert.equal(sourceText(await (await get(`${site}/assets/${name}`)).text()),
      sourceText(await readFile(new URL(`../assets/${name}`, import.meta.url), "utf8")));
  }
  const tour = JSON.parse(await readFile(new URL("../sausage/tour.json", import.meta.url), "utf8"));
  assert.deepEqual(await (await get(`${site}/sausage/tour.json`)).json(), tour);
  for (const run of tour.runs) {
    for (const clip of Object.values(run.clips)) {
      const bytes = await readFile(new URL(`..${clip}`, import.meta.url));
      const served = await get(`${site}${clip}`, { headers: { Range: "bytes=0-1023" } });
      assert.equal(served.status, 206, `Excerpt does not support seeking: ${clip}`);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes.subarray(0, 1024));
    }
    const final = await get(run.song.url, { headers: { Range: "bytes=0-1023" } });
    assert.equal(final.status, 206, `Full song does not support seeking: ${run.song.title}`);
  }
  console.log("Production tour, ten audio excerpts and both full-song ranges verified.");
}
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
  "catalog-view.js",
  "catalog-view.css",
  "song-art.js",
  "artwork/weird-hair-weird-smells-tattoo.webp",
  "art-remix.js",
  "art-draw.js",
  "details.js",
  "song-data.js",
  "song-summary.js",
  "repair-status.js",
  "music-provenance.js",
  "song-cost.js",
  "settled-song-costs.js",
  "music-provenance.css",
  "favorites.js",
  "favorites.css",
  "request-tabs.js",
  "model-info.js",
  "voice-choice.js",
  "generation.js",
  "music-backend.js",
  "generation-options.js",
  "generation-controls.js",
  "generation-brief.js",
  "pitch-repair.js",
  "sides.js",
  "authored-by.js",
  "api.js",
  "config.js",
  "basis.js",
  "remix.js",
  "remix-comparison.js",
  "queue.js",
  "recovery.js",
  "dehaka.js",
  "worker-presence.js",
  "notifications.js",
  "suggestions.js",
  "record-motion.js",
  "record-preferences.js",
  "quality-preference.js",
  "quality-preference.css",
  "lyrics.js",
  "lyric-prompts.js",
  "listening.js",
  "listeners.js",
  "realtime.js",
  "listeners.css",
  "original-prompt.js",
  "prompt-brief.js",
  "prompt-brief.css",
  "request-materials.js",
  "request-materials.css",
  "lyric-workshop.js",
  "lyric-workshop-progress.js",
  "lyric-workshop.css",
  "song-plan.js",
  "quality.js",
  "site.css",
  "deployment.css",
  "deployment.js",
  "loop.js",
  "song-badges.js",
  "remix-badge.js",
  "remix-trace.js",
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
const generationSchema = JSON.parse(await readFile(new URL("../assets/generation-schema.json", import.meta.url), "utf8"));
const materials = await (await get(`${api}/request-materials`)).json();
assert.equal(materials.lyricPromptHistory, true, "API does not yet preserve chosen lyric prompt history");
console.log("Chosen lyric prompt history API support verified.");
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
        "reviewState", "validationFailures",
        "voiceModel",
        "generationProfile",
        "originalPrompt",
        "hasSongPlan",
        "remixOf",
        "recovery",
      ].includes(field),
      `Unexpected public field: ${field}`,
    );
  assert.match(request.voiceModel, /^v[1-9][0-9]*$/);
  if (request.remixOf) {
    // The source recording's URL and hashes stay out of the public queue.
    assert.deepEqual(Object.keys(request.remixOf).sort(), ["songId", "title"]);
    assert.match(request.remixOf.songId, /^[a-z0-9-]{1,120}$/);
    assert.ok(typeof request.remixOf.title === "string" && request.remixOf.title.trim());
  }
  if (request.generationProfile !== undefined) assert.equal(request.generationProfile, "v8");
  if (request.hasSongPlan !== undefined) assert.equal(request.hasSongPlan, true);
  if (request.recovery) {
    assert.equal(request.status, "failed");
    assert.deepEqual(Object.keys(request.recovery).sort(), ["expiresAt", "phase"]);
    assert.ok(["recovering", "attention"].includes(request.recovery.phase));
    assert.ok(Number.isFinite(Date.parse(request.recovery.expiresAt)));
  }
  assert.deepEqual(
    Object.keys(request.originalPrompt).sort(),
    ["basisSongs", "direction", "idea", "keep", "voiceModel", ...(request.originalPrompt.musicBackend ? ["musicBackend"] : []), ...(request.originalPrompt.generation ? ["generation", "generationProfile"] : [])].sort(),
  );
  if (request.originalPrompt.musicBackend !== undefined) assert.ok(["local", "eleven_music"].includes(request.originalPrompt.musicBackend));
  if (request.originalPrompt.generation) {
    assert.equal(request.originalPrompt.generationProfile, "v8");
    assert.deepEqual(normalizeGeneration(request.originalPrompt.generation, generationSchema), request.originalPrompt.generation);
  }
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
      Array.isArray(request.qualityIssues) && request.qualityIssues.length <= 5,
    );
    assert.equal(new Set(request.qualityIssues.map((issue) => issue.code)).size, request.qualityIssues.length);
    for (const issue of request.qualityIssues) {
      if (issue.code === "unconfirmed_lyric_ending") {
        assert.deepEqual(Object.keys(issue), ["code"]);
        continue;
      }
      assert.deepEqual(Object.keys(issue).sort(), ["code", "seconds"]);
      assert.ok(["long_instrumental_outro", "long_instrumental_break", "vocal_dropout", "early_lyric_ending"].includes(issue.code));
      assert.ok(
        Number.isFinite(issue.seconds) &&
          ((issue.code === "long_instrumental_outro" && issue.seconds > 13) ||
            (issue.code === "long_instrumental_break" && issue.seconds >= 9.5) ||
            (issue.code === "vocal_dropout" && issue.seconds > 0.4) ||
            (issue.code === "early_lyric_ending" && issue.seconds > 20)) &&
          issue.seconds <= 1440,
      );
    }
    // Advisory issues do not imply a failed validation.

  }
  if (request.reviewState !== undefined) {
    assert.equal(request.reviewState, "needs_review");
    assert.equal(request.status, "published");
    assert.ok(request.validationFailures?.length);
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
const pinsResponse = await get(`${api}/song-pins`, { headers: { Origin: site } });
assert.equal(pinsResponse.headers.get("access-control-allow-origin"), site);
assert.equal(pinsResponse.headers.get("cache-control"), "no-store");
const startupPins = await pinsResponse.json();
assert.deepEqual(Object.keys(startupPins), ["pins"]);
assert.ok(Array.isArray(startupPins.pins));
for (const pin of startupPins.pins) {
  assert.deepEqual(Object.keys(pin).sort(), ["id", "pins"]);
  assert.match(pin.id, /^[a-z0-9-]{1,120}$/);
  assert.ok(Number.isSafeInteger(pin.pins) && pin.pins > 0);
}
console.log(`Public startup pin counts verified: ${startupPins.pins.length} songs.`);
const firstPageResponse = await get(`${api}/songs/first-page`, { headers: { "X-Visitor-ID": randomUUID(), Origin: site } });
assert.equal(firstPageResponse.headers.get("access-control-allow-origin"), site);
assert.equal(firstPageResponse.headers.get("cache-control"), "no-store");
const firstPage = await firstPageResponse.json();
assert.equal(firstPage.pageSize, 25);
assert.ok(Number.isInteger(firstPage.total) && firstPage.total >= firstPage.songs.length);
assert.equal(firstPage.songs.length, Math.min(firstPage.total, 25));
assert.ok(firstPage.songs.every(song => song.id && song.feedback && !song.lyrics && !song.songPlan && !song.originalPrompt));
console.log(`Initial catalog page verified: ${firstPage.songs.length} of ${firstPage.total} songs.`);
// Songs archived in Backstage are built out of the fallback, so expect the catalog minus what the API reports archived.
const reported = await (await get(`${api}/songs/summary`, { headers: { "X-Visitor-ID": randomUUID(), Origin: site } })).json();
const archived = Array.isArray(reported.archived) ? reported.archived : [];
const expected = publicCatalog(local, archived);
const catalog = await (await get(`${site}/catalog.json`)).json();
assert.deepEqual(catalog, expected);
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
  // This legacy response includes every lyric sheet and plan (over 2 MB).
  // The dashboard uses /songs/summary; keep its and all other reads' 20s bound.
  timeoutMs: 45000,
  headers: { "X-Visitor-ID": randomUUID(), Origin: site },
});
assert.equal(response.headers.get("access-control-allow-origin"), site);
const live = await response.json();
for (const song of expected.songs) {
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
  expected.songs.every((song) => live.songs.some((item) => item.id === song.id)),
  "API is missing catalog songs",
);
assert.ok(
  !live.songs.some((song) => archived.includes(song.id)),
  "API still lists archived songs",
);
const eventResponse = await get(`${api}/events`, { headers: { Origin: site } });
assert.match(eventResponse.headers.get("cache-control") || "", /no-store/);
const checkEvents = (packet) => {
  assert.match(packet?.version || "", /^[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(packet.topics).sort(), ["catalog", "listeners"]);
  assert.deepEqual(Object.keys(packet.topics.catalog), ["version"]);
  assert.equal(packet.version, packet.topics.listeners.version + packet.topics.catalog.version);
  assert.ok(Array.isArray(packet.topics.listeners.listeners));
};
checkEvents(await eventResponse.json());
await new Promise((resolve, reject) => {
  const socket = new WebSocket(`${api.replace(/^http/, "ws")}/events/socket`);
  const timer = setTimeout(() => { socket.close(); reject(new Error("Public event socket timed out")); }, 10000);
  const finish = (error) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(); };
  socket.addEventListener("message", event => {
    try { checkEvents(JSON.parse(event.data)); finish(); } catch (error) { finish(error); }
  }, { once: true });
  socket.addEventListener("error", () => finish(new Error("Public event socket failed")), { once: true });
});
console.log(
  `Verified exact public assets, ${expected.songs.length} catalog songs (${archived.length} archived), MP3 seeking, API/CORS, and public event polling/socket.`,
);
