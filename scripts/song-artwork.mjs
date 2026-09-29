#!/usr/bin/env node
// Maintained wrapper around the installed Imagegen skill CLI. No API key or
// source packets enter the site. plan is read-only; run is explicitly paid.
import { readFile, writeFile, mkdir, rename, open, unlink, access, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { POLICY, treatments, selectTreatment, sourcePacket, makePrompt, makeReviewedPrompt, digest, estimateCost, isPinnedOrUnknown } from "./artwork-policy.mjs";
import { reserveJobs, budgetMonth } from "./artwork-budget.mjs";

const root = path.resolve(import.meta.dirname, "..");
const registryPath = path.join(root, "assets/artwork-catalog.js");
const prefix = "// Saved covers. Updated by scripts/song-artwork.mjs.\nexport default ";
const exists = file => access(file).then(() => true, () => false);
async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", value);
  await rename(file + ".tmp", file);
}
async function json(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; } }
async function registry() {
  const text = (await readFile(registryPath, "utf8")).replaceAll("\r\n", "\n");
  if (!text.startsWith(prefix)) throw new Error("Unexpected artwork registry format");
  return JSON.parse(text.slice(prefix.length).trim().replace(/;$/, ""));
}
async function apiGet(api, route) {
  const response = await fetch(api + route, { headers: { "X-Visitor-ID": "yehry3-artwork-program-v1" }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}
async function currentPinState(api, id) {
  // Pin counts live on the summary endpoint, not on /songs/:id.
  const snapshot = await apiGet(api, "/songs/summary");
  if (!Array.isArray(snapshot.songs)) throw new Error("Cannot verify live pin status");
  const song = snapshot.songs.find(s => s.id === id);
  if (!song) throw new Error("Song no longer in active catalog; cover preserved");
  return song;
}
function child(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    proc.stdout.on("data", b => { output = (output + b).slice(-20000); });
    proc.stderr.on("data", b => { output = (output + b).slice(-20000); });
    proc.once("error", reject);
    proc.once("close", code => resolve({ code, output }));
  });
}
async function validWebp(file) {
  try { const bytes = await readFile(file); return bytes.length > 1000 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"; } catch { return false; }
}

export async function main(args = process.argv.slice(2)) {
  const { values: opt, positionals } = parseArgs({ args, allowPositionals: true, options: {
    state: { type: "string", default: path.join(os.homedir(), "output/imagegen/yehry3-artwork") },
    api: { type: "string", default: "https://chairlift.fly.dev/yehry3" },
    site: { type: "string", default: "https://yehry3.app" },
    "key-file": { type: "string" }, python: { type: "string", default: process.env.ARTWORK_PYTHON || "python" },
    cli: { type: "string", default: path.join(os.homedir(), ".codex/skills/.system/imagegen/scripts/image_gen.py") },
    redo: { type: "string", multiple: true, default: [] }, only: { type: "string", multiple: true, default: [] },
    direction: { type: "string" }, "low-listens": { type: "string", default: String(POLICY.lowListens) },
    budget: { type: "string", default: "10" }, limit: { type: "string", default: "300" },
    "budget-period": { type: "string", default: "cumulative" },
    concurrency: { type: "string", default: "3" }, retry: { type: "boolean", default: false },
    "exclude-pinned": { type: "boolean", default: false },
    "placeholders-only": { type: "boolean", default: false },
    "from-audit": { type: "string" },
    "reviewed-briefs": { type: "string" },
    lifecycle: { type: "boolean", default: false },
    "lifecycle-baseline": { type: "string" },
    "incubation-hours": { type: "string", default: "24" },
    help: { type: "boolean", default: false },
  } });
  const command = positionals[0] || "plan";
  if (opt.help) {
    console.log(`song-artwork.mjs plan|report|run|verify [--state DIR] [--budget USD]
  [--budget-period cumulative|monthly] [--limit N] [--concurrency 3]
  [--key-file FILE] [--python EXE] [--only ID] [--redo ID] [--direction FILE]
  [--exclude-pinned] [--placeholders-only] [--from-audit FILE]
  [--reviewed-briefs FILE (requires --from-audit; manually reviewed alternatives)]
  [--lifecycle] [--lifecycle-baseline FILE] [--incubation-hours 24]
plan saves full sources and prompts without image calls. report summarizes that plan.
run reserves estimated spend in the persistent ledger, calls the installed Imagegen CLI,
and installs covers locally. verify compares saved images and modules with the live site.
--from-audit limits replacements to that audit's unpinned title placeholders.
--exclude-pinned rechecks pins before generation and before installation.
--lifecycle creates a cheap initial picture and one mature picture after incubation,
protecting pins, existing finished pictures, and every ID in --lifecycle-baseline.
Monthly budgets use America/Los_Angeles calendar months and retain prior receipts.
--retry explicitly retries failed/uncertain jobs; normal reruns never do.`);
    return;
  }
  if (command === "report") {
    const plan = await json(path.join(path.resolve(opt.state), "plan.json"));
    if (!plan?.jobs) throw new Error("Run plan first");
    console.log(JSON.stringify({ count: plan.jobs.length, estimate: +plan.jobs.reduce((n, j) => n + j.estimate, 0).toFixed(2),
      treatments: Object.fromEntries(Object.keys(treatments).map(t => [t, plan.jobs.filter(j => j.treatment === t).length])),
      incomplete: plan.jobs.filter(j => j.missing.length).map(({ id, title, missing }) => ({ id, title, missing })),
      failedSources: plan.failedSources }, null, 2));
    return;
  }
  if (!["plan", "run", "verify"].includes(command)) throw new Error("Unknown command");
  const art = await registry();
  if (opt.lifecycle) {
    if (opt["from-audit"] || opt.only.length || opt.redo.length || opt.direction) throw new Error("Lifecycle cannot be combined with a batch audit or explicit replacements");
    if (!(Number(opt["incubation-hours"]) > 0 && Number.isFinite(Number(opt["incubation-hours"])))) throw new Error("Invalid incubation period");
    opt["exclude-pinned"] = true;
  }
  const audit = opt["from-audit"] ? await json(opt["from-audit"]) : null;
  const briefs = opt["reviewed-briefs"] ? await json(opt["reviewed-briefs"]) : null;
  if (opt["reviewed-briefs"] && (!audit || opt.lifecycle || opt.direction || briefs?.version !== 1 ||
      !briefs.songs || typeof briefs.songs !== "object" || Array.isArray(briefs.songs) || !Object.keys(briefs.songs).length))
    throw new Error("Reviewed briefs require a nonempty version-1 song map and --from-audit; cannot use lifecycle or direction");
  if (briefs) for (const id of Object.keys(briefs.songs)) {
    if (!audit.songs?.some(s => s.id === id && s.kind === "text-placeholder" && s.adminPinned === false))
      throw new Error(`Reviewed brief is not an audited unpinned placeholder: ${id}`);
  }
  if (opt["from-audit"]) {
    if (!Array.isArray(audit?.songs) || !audit.songs.length) throw new Error("Invalid artwork audit");
    if (opt.only.length || opt.redo.length) throw new Error("Use --from-audit without --only or --redo");
    opt["exclude-pinned"] = true;
    opt["placeholders-only"] = true;
  }
  if (command === "verify") {
    let checked = 0;
    for (const [id, cover] of Object.entries(art)) {
      if (opt.only.length && !opt.only.includes(id)) continue;
      const response = await fetch(opt.site + cover.src, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== digest(await readFile(path.join(root, cover.src)))) throw new Error(`Live cover mismatch: ${id}`);
      checked++;
    }
    for (const name of ["app.js", "cover-art.js", "artwork-catalog.js"]) {
      const response = await fetch(`${opt.site}/assets/${name}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || (await response.text()).replaceAll("\r\n", "\n") !== (await readFile(path.join(root, "assets", name), "utf8")).replaceAll("\r\n", "\n")) throw new Error(`Live code mismatch: ${name}`);
    }
    const snapshot = await apiGet(opt.api, "/songs/summary");
    if (!Array.isArray(snapshot.songs) || !snapshot.songs.length || snapshot.songs.some(s => !Object.hasOwn(s, "artworkPinnedAt") || (s.artworkPinnedAt !== null && !Number.isFinite(Date.parse(s.artworkPinnedAt))))) throw new Error("Live catalog does not expose valid artwork pin milestones");
    console.log(`Verified ${checked} live covers, Dashboard modules, and ${snapshot.songs.length} pin milestone fields.`); return;
  }
  const state = path.resolve(opt.state), budget = Number(opt.budget), limit = Number(opt.limit), concurrency = Number(opt.concurrency), lowListens = Number(opt["low-listens"]);
  if (!["cumulative", "monthly"].includes(opt["budget-period"])) throw new Error("Invalid budget period");
  if (!(budget > 0 && Number.isFinite(budget) && Number.isInteger(limit) && limit > 0 && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 6 && Number.isInteger(lowListens) && lowListens >= 0)) throw new Error("Invalid budget, limit, concurrency or listens threshold");
  if (opt.direction && opt.redo.length + opt.only.length !== 1) throw new Error("Art direction must target exactly one --only or --redo song");
  await mkdir(state, { recursive: true });
  const lockPath = path.join(state, "run.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); } catch (e) { if (e.code === "EEXIST") throw new Error(`Another artwork process owns ${lockPath}. If it crashed, inspect its ledger before removing that lock.`); throw e; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), root }));
    const snapshot = await apiGet(opt.api, "/songs/summary");
    if (!Array.isArray(snapshot.songs) || !snapshot.songs.length) throw new Error("Empty or invalid catalog");
    const observationFile = path.join(state, "incubation.json");
    const observations = opt.lifecycle ? await json(observationFile, { firstSeen: {} }) : { firstSeen: {} };
    if (!observations.firstSeen || typeof observations.firstSeen !== "object") throw new Error("Invalid incubation history");
    const observedAt = new Date().toISOString();
    if (opt.lifecycle) {
      for (const song of snapshot.songs) observations.firstSeen[song.id] ||= observedAt;
      await atomic(observationFile, JSON.stringify(observations, null, 2) + "\n");
    }
    const lifecycleProtected = new Set();
    if (opt.lifecycle) {
      if (opt["lifecycle-baseline"]) {
        const baseline = await json(opt["lifecycle-baseline"]);
        if (!Array.isArray(baseline?.songs) || !baseline.songs.length) throw new Error("Invalid lifecycle baseline");
        for (const song of baseline.songs) lifecycleProtected.add(song.id);
      }
      // A different stage must not turn a rejected/uncertain job into a silent retry.
      const history = await json(path.join(state, "ledger.json"), { jobs: {} });
      for (const [key, entry] of Object.entries(history.jobs)) {
        if (["failed-or-uncertain", "reserved"].includes(entry.status)) {
          const id = entry.songId || key.match(/^(.+)-(?:incubating|mature|basic|emphasis|monument)-[a-f0-9]{12}$/)?.[1];
          if (id) lifecycleProtected.add(id);
        }
      }
    }
    const wanted = new Set(audit ? audit.songs.filter(s => s.kind === "text-placeholder" && s.adminPinned === false && (!briefs || Object.hasOwn(briefs.songs, s.id))).map(s => s.id) : [...opt.only, ...opt.redo]);
    if (!audit) for (const id of wanted) if (!snapshot.songs.some(s => s.id === id)) throw new Error(`Song not in active catalog: ${id}`);
    const protectedSongs = snapshot.songs.filter(s => opt["exclude-pinned"] && isPinnedOrUnknown(s)).map(s => ({ id: s.id, title: s.title, adminPinned: s.adminPinned ?? null }));
    const protectedIds = new Set([...protectedSongs, ...(audit?.songs.filter(s => isPinnedOrUnknown(s)) || [])].map(s => s.id));
    const direction = opt.direction ? await readFile(opt.direction, "utf8") : "";
    const candidates = snapshot.songs.filter(s => (audit || wanted.size ? wanted.has(s.id) : true) && !protectedIds.has(s.id) && !lifecycleProtected.has(s.id) && (!opt["placeholders-only"] || !art[s.id]))
      .map(song => ({ song, treatment: selectTreatment(song, art[song.id], { redo: opt.redo.includes(song.id), lowListens, excludePinned: opt["exclude-pinned"], lifecycle: opt.lifecycle, incubationHours: Number(opt["incubation-hours"]), firstSeenAt: observations.firstSeen[song.id] }) }))
      .filter(j => j.treatment).sort((a, b) => (opt.redo.includes(b.song.id) - opt.redo.includes(a.song.id)) || (["monument", "mature", "emphasis", "incubating", "basic"].indexOf(a.treatment) - ["monument", "mature", "emphasis", "incubating", "basic"].indexOf(b.treatment)) || Number(b.song.votes || 0) - Number(a.song.votes || 0));
    const jobs = [], failedSources = [];
    for (const candidate of candidates) {
      const { song, treatment } = candidate;
      if (!/^[a-z0-9-]{1,120}$/.test(song.id)) throw new Error("Unsafe song ID");
      try {
        const detail = (await apiGet(opt.api, `/songs/${song.id}`)).song;
        if (!detail || detail.id !== song.id) throw new Error("Detail identity mismatch");
        const packet = sourcePacket(detail), brief = briefs?.songs[song.id];
        const prompt = briefs ? makeReviewedPrompt(packet, treatment, brief) : makePrompt(packet, treatment, direction);
        if (prompt.length > 31000) throw new Error(`Full prompt needs review (${prompt.length} characters); no source was truncated`);
        const fingerprint = digest({ policy: POLICY.version, treatment, prompt });
        const key = `${song.id}-${treatment}-${fingerprint.slice(0, 12)}`, folder = path.join(state, key);
        await mkdir(folder, { recursive: true });
        await atomic(path.join(folder, "sources.json"), JSON.stringify(packet, null, 2) + "\n");
        await atomic(path.join(folder, "prompt.txt"), prompt);
        if (brief) await atomic(path.join(folder, "reviewed-brief.json"), JSON.stringify(brief, null, 2) + "\n");
        const job = { id: song.id, title: song.title, treatment, fingerprint, key, folder, estimate: estimateCost(prompt, treatment), missing: packet.missing, prompt, sourceHash: digest(packet), ...(opt.lifecycle ? { firstSeenAt: art[song.id]?.firstSeenAt || observations.firstSeen[song.id] } : {}) };
        if (brief) Object.assign(job, { alt: brief.alt, interpretation: brief.kind, briefHash: digest(brief) });
        jobs.push(job);
      } catch (e) { failedSources.push({ id: song.id, reason: e.message }); }
    }
    const plan = { createdAt: new Date().toISOString(), policy: { ...POLICY, lowListens, excludePinned: opt["exclude-pinned"], placeholdersOnly: opt["placeholders-only"], lifecycle: opt.lifecycle, incubationHours: Number(opt["incubation-hours"]) }, catalogCount: snapshot.songs.length, preserved: snapshot.songs.length - jobs.length, protectedSongs, estimatesAreNotBills: true, jobs: jobs.map(({ prompt, ...job }) => job), failedSources };
    await atomic(path.join(state, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    if (jobs.length || failedSources.length) {
      await atomic(path.join(state, "plans", plan.createdAt.replaceAll(":", "-") + ".json"), JSON.stringify(plan, null, 2) + "\n");
    }
    const counts = Object.fromEntries(Object.keys(treatments).map(t => [t, jobs.filter(j => j.treatment === t).length]));
    console.log(JSON.stringify({ command, catalog: plan.catalogCount, preserved: plan.preserved, ...counts, estimate: +jobs.reduce((n, j) => n + j.estimate, 0).toFixed(2), failedSources, plan: path.join(state, "plan.json") }));
    if (command === "plan") return;
    if (!jobs.length) { console.log("No eligible artwork jobs; no paid calls."); return; }
    let key = process.env.OPENAI_API_KEY;
    if (opt["key-file"]) {
      const matches = (await readFile(opt["key-file"], "utf8")).match(/sk-[A-Za-z0-9_-]{20,}/g) || [];
      if (new Set(matches).size !== 1) throw new Error("Key file must contain exactly one OpenAI key");
      key = matches[0];
    }
    if (!key) throw new Error("Set OPENAI_API_KEY or use --key-file; never put a key in an argument");
    if (!(await exists(opt.cli))) throw new Error("Installed Imagegen CLI not found; pass --cli");
    const ledgerPath = path.join(state, "ledger.json"), cached = new Set();
    for (const job of jobs) {
      if (await validWebp(path.join(job.folder, "cover.webp"))) cached.add(job.key);
    }
    const { selected, ledger } = reserveJobs(jobs, await json(ledgerPath, { reservations: 0, jobs: {} }), { budget, limit, retry: opt.retry, cached, budgetPeriod: opt["budget-period"] });
    await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
    // Serialize registry/ledger writes across concurrent API calls.
    let saves = Promise.resolve();
    const save = fn => { const next = saves.then(fn); saves = next.catch(() => {}); return next; };
    let cursor = 0, completed = 0, failed = 0, protectedSkipped = 0;
    const receipt = job => ledger.events.push({ type: "outcome", key: job.key, title: job.title, ...ledger.jobs[job.key], at: new Date().toISOString() });
    const protectBeforeAction = async job => {
      if (!opt["exclude-pinned"]) return false;
      const current = await currentPinState(opt.api, job.id);
      if (!protectedIds.has(job.id) && !isPinnedOrUnknown(current)) return false;
      protectedIds.add(job.id);
      protectedSkipped++;
      await save(async () => { ledger.jobs[job.key] = { ...ledger.jobs[job.key], status: "protected-pinned", error: "Pinned or unknown pin status; cover preserved" }; receipt(job); await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); });
      console.log(`Preserved pinned cover: ${job.title}`);
      return true;
    };
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < selected.length) {
        const job = selected[cursor++], output = path.join(job.folder, "cover.webp");
        console.log(`${job.cached ? "Reuse" : "Generate"} ${job.treatment}: ${job.title}`);
        try {
          if (await protectBeforeAction(job)) continue;
          if (!job.cached) {
            // A pass crossing a calendar boundary cannot spend against yesterday's month.
            if (opt["budget-period"] === "monthly" && ledger.jobs[job.key].period !== budgetMonth()) {
              await save(async () => { ledger.jobs[job.key].status = "deferred-period-change"; receipt(job); await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); });
              continue;
            }
            const batch = path.join(job.folder, "job.jsonl");
            const { quality, size } = treatments[job.treatment];
            await atomic(batch, JSON.stringify({ prompt: job.prompt, out: output, quality, size, model: POLICY.model, output_format: "webp", n: 1 }) + "\n");
            const result = await child(opt.python, [opt.cli, "generate-batch", "--input", batch, "--out-dir", job.folder, "--no-augment", "--max-attempts", "1", "--concurrency", "1"], { env: { ...process.env, OPENAI_API_KEY: key } });
            await atomic(path.join(job.folder, "generation.log"), result.output.replaceAll(key, "[REDACTED]"));
            await atomic(path.join(job.folder, `generation-attempt-${ledger.jobs[job.key].attempts}.log`), result.output.replaceAll(key, "[REDACTED]"));
            if (result.code !== 0 || !(await validWebp(output))) throw new Error(`Imagegen failed (exit ${result.code}); see saved generation.log`);
          }
          const filename = `${job.key}-q86.webp`, src = `/assets/artwork/${filename}`;
          const preparedFile = path.join(job.folder, "cover-q86.webp");
          const prepared = await child(opt.python, [path.join(root, "scripts/prepare-cover.py"), output, preparedFile]);
          if (prepared.code !== 0 || !(await validWebp(preparedFile))) throw new Error("Cover validation/compression failed; master is saved for free recovery");
          await save(async () => {
            // Recheck inside the serialized write, as a pin may arrive while an
            // image is rendering. Keep the master locally but do not install it.
            if (opt["exclude-pinned"]) {
              const current = await currentPinState(opt.api, job.id);
              if (isPinnedOrUnknown(current)) {
                protectedIds.add(job.id); protectedSkipped++;
                ledger.jobs[job.key] = { ...ledger.jobs[job.key], status: "protected-pinned", error: "Pinned during generation; original cover preserved" };
                receipt(job);
                await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
                return;
              }
            }
            await copyFile(preparedFile, path.join(root, src));
            art[job.id] = { src, alt: job.alt || `Cover artwork for ${job.title}.`, theme: "generated", tier: 0, remixed: false, treatment: job.treatment, model: POLICY.model, sourceHash: job.sourceHash, promptHash: digest(job.prompt), createdAt: new Date().toISOString(), missingSources: job.missing, previous: art[job.id]?.src || null, ...(job.firstSeenAt ? { firstSeenAt: job.firstSeenAt } : {}), ...(job.interpretation ? { interpretation: job.interpretation, briefHash: job.briefHash } : {}) };
            await atomic(registryPath, prefix + JSON.stringify(art, null, 2) + ";\n");
            ledger.jobs[job.key] = { ...ledger.jobs[job.key], songId: job.id, title: job.title, treatment: job.treatment, status: "complete", src };
            delete ledger.jobs[job.key].error;
            receipt(job);
            await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
          });
          if (ledger.jobs[job.key].status === "complete") { completed++; console.log(`Saved ${completed}/${selected.length}: ${job.title}`); }
        } catch (e) {
          failed++;
          await save(async () => { ledger.jobs[job.key] = { ...ledger.jobs[job.key], status: "failed-or-uncertain", error: e.message }; receipt(job); await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); });
          console.log(`Needs review: ${job.title}: ${e.message}`);
        }
      }
    }));
    console.log(JSON.stringify({ completed, failed, protectedSkipped, deferred: jobs.length - selected.length, reservedEstimate: opt["budget-period"] === "monthly" ? ledger.monthlyReservations[budgetMonth()] || 0 : ledger.oneOffReservations, lifetimeReservedEstimate: ledger.reservations, budget, budgetPeriod: opt["budget-period"], state }));
    if (failed || failedSources.length) process.exitCode = 1;
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
