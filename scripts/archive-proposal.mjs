// Read-only proposal: never archives songs or changes the source catalog.
// node scripts/archive-proposal.mjs <summary.json> <exclusive ISO cutoff> <output directory>
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [input, before, output] = process.argv.slice(2);
if (!input || !output || !Number.isFinite(Date.parse(before)))
  throw new Error("Usage: archive-proposal.mjs <summary.json> <exclusive ISO cutoff> <output directory>");
const catalog = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(catalog.songs) || catalog.songs.some(song => !song.id || !Number.isFinite(song.playCount)))
  throw new Error("Expected a live summary with recorded listening totals.");
const cutoff = Date.parse(before);
const older = song => Number.isFinite(Date.parse(song.publishedAt)) && Date.parse(song.publishedAt) < cutoff;
const eligible = song => older(song) && !song.pins && song.playCount < 5 && (song.votes || 0) < 2;
const ordered = [...catalog.songs].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id));
const candidates = ordered.filter(eligible);
const protectedOlder = ordered.filter(song => older(song) && !eligible(song));
const day = value => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const escape = text => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
function table(songs) {
  return ["| # | Song | Published (Pacific) | Listens | Votes | Pins |", "| ---: | --- | --- | ---: | ---: | ---: |",
    ...songs.map((song, i) => `| ${i + 1} | [${escape(song.title)}](https://yehry3.app/song/${song.id}/) | ${day(song.publishedAt)} | ${song.playCount} | ${song.votes || 0} | ${song.pins || 0} |`)].join("\n");
}
const report = `# Proposed song archive\n\nNot applied. Snapshot prepared ${new Date().toISOString()}.\n\n` +
  `Archive songs published before **${day(before)} Pacific**, with **fewer than 5 recorded listens, fewer than 2 votes, and no pins**.\n\n` +
  `**${candidates.length} candidates; ${catalog.songs.length - candidates.length} remain active; ${catalog.archived?.length || 0} already archived.**\n\n` +
  `Listening counts begin September 15, 2026 and count 10 seconds of playback, once per browser per song every 30 minutes. They are not lifetime or completed-listen counts. Preserve votes, listening history, metadata and audio files; use reversible archiving after confirmation. Recheck pins and counts before applying this exact candidate list; skip any newly protected song.\n\n` +
  `The build currently refuses to exclude more than half the source catalog. This batch crosses that threshold including existing archives; ship an explicit approved archive manifest with the archive operation so fallback pages also exclude the confirmed songs.\n\n` +
  `## Proposed archive, oldest first\n\n${table(candidates)}\n\n## Older songs retained for engagement\n\n${table(protectedOlder)}\n`;
const manifest = { preparedAt: new Date().toISOString(), before, maxListensExclusive: 5, maxVotesExclusive: 2, pins: 0,
  candidates: candidates.map(({ id, title, publishedAt, playCount, votes, pins }) => ({ id, title, publishedAt, playCount, votes, pins })) };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "archive-proposal.md"), report);
await writeFile(path.join(output, "archive-proposal.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ candidates: candidates.length, keep: catalog.songs.length - candidates.length, protectedOlder: protectedOlder.length, report: path.resolve(output, "archive-proposal.md") }));
