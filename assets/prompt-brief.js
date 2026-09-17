import { generationBrief, generationSelections } from './generation-brief.js';
import { voiceVersionLabel as voiceLabel } from './model-info.js';
import { materialBrief, wordCount } from "./request-materials.js";

const lyricMode = (sheet) => sheet.mode === "adapt" ? "Adapt these lyrics" : "Keep my wording";

function layout({ idea, authoredBy, voice, keep, direction, basis, generation, musicBackend }, materials, escape) {
  const field = (label, value) => `<dt>${label}</dt><dd>${escape(value)}</dd>`;
  const chosenDirection = direction && direction !== 'Use the prompt as written.' ? direction : '';
  const advanced = (chosenDirection ? `<dl>${field("What does it sound like?", chosenDirection)}</dl>` : '')
    + generationBrief(generation, escape) + materials + (basis ? `<dl>${field("Basis songs", basis)}</dl>` : '');
  return `<div class="brief prompt-brief">
    <section class="prompt-section"><h3>Essentials</h3><div class="prompt-section-body"><dl>
      ${authoredBy ? field("Authored by", authoredBy) : ""}
      ${field("The idea", idea)}
      ${field("Voice model", voice)}
      ${musicBackend ? field("Band generator", musicBackend === "eleven_music" ? "Eleven Music · paid" : "Local · ACE") : ""}
      ${keep && keep !== "Surprise me." ? field("What matters most?", keep) : ""}
      ${generation && musicBackend !== "eleven_music" ? field("Song generation", "V8") : ""}
    </dl></div></section>
    ${advanced ? `<section class="prompt-section"><h3>Advanced</h3><div class="prompt-section-body">${advanced}</div></section>` : ''}
  </div>`;
}

export function requestPromptBrief(doc, escape, describeVoice = voiceLabel) {
  const details = doc.details || {};
  const materials = materialBrief(details, escape);
  return layout({
    idea: doc.prompt, authoredBy: doc.authoredBy,
    voice: describeVoice(details.voiceModel || "v6"), keep: details.keep, direction: details.direction,
    generation: details.generation, musicBackend: details.musicBackend, basis: details.basisSongTitles?.join("\n") || details.source,
  }, materials, escape);
}

export function publicPromptBrief(song, escape, { materialsUnavailable = false } = {}) {
  const brief = song.originalPrompt || {};
  const materials = materialBrief(brief, escape) || (materialsUnavailable ? '<p class="small">Lyrics and references could not be loaded. Reload this page to try again.</p>' : '');
  return layout({
    idea: brief.idea, authoredBy: song.authoredBy,
    voice: voiceLabel(brief.voiceModel), keep: brief.keep, direction: brief.direction,
    generation: brief.generation, musicBackend: brief.musicBackend, basis: brief.basisSongs?.join("\n"),
  }, materials, escape);
}

export function promptSummary(details = {}, escape) {
  const items = [voiceLabel(details.voiceModel)];
  if (details.generation) {
    items.push(details.musicBackend === 'eleven_music' ? 'Eleven Music · paid' : 'V8 generation');
    if (details.generation.genre) items.push(details.generation.genre);
    const choices = generationSelections(details.generation).length;
    if (choices) items.push(`${choices} Advanced ${choices === 1 ? 'setting' : 'settings'}`);
  }
  if (details.direction && details.direction !== "Use the prompt as written.") items.push("Custom sound");
  if (details.lyricSheet?.text) items.push(`${lyricMode(details.lyricSheet)} · ${wordCount(details.lyricSheet.text).toLocaleString()} words`);
  const references = details.references?.length || 0;
  if (references) items.push(`${references} reference ${references === 1 ? "link" : "links"}`);
  const basis = details.basisSongTitles?.length || 0;
  if (basis) items.push(`${basis} basis ${basis === 1 ? "song" : "songs"}`);
  else if (details.source) items.push("Basis supplied");
  return `<ul class="prompt-summary" aria-label="Request settings">${items.map(item => `<li>${escape(item)}</li>`).join("")}</ul>`;
}
