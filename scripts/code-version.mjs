import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// The "Update available" banner asks whether the site's *code* changed, not
// whether anything was deployed. Song, lyric-cue and shared-clip publications
// only rewrite data (catalog.json, wiseau/clips.json and their audio), so they
// must not move this version; pages, scripts, styles and hosting rules do.
const CODE_FILE = /\.(html|js|mjs|css|svg)$/;
const CODE_ROOT_FILES = new Set(["staticwebapp.config.json"]);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}

// `entries` are the files and directories the build copies, relative to `root`.
// Call it on the sources, before the build generates song pages or rewrites
// the hosting config, so the result depends only on what a developer edited.
export async function codeVersion(root, entries) {
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry);
    if ((await stat(full)).isDirectory()) files.push(...(await Array.fromAsync(walk(full))));
    else files.push(full);
  }
  const relative = files
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .filter((file) => CODE_FILE.test(file) || CODE_ROOT_FILES.has(file))
    .sort();
  const hash = createHash("sha256");
  for (const file of relative) {
    // Line endings differ between a Windows checkout and the Linux deploy build.
    const text = (await readFile(path.join(root, file), "utf8")).replaceAll("\r\n", "\n");
    hash.update(`${file}\0${text}\0`);
  }
  return hash.digest("hex").slice(0, 16);
}
