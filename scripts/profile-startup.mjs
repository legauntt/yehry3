// Repeatable, anonymous browser startup audit. No votes, playback, or requests are submitted.
// Fresh contexts are cold browser caches, not a cold CDN/server or operating-system DNS cache.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.split('=').slice(1).join('=') ?? fallback;
const site = arg('url', 'https://yehry3.app/');
const out = path.resolve(arg('out', 'artifacts/startup'));
const runs = Number(arg('runs', '3'));
const view = arg('view', 'grid');
const diagnostic = arg('diagnostic', 'false') === 'true';
const scenarios = arg('scenarios', 'desktop,phone,slow-phone').split(',');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const round = number => Math.round(number * 10) / 10;

function observe({ view }) {
  localStorage.setItem('yehry3:catalog-view', view);
  localStorage.setItem('yehry3:listeners-hidden', 'true');
  const audit = window.__startupAudit = { milestones: {}, fetches: [], longTasks: [], paints: [], shifts: [] };
  const mark = name => { audit.milestones[name] ??= performance.now(); };
  const paint = name => requestAnimationFrame(() => requestAnimationFrame(() => mark(name)));
  for (const [type, key] of [['longtask', 'longTasks'], ['paint', 'paints'], ['largest-contentful-paint', 'lcp'], ['layout-shift', 'shifts']]) {
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries().map(entry => entry.toJSON());
        if (key === 'lcp') audit.lcp = entries.at(-1);
        else audit[key].push(...entries);
      }).observe({ type, buffered: true });
    } catch { /* Some engines omit optional diagnostics. */ }
  }
  const fetch = window.fetch;
  window.fetch = async function (...args) {
    const record = { url: String(args[0]), start: performance.now() };
    audit.fetches.push(record);
    try {
      const response = await fetch.apply(this, args);
      record.headers = performance.now();
      record.status = response.status;
      const json = response.json.bind(response);
      response.json = async () => {
        record.jsonStart = performance.now();
        const body = await json();
        record.jsonEnd = performance.now();
        if (Array.isArray(body.songs)) record.songCount = body.songs.length;
        return body;
      };
      return response;
    } catch (error) { record.error = error.message; record.end = performance.now(); throw error; }
  };
  document.addEventListener('DOMContentLoaded', () => mark('domContentLoaded'));
  window.addEventListener('load', () => mark('load'));
  new MutationObserver(() => {
    if (document.querySelector('#tracks')) mark('collectionShell');
    const rows = document.querySelectorAll('#tracks > .track');
    if (rows.length && !audit.milestones.firstCardsDom) {
      mark('firstCardsDom');
      paint('firstCardsPaint');
      const img = rows[0].querySelector('.track-art');
      img?.decode().then(() => { mark('firstArtDecoded'); paint('firstArtPaint'); }).catch(() => {});
    }
    const count = document.querySelector('#track-count')?.textContent || '';
    if (rows.length && count && !/Loading/.test(count) && !audit.milestones.fullCatalogDom) {
      mark('fullCatalogDom');
      paint('fullCatalogPaint');
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
}

async function sample(context, scenario, cache, run) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (scenario === 'slow-phone') {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, connectionType: 'cellular4g' });
  }
  const network = new Map();
  const errors = [];
  let start;
  page.on('pageerror', error => errors.push(error.message));
  cdp.on('Network.requestWillBeSent', event => {
    if (!/^https?:/.test(event.request.url)) return;
    if (event.type === 'Document' && start === undefined) start = event.timestamp;
    network.set(event.requestId, { url: event.request.url, method: event.request.method, type: event.type, start: event.timestamp, initiator: event.initiator, decodedBytes: 0 });
  });
  cdp.on('Network.responseReceived', event => {
    const item = network.get(event.requestId);
    if (!item) return;
    const r = event.response;
    Object.assign(item, { headersAt: event.timestamp, status: r.status, timing: r.timing, protocol: r.protocol, diskCache: r.fromDiskCache, serviceWorker: r.fromServiceWorker,
      serverTiming: Object.entries(r.headers).find(([key]) => key.toLowerCase() === 'server-timing')?.[1], encoding: Object.entries(r.headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1] });
  });
  cdp.on('Network.dataReceived', event => { const item = network.get(event.requestId); if (item) item.decodedBytes += event.dataLength; });
  cdp.on('Network.loadingFinished', event => { const item = network.get(event.requestId); if (item) Object.assign(item, { end: event.timestamp, encodedBytes: event.encodedDataLength }); });
  cdp.on('Network.loadingFailed', event => { const item = network.get(event.requestId); if (item) Object.assign(item, { end: event.timestamp, error: event.errorText }); });
  if (diagnostic) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  }
  await page.addInitScript(observe, { view });
  const metrics = {};
  await page.goto(site, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => window.__startupAudit?.milestones.firstCardsPaint, undefined, { timeout: 60000 });
  metrics.firstCards = (await cdp.send('Performance.getMetrics')).metrics;
  await page.waitForFunction(() => window.__startupAudit?.milestones.fullCatalogPaint, undefined, { timeout: 60000 });
  metrics.fullCatalog = (await cdp.send('Performance.getMetrics')).metrics;
  // Allow fonts and non-blocking startup requests to finish; exclude 30-second polling.
  await page.waitForTimeout(diagnostic ? 3000 : 1500);
  const audit = await page.evaluate(() => ({ ...window.__startupAudit,
    navigation: performance.getEntriesByType('navigation')[0].toJSON(),
    resources: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).map(entry => entry.toJSON()),
    marks: performance.getEntriesByType('measure').map(entry => entry.toJSON()),
    count: document.querySelector('#track-count')?.textContent,
    cards: [...document.querySelectorAll('#tracks > .track')].map(el => ({ id: el.dataset.id, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
    overflow: document.documentElement.scrollWidth > innerWidth,
    build: document.querySelector('[data-deployment-time]')?.textContent || document.querySelector('.deployment-stamp')?.textContent,
  }));
  const label = `${scenario}-${cache}-${run}`;
  if (diagnostic) {
    const cpu = await cdp.send('Profiler.stop');
    await writeFile(path.join(out, `${label}.cpuprofile`), JSON.stringify(cpu.profile));
    const js = await page.coverage.stopJSCoverage(), css = await page.coverage.stopCSSCoverage();
    const cssCoverage = css.filter(item => item.text !== undefined).map(({ url, text, ranges }) => ({ url, bytes: Buffer.byteLength(text), usedBytes: ranges.reduce((sum, r) => sum + Buffer.byteLength(text.slice(r.start, r.end)), 0) }));
    const jsCoverage = js.filter(item => item.source !== undefined).map(({ url, source, functions }) => {
      // V8 nests unexecuted blocks inside executed functions (and vice versa).
      // Paint broad ranges first so the narrowest block decides each character.
      const used = new Uint8Array(source.length);
      const ranges = functions.flatMap(fn => fn.ranges).sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
      for (const range of ranges) used.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
      let usedBytes = 0;
      for (let at = 0; at < source.length;) {
        const begin = at, active = used[at];
        while (at < source.length && used[at] === active) at++;
        if (active) usedBytes += Buffer.byteLength(source.slice(begin, at));
      }
      return { url, bytes: Buffer.byteLength(source), usedBytes };
    });
    audit.coverage = { js: jsCoverage, css: cssCoverage };
  }
  for (const item of network.values()) for (const key of ['start', 'headersAt', 'end']) if (item[key] !== undefined) item[key] = round((item[key] - start) * 1000);
  const result = { scenario, cache, run, ...audit, metrics, network: [...network.values()], errors };
  results.push(result);
  await writeFile(path.join(out, `${label}.json`), JSON.stringify(result, null, 2));
  if (run === 1 && cache === 'cold') {
    await page.locator('.catalog-view-bar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${label}.png`) });
  }
  console.log(JSON.stringify({ scenario, cache, run, milestones: Object.fromEntries(Object.entries(audit.milestones).map(([key, value]) => [key, round(value)])), requests: network.size, errors }));
  await page.close();
}

try {
  for (const scenario of scenarios) for (let run = 1; run <= runs; run++) {
    const phone = scenario !== 'desktop';
    const context = await browser.newContext({ viewport: { width: phone ? 390 : 1440, height: phone ? 844 : 1000 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1 });
    try {
      await sample(context, scenario, 'cold', run);
      if (!diagnostic) await sample(context, scenario, 'warm', run);
    } finally { await context.close(); }
  }
} finally {
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), site, view, diagnostic, browser: browser.version(), host: { platform: os.platform(), cpu: os.cpus()[0]?.model }, conditions: { slowPhone: '4x CPU slowdown, 150 ms latency, 1.6 Mbps down / 750 Kbps up', warm: 'Second navigation in same browser context; normal HTTP caching/revalidation' }, results }, null, 2));
  await browser.close();
}
