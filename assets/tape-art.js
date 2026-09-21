import { remixFromPrompt, songArtwork } from "./song-art.js";

// Side clipart is the same daft cast the song covers use, drawn by the same generator.
// A side stands in for a song (its own ID and title), so "Side A" and "Side B" never
// draw the same picture from the same words, and the tape stores only small numbers.
const stand = side => ({ id: `mixtape-side-${side}`, title: `Side ${side.toUpperCase()}` });

// Words in, picture out. Blank words are a surprise; `again` asks for another take on the same words.
export function drawClipart(side, words, again = 0) {
  const prompt = String(words || "").trim() || "surprise";
  const { remix, understood } = remixFromPrompt(stand(side), prompt, { fresh: true, again });
  return { art: remix, understood };
}

const attribute = value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
// The picture as markup. Decorative copies (gallery cards) stay out of the reader's way.
export function artImage(side, art, decorative = false) {
  if (!art) return "";
  // Wide, so the picture fills the label's whole 1000 x 240 rectangle rather than sitting in a square.
  const picture = songArtwork({ ...stand(side), artRemix: art }, { wide: true });
  return `<img class="tape-art" src="${attribute(picture.src)}" alt="${decorative ? "" : attribute(`Side ${side.toUpperCase()} clipart. ${picture.alt}`)}" width="1000" height="240">`;
}
