// mongodb-memory-server removes its mongo-mem-* data folder only when stop() runs. Playwright ends its web servers
// with a forced kill on Windows, which delivers no signal, so dev-api.mjs never reaches stop() there and each run
// leaves about 300 MB in the temp directory. The preview API therefore clears earlier strays when it starts.
// Chairlift's tests do the same in test/mongo-server.js.

import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const STALE_MS = 60 * 60 * 1000;

function liveMongodCommandLines() {
  if (process.platform === "win32")
    return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name like 'mongod%'\" | ForEach-Object { $_.CommandLine }"],
      { encoding: "utf8", timeout: 20000, windowsHide: true });
  return execFileSync("ps", ["-eo", "args"], { encoding: "utf8", timeout: 20000 });
}

// Removes mongo-mem-* folders older than minAgeMs that no running mongod names, and returns their names.
// Another session's preview may still be serving from one, so nothing is removed when the process list is unreadable.
export function sweepStaleMongoDirs({ tmp = tmpdir(), minAgeMs = STALE_MS, now = Date.now(), live } = {}) {
  let names;
  try {
    names = readdirSync(tmp).filter((name) => name.startsWith("mongo-mem-"));
  } catch {
    return [];
  }
  if (!names.length) return [];
  try {
    live = String(typeof live === "function" ? live() : (live ?? liveMongodCommandLines())).toLowerCase();
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    const dir = path.join(tmp, name);
    try {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || now - stat.mtimeMs < minAgeMs || live.includes(name.toLowerCase())) continue;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      removed.push(name);
    } catch {}
  }
  return removed;
}
