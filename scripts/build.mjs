import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist");
const updatedAt = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short", day: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
}).formatToParts(updatedAt).map(({ type, value }) => [type, value]));
const updatedLabel = `${parts.month}-${parts.day}-${parts.year} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
const stamp = `<small class="deployment-stamp">Updated at <time datetime="${updatedAt.toISOString()}">${updatedLabel}</time></small>`;
// Only this exact generated directory may be replaced.
if (output !== path.resolve(root, "dist"))
  throw new Error("Invalid build destination");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of [
  "index.html",
  "distonyc",
  "deetz",
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
for (const file of await readdir(output, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const destination = path.join(output, file);
  let html = await readFile(destination, "utf8");
  html = html.replace("</head>", '<link rel="stylesheet" href="/assets/deployment.css">\n  </head>');
  html = html.includes("</footer>")
    ? html.replace("</footer>", `${stamp}\n    </footer>`)
    : html.replace("</body>", `<footer class="deployment-footer">${stamp}</footer>\n  </body>`);
  await writeFile(destination, html);
}
console.log(
  `Built static site in dist/ · Updated at ${updatedLabel} (public files only).`,
);
