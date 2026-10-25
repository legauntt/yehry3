// Read-only API/cache checks plus real browser checks for an older shared song.
// Never votes, plays audio, redraws, or submits a request.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const api = process.env.YEHRY3_API_URL || "https://chairlift.fly.dev/yehry3";
const out = process.env.YEHRY3_VERIFY_OUT || "artifacts/catalog-snapshot";
await mkdir(out, { recursive: true });
let catalog, etag, unchanged = false;
for (let i = 0; i < 6; i++) {
  const start = performance.now();
  const response = await fetch(`${api}/catalog`, { headers: { Origin: site, ...(etag ? { "If-None-Match": etag } : {}) }, signal: AbortSignal.timeout(15000) });
  const body = await response.text();
  console.log(JSON.stringify({ endpoint: "catalog", status: response.status, ms: Math.round(performance.now() - start), decodedBytes: Buffer.byteLength(body), cache: response.headers.get("x-catalog-cache"), serverTiming: response.headers.get("server-timing") }));
  assert.match(response.headers.get("cache-control"), /public, no-cache/);
  assert.match(response.headers.get("access-control-expose-headers"), /ETag/);
  if (response.status === 304) { assert.equal(body, ""); unchanged = true; break; }
  assert.equal(response.status, 200);
  catalog = JSON.parse(body); etag = response.headers.get("etag");
  assert.ok(etag); assert.ok(catalog.songs.length > 25);
  assert.equal(catalog.nextVoteAt, undefined);
  assert.ok(catalog.songs.every(song => !Object.hasOwn(song, "feedback") && !Object.hasOwn(song, "remixSource")));
}
assert.ok(unchanged, "An unchanged catalog should support a body-free refresh");
const state = await fetch(`${api}/catalog/state`, { headers: { "X-Visitor-ID": randomUUID(), Origin: site }, signal: AbortSignal.timeout(15000) });
assert.equal(state.status, 200); assert.equal(state.headers.get("cache-control"), "private, no-store");
const personal = await state.text();
assert.deepEqual(JSON.parse(personal).feedback, {});
console.log(JSON.stringify({ endpoint: "catalog/state", decodedBytes: Buffer.byteLength(personal), serverTiming: state.headers.get("server-timing") }));

// An OG track is deliberately far from the default first page. The share route
// resets filters itself; assert that pagination actually moved to find it.
const selected = catalog.songs.find(song => song.id === "medusa") || catalog.songs.at(-1);
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("yehry3:listeners-hidden", "true"));
    const page = await context.newPage(), errors = [], responses = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (new URL(response.url()).pathname === "/yehry3/catalog") responses.push(response.status()); });
    await page.goto(`${site}/song/${encodeURIComponent(selected.id)}/`);
    const row = page.locator(`.track[data-id="${selected.id}"]`);
    await expect(row).toHaveClass(/is-share-spotlight/, { timeout: 20000 });
    await expect(row).toBeInViewport();
    const pageNumber = Number(new URL(page.url()).searchParams.get("page") || "1");
    assert.ok(pageNumber > 1, "The verification song must exercise an older catalog page");
    // This exercises actual CORS-exposed ETags, not a route mock. Refreshes also
    // preserve the share spotlight and its scroll position after a 304.
    for (let i = 0; i < 6 && !responses.includes(304); i++) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === "/yehry3/catalog");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await response;
      await expect(row).toHaveClass(/is-share-spotlight/);
    }
    assert.ok(responses.includes(304), "Browser must be able to read and resend the ETag");
    await expect(row).toBeInViewport();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/older-share-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ viewport: width, sharedSong: selected.id, page: pageNumber, responses, errors }));
    await context.close();
  }
} finally { await browser.close(); }
