import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { songAlias } from "../assets/song-links.js";
import { songSummary } from "../assets/song-summary.js";
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
  "404.html",
  "distonyc",
  "deetz",
  "admin",
  "queue",
  "lyrics",
  "mixtapes",
  "original-prompt",
  "notifications-sw.js",
  "assets",
  "catalog.json",
  "basis-songs.json",
  "fearhunger",
  "arabic",
  "wiseau",
  "robots.txt",
  "staticwebapp.config.json",
]) {
  await stat(path.join(root, file));
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
const catalog = JSON.parse(await readFile(path.join(root, "catalog.json"), "utf8"));
await mkdir(path.join(output, "songs"));
for (const song of catalog.songs) {
  if (!/^[a-z0-9-]{1,120}$/.test(song.id)) throw new Error("Invalid public song ID");
  await writeFile(path.join(output, "songs", `${song.id}.json`), JSON.stringify(song));
}
await writeFile(path.join(output, "catalog-summary.json"), JSON.stringify({ songs: catalog.songs.map(songSummary) }));
// A long-lived tab compares this against the stamp baked into its own pages and
// offers a refresh when a newer build has shipped.
await writeFile(path.join(output, "deployment.json"), JSON.stringify({ updatedAt: updatedAt.toISOString(), updatedLabel }));
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
// Exact index.html rules also match their directory URLs on Azure. Keep each
// generated page (and its share metadata) ahead of the fallback for new songs.
const hostingFile = path.join(output, "staticwebapp.config.json");
const hosting = JSON.parse(await readFile(hostingFile, "utf8"));
const lyricsFallback = hosting.routes.findIndex(route => route.route === "/lyrics/*");
if (lyricsFallback < 0) throw new Error("Missing lyrics fallback route");
hosting.routes.splice(lyricsFallback, 0, ...[...aliases].map(alias => ({
  route: `/lyrics/${alias}/index.html`,
})));
// Azure limits this file to 20 KB. Keep the generated artifact compact and fail
// here if catalog growth ever requires a different routing strategy.
const hostingJson = JSON.stringify(hosting);
if (Buffer.byteLength(hostingJson) > 20000) throw new Error("Azure routing configuration exceeds 20 KB");
await writeFile(hostingFile, hostingJson);
// Every shared Tommy line gets its own copy of the share page at dist/wiseau/<id>/index.html,
// so a link preview (Discord, Slack, iMessage) quotes the line instead of the generic page.
// Azure serves that directory for /wiseau/<id>; a /wiseau/* rewrite would shadow it, so
// staticwebapp.config.json must not carry one (tests/wiseau.test.mjs checks both).
const wiseauTemplate = await readFile(path.join(root, "wiseau/index.html"), "utf8");
const wiseauTitle = "<title>Tommy says · yehry3</title>";
const wiseauDescription = /<meta[^>]*name="description"[^>]*>/;
if (!wiseauTemplate.includes(wiseauTitle) || !wiseauDescription.test(wiseauTemplate))
  throw new Error("wiseau/index.html lost the title or description that clip pages replace");
const wiseau = JSON.parse(await readFile(path.join(root, "wiseau/clips.json"), "utf8"));
for (const clip of wiseau.clips) {
  if (!/^[a-z0-9]{8}$/.test(clip.id)) throw new Error(`Invalid Tommy clip ID: ${clip.id}`);
  const seconds = Math.round(clip.duration);
  const quote = `“${clip.text}”`;
  const description = `${seconds} second${seconds === 1 ? "" : "s"} in the voice of ${
    clip.voice || "Tommy Wiseau"
  }, produced by a voice model. He never said this.`;
  const canonical = `https://yehry3.app/wiseau/${clip.id}`;
  const audio = `https://yehry3.app${clip.url}`;
  const metadata = [
    `<link rel="canonical" href="${htmlEscape(canonical)}" />`,
    '<meta property="og:type" content="music.song" />',
    '<meta property="og:site_name" content="Tommy says · yehry3" />',
    `<meta property="og:title" content="${htmlEscape(quote)}" />`,
    `<meta property="og:description" content="${htmlEscape(description)}" />`,
    `<meta property="og:url" content="${htmlEscape(canonical)}" />`,
    `<meta property="og:audio" content="${htmlEscape(audio)}" />`,
    '<meta property="og:audio:type" content="audio/mpeg" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${htmlEscape(quote)}" />`,
    `<meta name="twitter:description" content="${htmlEscape(description)}" />`,
  ].join("\n    ");
  // Function replacers keep "$&" and friends in a line from being read as replacement patterns.
  const html = wiseauTemplate
    .replace(wiseauTitle, () => `<title>${htmlEscape(`${quote} · Tommy says · yehry3`)}</title>`)
    .replace(wiseauDescription, () => `<meta name="description" content="${htmlEscape(description)}" />`)
    .replace("</head>", () => `    ${metadata}\n  </head>`);
  const directory = path.join(output, "wiseau", clip.id);
  await mkdir(directory);
  await writeFile(path.join(directory, "index.html"), html);
}
for (const file of await readdir(output, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const destination = path.join(output, file);
  let html = await readFile(destination, "utf8");
  if (html.includes("/assets/site.css")) html = html.replace("<html ", "<html data-shared-theme ");
  html = html.replace("<head>", '<head>\n    <script src="/assets/theme.js"></script>');
  html = html.replace("</head>", '<link rel="stylesheet" href="/assets/theme.css">\n  </head>');
  if (html.includes('class="site-footer"')) {
    html = html.replace(/<span>\s*YEHRY3 · A little off the record\.\s*<\/span\s*>/i, '<span data-brand-footer>YEHRY3 · A little off the record.</span>');
    html = html.replace("</head>", '<script type="module" src="/assets/branding.js"></script>\n  </head>');
  }
  html = html.replace("</head>", '<link rel="stylesheet" href="/assets/deployment.css">\n    <script type="module" src="/assets/deployment.js"></script>\n  </head>');
  html = html.includes("</footer>")
    ? html.replace("</footer>", `${stamp}\n    </footer>`)
    : html.replace("</body>", `<footer class="deployment-footer">${stamp}</footer>\n  </body>`);
  await writeFile(destination, html);
}
console.log(
  `Built static site in dist/ with ${aliases.size} shareable lyric pages and ${wiseau.clips.length} Tommy pages · Updated at ${updatedLabel} (public files only).`,
);
