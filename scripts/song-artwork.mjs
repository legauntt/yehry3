#!/usr/bin/env node
// Maintained wrapper around the installed Imagegen skill CLI. No API key or
// source packets enter the site. plan is read-only; run is explicitly paid.
import { readFile, writeFile, mkdir, rename, copyFile, open, unlink, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { POLICY, treatments, selectTreatment, sourcePacket, makePrompt, digest, estimateCost } from "./artwork-policy.mjs";
import { reserveJobs } from "./artwork-budget.mjs";

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
    concurrency: { type: "string", default: "3" }, retry: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  } });
  const command = positionals[0] || "plan";
  if (opt.help) { console.log("song-artwork.mjs plan|run|verify [--only ID] [--redo ID] [--direction FILE] [--state DIR] [--budget USD] [--limit N] [--concurrency 3] [--key-file FILE] [--python EXE]\nplan fetches and saves all source packets/prompts without calling Image API. run reserves estimated spend in a persistent ledger, calls the bundled CLI and installs covers. verify compares saved image hashes with the live site. --retry explicitly retries failed/uncertain jobs; normal reruns never do."); return; }
  if (!["plan", "run", "verify"].includes(command)) throw new Error("Unknown command");
  const art = await registry();
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
    console.log(`Verified ${checked} live covers and Dashboard modules.`); return;
  }
  const state = path.resolve(opt.state), budget = Number(opt.budget), limit = Number(opt.limit), concurrency = Number(opt.concurrency), lowListens = Number(opt["low-listens"]);
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
    const wanted = new Set([...opt.only, ...opt.redo]);
    for (const id of wanted) if (!snapshot.songs.some(s => s.id === id)) throw new Error(`Song not in active catalog: ${id}`);
    const direction = opt.direction ? await readFile(opt.direction, "utf8") : "";
    const candidates = snapshot.songs.filter(s => !wanted.size || wanted.has(s.id))
      .map(song => ({ song, treatment: selectTreatment(song, art[song.id], { redo: opt.redo.includes(song.id), lowListens }) }))
      .filter(j => j.treatment).sort((a, b) => (opt.redo.includes(b.song.id) - opt.redo.includes(a.song.id)) || (["monument", "emphasis", "basic"].indexOf(a.treatment) - ["monument", "emphasis", "basic"].indexOf(b.treatment)) || Number(b.song.votes || 0) - Number(a.song.votes || 0));
    const jobs = [], failedSources = [];
    for (const candidate of candidates) {
      const { song, treatment } = candidate;
      if (!/^[a-z0-9-]{1,120}$/.test(song.id)) throw new Error("Unsafe song ID");
      try {
        const detail = (await apiGet(opt.api, `/songs/${song.id}`)).song;
        if (!detail || detail.id !== song.id) throw new Error("Detail identity mismatch");
        const packet = sourcePacket(detail), prompt = makePrompt(packet, treatment, direction);
        if (prompt.length > 31000) throw new Error(`Full prompt needs review (${prompt.length} characters); no source was truncated`);
        const fingerprint = digest({ policy: POLICY.version, treatment, prompt });
        const key = `${song.id}-${treatment}-${fingerprint.slice(0, 12)}`, folder = path.join(state, key);
        await mkdir(folder, { recursive: true });
        await atomic(path.join(folder, "sources.json"), JSON.stringify(packet, null, 2) + "\n");
        await atomic(path.join(folder, "prompt.txt"), prompt);
        const job = { id: song.id, title: song.title, treatment, fingerprint, key, folder, estimate: estimateCost(prompt, treatment), missing: packet.missing, prompt, sourceHash: digest(packet) };
        jobs.push(job);
      } catch (e) { failedSources.push({ id: song.id, reason: e.message }); }
    }
    const plan = { createdAt: new Date().toISOString(), policy: { ...POLICY, lowListens }, catalogCount: snapshot.songs.length, preserved: snapshot.songs.length - candidates.length, estimatesAreNotBills: true, jobs: jobs.map(({ prompt, ...job }) => job), failedSources };
    await atomic(path.join(state, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
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
    const { selected, ledger } = reserveJobs(jobs, await json(ledgerPath, { reservations: 0, jobs: {} }), { budget, limit, retry: opt.retry, cached });
    await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
    // Serialize registry/ledger writes across concurrent API calls.
    let saves = Promise.resolve();
    const save = fn => { const next = saves.then(fn); saves = next.catch(() => {}); return next; };
    let cursor = 0, completed = 0, failed = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < selected.length) {
        const job = selected[cursor++], output = path.join(job.folder, "cover.webp");
        console.log(`${job.cached ? "Reuse" : "Generate"} ${job.treatment}: ${job.title}`);
        try {
          if (!job.cached) {
            const batch = path.join(job.folder, "job.jsonl");
            const { quality, size } = treatments[job.treatment];
            await atomic(batch, JSON.stringify({ prompt: job.prompt, out: output, quality, size, model: POLICY.model, output_format: "webp", n: 1 }) + "\n");
            const result = await child(opt.python, [opt.cli, "generate-batch", "--input", batch, "--out-dir", job.folder, "--no-augment", "--max-attempts", "1", "--concurrency", "1"], { env: { ...process.env, OPENAI_API_KEY: key } });
            await atomic(path.join(job.folder, "generation.log"), result.output.replaceAll(key, "[REDACTED]"));
            if (result.code !== 0 || !(await validWebp(output))) throw new Error(`Imagegen failed (exit ${result.code}); see saved generation.log`);
          }
          const filename = `${job.key}.webp`, src = `/assets/artwork/${filename}`;
          await copyFile(output, path.join(root, src));
          await save(async () => {
            art[job.id] = { src, alt: `Cover artwork for ${job.title}.`, theme: "generated", tier: 0, remixed: false, treatment: job.treatment, model: POLICY.model, sourceHash: job.sourceHash, promptHash: digest(job.prompt), createdAt: new Date().toISOString(), missingSources: job.missing, previous: art[job.id]?.src || null };
            await atomic(registryPath, prefix + JSON.stringify(art, null, 2) + ";\n");
            ledger.jobs[job.key] = { ...ledger.jobs[job.key], status: "complete", src };
            await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
          });
          completed++; console.log(`Saved ${completed}/${selected.length}: ${job.title}`);
        } catch (e) {
          failed++;
          await save(async () => { ledger.jobs[job.key] = { ...ledger.jobs[job.key], status: "failed-or-uncertain", error: e.message }; await atomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); });
          console.log(`Needs review: ${job.title}: ${e.message}`);
        }
      }
    }));
    console.log(JSON.stringify({ completed, failed, deferred: jobs.length - selected.length, reservedEstimate: ledger.reservations, budget, state }));
    if (failed || failedSources.length) process.exitCode = 1;
  } finally { await lock.close(); await unlink(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
