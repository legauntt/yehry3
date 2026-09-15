import { watchSong } from "./song-data.js";

export const remixHref = song => `/distonyc/?remix=${encodeURIComponent(song.id)}`;

export function remixSeed(song, basisSongs) {
  const brief = song.originalPrompt || {};
  const source = basisSongs.find(item => item.title.trim().toLocaleLowerCase() === song.title.trim().toLocaleLowerCase());
  return {
    prompt: `Remix “${song.title}”. Give it a new arrangement while keeping its identity.${brief.idea ? `\n\nOriginal idea: ${brief.idea}` : ""}${brief.direction ? `\n\nOriginal sound: ${brief.direction}` : ""}`.slice(0, 2000),
    direction: "",
    keep: `Keep the recognizable hook and spirit of “${song.title}”.`.slice(0, 1000),
    basisSongIds: source ? [source.id] : [],
    voiceModel: brief.voiceModel || song.voiceModel || "v7",
    ...(song.lyrics?.text && song.lyrics.text.length <= 30000 && song.lyrics.text.trim().split(/\s+/u).length <= 3000
      ? { lyricSheet: { text: song.lyrics.text, mode: "adapt" } } : {}),
  };
}

export async function loadRemix(basisSongs) {
  const id = new URLSearchParams(location.search).get("remix");
  if (!id) return null;
  let song;
  await watchSong(id, value => { song = value; }, value => Boolean(value?.title && value?.url)).ready;
  return song ? { id, title: song.title, seed: remixSeed(song, basisSongs) } : { id, unavailable: true };
}

export function remixLink(song, escape) {
  return `<a class="text-link" data-remix href="${remixHref(song)}" aria-label="Remix ${escape(song.title)}">Remix ↗</a>`;
}
