import test from "node:test";
import assert from "node:assert/strict";
import { dictionary } from "cmu-pronouncing-dictionary";
import { lyricView, pronounce } from "../assets/pronunciation.js";
import { lyricPronunciations } from "../scripts/lyric-pronunciations.mjs";
import { readFile } from "node:fs/promises";

test("dictionary sounds give IPA and readable syllables, including schwa and stress", () => {
  assert.equal(pronounce("HH AH0 L OW1", "ipa"), "həˈloʊ");
  assert.equal(pronounce("HH AH0 L OW1", "phonics"), "huh-LOH");
  assert.equal(pronounce("T OW1 N IY0", "phonics"), "TOH-nee");
  assert.equal(lyricView("The night is young!", "ipa", dictionary), "/ðə/ /naɪt/ /ɪz/ /jʌŋ/!");
  assert.equal(lyricView("The night is young!", "phonics", dictionary), "dhuh nyte iz yuhng!");
});

test("all views preserve section headings, spacing, punctuation and unknown Unicode words", () => {
  const text = "[Chorus]\n\nHello, Zxyzzë!  I’m here.\n<don't> & 123";
  const result = lyricView(text, "ipa", dictionary);
  assert.ok(result.startsWith("[Chorus]\n\n/həˈloʊ/, Zxyzzë!  /aɪm/"));
  assert.ok(result.endsWith("</doʊnt/> & 123"));
  assert.equal(lyricView(text, "original", dictionary), text);
  assert.equal(lyricView(text, "invalid", dictionary), text);
  assert.equal(lyricView("[Verse]\nTony, café!", "diacritics"), "[Verse]\nTönÿ, cäfé!");
  assert.equal(lyricView("constructor", "ipa", {}), "constructor");
});

test("the build ships only catalog vocabulary with usable phoneme mappings", async () => {
  assert.deepEqual(lyricPronunciations([{ lyrics: { text: "Hello hello I’m Zxyzzë" } }]), {
    hello: dictionary.hello, "i'm": dictionary["i'm"],
  });
  const catalog = JSON.parse(await readFile(new URL("../catalog.json", import.meta.url), "utf8"));
  const built = JSON.parse(await readFile(new URL("../dist/assets/lyric-pronunciations.json", import.meta.url), "utf8"));
  assert.deepEqual(built, lyricPronunciations(catalog.songs));
  for (const [word, phones] of Object.entries(built)) assert.notEqual(pronounce(phones, "ipa"), null, word);
});
