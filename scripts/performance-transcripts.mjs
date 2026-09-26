import { readFile, readdir } from "node:fs/promises";
import { performanceTranscript, transcriptMethods } from "../assets/performance-lyrics.js";
import { createHash } from "node:crypto";

export async function performanceTranscripts(songs, directory = new URL("../lyric-transcripts/", import.meta.url)) {
  const index = {}, files = {};
  for (const name of (await readdir(directory)).sort()) {
    const match = /^([a-z0-9-]{1,120})\.([a-z0-9-]+)\.json$/.exec(name);
    if (!match || !Object.hasOwn(transcriptMethods, match[2])) throw new Error(`Unexpected transcript file: ${name}`);
    const [, id, method] = match;
    const song = songs.find(song => song.id === id);
    if (!song) continue; // Archived songs are excluded from the deployed build.
    files[name] = performanceTranscript(JSON.parse(await readFile(new URL(name, directory), "utf8")), song, method);
    if (song.url.startsWith("/fearhunger/audio/")) {
      const audio = await readFile(new URL(`..${song.url}`, import.meta.url));
      if (createHash("sha256").update(audio).digest("hex") !== files[name].audioSha256)
        throw new Error(`Transcript differs from the site's audio: ${song.id}`);
    }
    index[id] ||= { audioUrl: song.url, methods: [] };
    index[id].methods.push(method);
  }
  return { index, files };
}
