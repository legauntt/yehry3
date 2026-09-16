import { generationBrief } from './generation.js';
import { materialBrief, wordCount } from "./request-materials.js";

const voiceLabel = (value) => {
  const model = /^v\d+$/i.test(value || "") ? value.toUpperCase() : "V6";
  return `Tony ${model} · ${model === "V6" ? "established" : "experimental"}`;
};
const lyricMode = (sheet) => sheet.mode === "adapt" ? "Adapt these lyrics" : "Keep my wording";

function layout({ idea, authoredBy, voice, keep, direction, basis, generation }, materials, escape) {
  const field = (label, value) => `<dt>${label}</dt><dd>${escape(value)}</dd>`;
  return `<div class="brief prompt-brief">
    <section class="prompt-section"><h3>Essentials</h3><div class="prompt-section-body"><dl>
      ${authoredBy ? field("Authored by", authoredBy) : ""}
      ${field("The idea", idea)}
      ${field("Voice model", voice)}
      ${field("What matters most?", keep || "Surprise me.")}
    </dl></div></section>
    <section class="prompt-section"><h3>Advanced</h3><div class="prompt-section-body">
      <dl>${field("What does it sound like?", direction || "Use the prompt as written.")}</dl>
      ${generationBrief(generation, escape)}
      ${materials}
      <dl>${field("Basis songs", basis || "No basis songs selected.")}</dl>
    </div></section>
  </div>`;
}

export function requestPromptBrief(doc, escape, describeVoice = voiceLabel) {
  const details = doc.details || {};
  const materials = materialBrief(details, escape) || '<div class="materials-review"><h3>Lyrics &amp; references</h3><p class="small">No lyric sheet or reference links supplied.</p></div>';
  return layout({
    idea: doc.prompt, authoredBy: doc.authoredBy,
    voice: describeVoice(details.voiceModel || "v6"), keep: details.keep, direction: details.direction,
    generation: details.generation, basis: details.basisSongTitles?.join("\n") || details.source,
  }, materials, escape);
}

export function publicPromptBrief(song, escape, { materialsUnavailable = false } = {}) {
  const brief = song.originalPrompt || {};
  const materials = materialBrief(brief, escape) || `<div class="materials-review"><h3>Lyrics &amp; references</h3><p class="small">${materialsUnavailable ? 'Lyrics and references could not be loaded. Reload this page to try again.' : 'No lyric sheet or reference links supplied.'}</p></div>`;
  return layout({
    idea: brief.idea, authoredBy: song.authoredBy,
    voice: voiceLabel(brief.voiceModel), keep: brief.keep, direction: brief.direction,
    generation: brief.generation, basis: brief.basisSongs?.join("\n"),
  }, materials, escape);
}

export function promptSummary(details = {}, escape) {
  const items = [voiceLabel(details.voiceModel)];
  if (details.direction && details.direction !== "Use the prompt as written.") items.push("Custom sound");
  if (details.lyricSheet?.text) items.push(`${lyricMode(details.lyricSheet)} · ${wordCount(details.lyricSheet.text).toLocaleString()} words`);
  const references = details.references?.length || 0;
  if (references) items.push(`${references} reference ${references === 1 ? "link" : "links"}`);
  const basis = details.basisSongTitles?.length || 0;
  if (basis) items.push(`${basis} basis ${basis === 1 ? "song" : "songs"}`);
  else if (details.source) items.push("Basis supplied");
  return `<ul class="prompt-summary" aria-label="Request settings">${items.map(item => `<li>${escape(item)}</li>`).join("")}</ul>`;
}
