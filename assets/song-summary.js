export function songSummary(song) {
  const { lyrics, originalPrompt, songPlan, ...summary } = song;
  return { ...summary, hasLyrics: Boolean(lyrics?.text || song.hasLyrics), hasOriginalPrompt: Boolean(originalPrompt || song.hasOriginalPrompt), hasSongPlan: Boolean(songPlan || song.hasSongPlan) };
}
