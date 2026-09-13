import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { songAlias } from "../assets/song-links.js";
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
  "arabic",
  "robots.txt",
  "staticwebapp.config.json",
]) {
  await stat(path.join(root, file));
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
const catalog = JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8"));
const lyricsTemplate = await readFile(path.join(root, "lyrics/index.html"), "utf8");
const aliases = new Set();
const htmlEscape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
for (const song of catalog.songs.filter((song) => song.lyrics?.text)) {
  const alias = songAlias(song);
  if (aliases.has(alias)) throw new Error(`Duplicate lyrics alias: ${alias}`);
  aliases.add(alias);
  const firstLine = song.lyrics.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^\[[^\]]+]$/.test(line));
  const title = `${song.title} · Lyrics · yehry3`;
  const description = `“${firstLine || "Read the full lyric sheet."}” — lyrics and recording on yehry3.`;
  const canonical = `https://yehry3.app/lyrics/${alias}/`;
  const metadata = [
    `<link rel="canonical" href="${htmlEscape(canonical)}" />`,
    '<meta property="og:type" content="music.song" />',
    '<meta property="og:site_name" content="yehry3" />',
    `<meta property="og:title" content="${htmlEscape(title)}" />`,
    `<meta property="og:description" content="${htmlEscape(description)}" />`,
    `<meta property="og:url" content="${htmlEscape(canonical)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${htmlEscape(title)}" />`,
    `<meta name="twitter:description" content="${htmlEscape(description)}" />`,
  ].join("\n    ");
  const html = lyricsTemplate
    .replace("<title>Song lyrics · yehry3</title>", `<title>${htmlEscape(title)}</title>`)
    .replace("</head>", `    ${metadata}\n  </head>`)
    .replace('<body data-page="lyrics">', `<body data-page="lyrics" data-song-id="${htmlEscape(song.id)}">`);
  const directory = path.join(output, "lyrics", alias);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
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
  `Built static site in dist/ with ${aliases.size} shareable lyric pages · Updated at ${updatedLabel} (public files only).`,
);
