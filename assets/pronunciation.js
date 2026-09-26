// Broad US English, for the lyric sheet's deliberately unserious reading modes.
// CMU gives sounds and stress, not sung timing or syllable boundaries.
export const lyricWords = (text) => text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu) || [];
export const pronunciationKey = (word) => word.toLowerCase().replaceAll("’", "'");

const ipa = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ",
  EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ",
  K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s",
  SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};
const readable = {
  AA: "ah", AE: "a", AH: "uh", AO: "aw", AW: "ow", AY: "eye", EH: "eh", ER: "ur",
  EY: "ay", IH: "i", IY: "ee", OW: "oh", OY: "oy", UH: "uu", UW: "oo",
  B: "b", CH: "ch", D: "d", DH: "dh", F: "f", G: "g", HH: "h", JH: "j",
  K: "k", L: "l", M: "m", N: "n", NG: "ng", P: "p", R: "r", S: "s",
  SH: "sh", T: "t", TH: "th", V: "v", W: "w", Y: "y", Z: "z", ZH: "zh",
};
const sound = (phone) => phone.replace(/[012]$/, "");
const vowel = (phone) => /[012]$/.test(phone);
const onsets = new Set(("P R,P L,B R,B L,T R,D R,K R,K L,G R,G L,F R,F L," +
  "TH R,SH R,S P,S T,S K,S M,S N,S L,S W,T W,D W,K W,G W," +
  "P Y,B Y,T Y,D Y,K Y,G Y,F Y,V Y,M Y,N Y,HH Y," +
  "S P R,S P L,S T R,S K R,S K W,S K L").split(","));

function syllables(phones) {
  const nuclei = phones.flatMap((phone, index) => vowel(phone) ? [index] : []);
  const starts = [0];
  for (let i = 1; i < nuclei.length; i++) {
    const end = nuclei[i], previous = nuclei[i - 1];
    let start = end;
    for (let candidate = previous + 1; candidate < end; candidate++) {
      const cluster = phones.slice(candidate, end).map(sound);
      if ((cluster.length === 1 && cluster[0] !== "NG") || onsets.has(cluster.join(" "))) {
        start = candidate;
        break;
      }
    }
    starts.push(start);
  }
  return starts.map((start, index) => phones.slice(start, starts[index + 1] ?? phones.length));
}

export function pronounce(phones, view) {
  const parts = phones.split(" ");
  if (parts.some((phone) => !Object.hasOwn(ipa, sound(phone)))) return null;
  const chunks = syllables(parts);
  if (view === "ipa") return chunks.map((chunk) => {
    const stress = chunks.length > 1 ? chunk.some(p => /1$/.test(p)) ? "ˈ" : chunk.some(p => /2$/.test(p)) ? "ˌ" : "" : "";
    return stress + chunk.map(p => p === "AH0" ? "ə" : p === "ER0" ? "ɚ" : ipa[sound(p)]).join("");
  }).join("");
  return chunks.map((chunk) => {
    const nucleus = chunk.findIndex(vowel);
    let text;
    // Familiar "my / nyte / eye" spellings are easier to sing than "mey / neyet".
    if (nucleus > 0 && sound(chunk[nucleus]) === "AY") {
      const before = chunk.slice(0, nucleus).map(p => readable[sound(p)]).join("");
      const after = chunk.slice(nucleus + 1).map(p => readable[sound(p)]).join("");
      text = before + "y" + after + (after.length === 1 ? "e" : "");
    } else text = chunk.map(p => readable[sound(p)]).join("");
    return chunks.length > 1 && chunk.some(p => /1$/.test(p)) ? text.toUpperCase() : text;
  }).join("-");
}

const accents = { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü", Y: "Ÿ" };
export function lyricView(text, view, dictionary = {}) {
  if (view === "original") return text;
  return text.split("\n").map(line => {
    if (!line.trim() || /^\s*\[[^\]]+]\s*$/.test(line)) return line;
    if (view === "diacritics") return line.replace(/[aeiouy]/gi, letter => accents[letter]);
    if (view !== "ipa" && view !== "phonics") return line;
    return line.replace(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu, word => {
      const key = pronunciationKey(word);
      if (!Object.hasOwn(dictionary, key)) return word;
      const result = pronounce(dictionary[key], view);
      return result === null ? word : view === "ipa" ? `/${result}/` : result;
    });
  }).join("\n");
}
