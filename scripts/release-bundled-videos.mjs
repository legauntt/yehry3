// Preserve bundled video URLs while moving production bytes to GitHub Releases.
// --publish uploads missing originals and registers redirects after digest checks.
// --live=https://yehry3.app verifies every redirect, complete file and byte range.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const folder = path.join(root, "assets/song-videos");
const configFile = path.join(root, "staticwebapp.config.json");
const configText = await readFile(configFile, "utf8");
const config = JSON.parse(configText);
const additions = [];
const repository = "legauntt/yehry3";
const release = "song-videos-v1";
const prefix = `https://github.com/${repository}/releases/download/${release}/`;
const publish = process.argv.includes("--publish");
const live = process.argv.find(value => value.startsWith("--live="))?.slice(7);
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", windowsHide: true });
const inventory = () => JSON.parse(gh("release", "view", release, "--repo", repository, "--json", "assets")).assets;
let assets = inventory();
const names = (await readdir(folder)).filter(name => name.endsWith(".mp4")).sort();
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let bytes = 0;
for (const name of names) {
  const file = path.join(folder, name);
  let asset = assets.find(item => item.name === name);
  if (!asset && publish) {
    gh("release", "upload", release, file, "--repo", repository);
    assets = inventory();
    asset = assets.find(item => item.name === name);
  }
  assert.ok(asset, `Missing release copy: ${name}; run with --publish`);
  const original = await readFile(file);
  assert.equal(asset.digest, digest(original), `Release digest differs: ${name}`);
  assert.equal(asset.size, original.length, `Release size differs: ${name}`);
  const route = `/assets/song-videos/${name}`;
  const expected = { route, redirect: prefix + name, statusCode: 302 };
  const existing = config.routes.find(item => item.route === route);
  if (existing) assert.deepEqual(existing, expected, `Conflicting route: ${route}`);
  else if (publish) additions.push(expected);
  else assert.fail(`Missing redirect: ${route}`);
  if (live) {
    const url = new URL(route, live);
    const redirect = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60000) });
    assert.equal(redirect.status, 302, `Expected redirect: ${name}`);
    assert.equal(redirect.headers.get("location"), expected.redirect);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200);
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), asset.digest, `Live bytes differ: ${name}`);
    const range = await fetch(url, { headers: { Range: "bytes=0-31" }, signal: AbortSignal.timeout(60000) });
    assert.equal(range.status, 206, `Seeking unsupported: ${name}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), original.subarray(0, 32));
  }
  bytes += original.length;
  console.log(`Verified ${name}${live ? " (live bytes and seeking)" : " (release digest)"}`);
}
if (publish && additions.length) {
  const newline = configText.includes("\r\n") ? "\r\n" : "\n";
  assert.ok(configText.includes('"routes": ['), "Cannot locate routes in hosting configuration");
  await writeFile(configFile, configText.replace('"routes": [',
    '"routes": [' + newline + additions.map(route => `    ${JSON.stringify(route)},`).join(newline)));
}
let deployedBytes = 0;
async function count(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await count(file);
    else deployedBytes += (await stat(file)).size;
  }
}
if (process.argv.includes("--size")) {
  const builtConfig = JSON.parse(await readFile(path.join(root, "dist/staticwebapp.config.json"), "utf8"));
  for (const name of names) {
    const route = `/assets/song-videos/${name}`;
    assert.equal(builtConfig.routes.find(item => item.route === route)?.redirect, prefix + name);
    await assert.rejects(stat(path.join(root, "dist", route.slice(1))), { code: "ENOENT" });
  }
  await count(path.join(root, "dist"));
  assert.ok(deployedBytes < 262144000, "Deployment exceeds Azure's 250 MiB limit");
  console.log(`Deployment: ${deployedBytes} bytes; Azure headroom: ${262144000 - deployedBytes} bytes`);
}
console.log(`Verified ${names.length} originals: ${bytes} bytes hosted in Releases.`);
