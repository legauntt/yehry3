// Read-only live QA; local QA also uses a synthetic silent track to check continuity.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import artwork from "../assets/artwork-catalog.js";

const site = process.env.YEHRY3_SITE_URL || "https://yehry3.app";
const local = new URL(site).hostname === "127.0.0.1";
const csp = JSON.parse(await readFile(new URL("../staticwebapp.config.json", import.meta.url), "utf8")).globalHeaders["Content-Security-Policy"];
const output = path.resolve(process.env.ARTWORK_QA_DIR || "artifacts/cover-viewer");
await mkdir(output, { recursive: true });
const id = "distonyc-06d2b8c3c8dffed19df347bb";
const original = artwork[id].src;
const measurements = [];
for (const name of ["artwork-previews.js", "artwork-previews.css"]) {
  const response = await fetch(`${site}/assets/${name}`, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).replace(/\r\n/g, "\n"),
    (await readFile(new URL(`../dist/assets/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n"), `Deployed preview manifest matches: ${name}`);
}
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of [
    { name: "desktop-grid", width: 1440, height: 1000, deviceScaleFactor: 1, view: "grid" },
    { name: "desktop-list", width: 1440, height: 1000, deviceScaleFactor: 1, view: "list" },
    { name: "phone-grid", width: 390, height: 844, deviceScaleFactor: 3, view: "grid" },
    { name: "phone-list", width: 390, height: 844, deviceScaleFactor: 3, view: "list" },
  ]) {
    const context = await browser.newContext({ viewport: scenario, deviceScaleFactor: scenario.deviceScaleFactor,
      isMobile: scenario.name.startsWith("phone"), hasTouch: scenario.name.startsWith("phone") });
    await context.addInitScript(view => {
      localStorage.setItem("yehry3:catalog-view", view);
      localStorage.setItem("yehry3:listeners-hidden", "true");
    }, scenario.view);
    const page = await context.newPage();
    const errors = [], requested = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      window.coverCspViolations = [];
      document.addEventListener("securitypolicyviolation", event => {
        if (event.violatedDirective.startsWith("style") || event.violatedDirective.startsWith("img"))
          window.coverCspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
      });
    });
    page.on("request", request => requested.push(new URL(request.url()).pathname));
    // Offline fallback avoids test services and never changes the live catalog.
    if (local) {
      await page.route(`${site}/**`, async route => {
        if (route.request().resourceType() !== "document") return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
      });
      await page.route("http://127.0.0.1:3000/**", route => route.abort());
    }
    await page.goto(`${site}/?q=It%20Was%20Simple%2C%20Not%20Easy`, { waitUntil: "domcontentloaded" });
    const card = page.locator(`[data-id="${id}"]`);
    await card.waitFor({ timeout: 45000 });
    await card.scrollIntoViewIfNeeded();
    const image = card.locator("img.track-art");
    await image.evaluate(img => img.decode());
    const geometry = await image.evaluate(img => ({ src: img.currentSrc, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height, sizes: img.sizes }));
    console.log(scenario.name, geometry);
    assert.notEqual(new URL(geometry.src).pathname, original, "Card must fetch a small preview");
    assert.ok(!requested.includes(original), "Original is not loaded before enlargement");
    const response = await context.request.get(geometry.src);
    assert.equal(response.status(), 200);
    if (!local) assert.match(response.headers()["cache-control"], /max-age=31536000.*immutable/);
    const bytes = await response.body(), metadata = await sharp(bytes).metadata();
    assert.ok(metadata.width >= Math.min(640, geometry.width * scenario.deviceScaleFactor) - 2, "Preview retains screen-density detail");
    const minimum = [160, 320, 640, 1024].find(width => width >= geometry.width * scenario.deviceScaleFactor);
    assert.ok(metadata.width <= minimum, "Preview is no larger than needed");
    measurements.push({ scenario: scenario.name, cssWidth: geometry.width, density: scenario.deviceScaleFactor, pixels: metadata.width, bytes: bytes.length });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`) });

    // Use a synthetic, same-origin silent WAV locally, not a real song/listen.
    if (local) {
      const samples = 48000 * 20, wav = Buffer.alloc(44 + samples * 2);
      wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
      await page.route("**/__cover-test.wav", route => route.fulfill({ contentType: "audio/wav", body: wav }));
      await page.evaluate(async () => {
        const { player } = await import("/assets/player.js");
        window.coverTestAudio = player.audio;
        player.audio.src = "/__cover-test.wav";
        await player.audio.play();
      });
    }
    const trigger = card.locator("[data-cover-open]");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "It Was Simple, Not Easy" });
    await dialog.waitFor();
    await dialog.locator("img").evaluate(img => img.decode());
    assert.equal(new URL(await dialog.locator("img").getAttribute("src"), site).pathname, original);
    assert.equal(await dialog.locator("img").getAttribute("srcset"), null);
    assert.equal(await dialog.locator("img").evaluate(img => img.naturalWidth), 1024);
    await page.screenshot({ path: path.join(output, `${scenario.name}-viewer.png`) });
    await dialog.getByRole("button", { name: "Actual size" }).click();
    assert.equal(await dialog.locator("img").evaluate(img => img.getBoundingClientRect().width), 1024);
    await dialog.getByRole("button", { name: "Fit image" }).click();
    await dialog.getByRole("button", { name: "Close cover" }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-cover-zoom")), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute("data-cover-close")), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
    await trigger.click();
    await page.mouse.click(2, 2);
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => !document.documentElement.classList.contains("cover-viewer-open"));
    if (local) assert.equal(await page.evaluate(async () => {
      const { player } = await import("/assets/player.js");
      return player.audio === window.coverTestAudio && !player.audio.paused && player.audio.currentTime > 0;
    }), true, "The same audio element continues playing through zoom and dismissal");
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.coverCspViolations), []);
    await context.close();
  }
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(measurements, null, 2) + "\n");
  console.log(JSON.stringify(measurements, null, 2));
  console.log(`Verified responsive selection, deferred originals, full-size/fit, focus, Escape, backdrop, mobile overflow${local ? " and uninterrupted playback" : ""}. Screenshots: ${output}`);
} finally { await browser.close(); }
