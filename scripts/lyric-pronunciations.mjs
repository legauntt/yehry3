import { dictionary } from "cmu-pronouncing-dictionary";
import { lyricWords, pronunciationKey } from "../assets/pronunciation.js";

// Ship only the public catalog's vocabulary, not the entire 134,000-word dictionary.
export function lyricPronunciations(songs) {
  const words = new Set(songs.flatMap(song => lyricWords(song.lyrics?.text || "").map(pronunciationKey)));
  return Object.fromEntries([...words].sort().filter(word => Object.hasOwn(dictionary, word)).map(word => [word, dictionary[word]]));
}
