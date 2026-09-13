import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
// Only this exact generated directory may be replaced.
if (output !== path.resolve(root, "dist"))
  throw new Error("Invalid build destination");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of [
  "index.html",
  "distonyc",
  "admin",
  "queue",
  "lyrics",
  "original-prompt",
  "notifications-sw.js",
  "assets",
  "catalog.json",
  "basis-songs.json",
  "fearhunger",
  "robots.txt",
  "staticwebapp.config.json",
]) {
  await stat(path.join(root, file));
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
console.log(
  "Built static site in dist/ (application files and finished MP3s only).",
);
