// Keep the lineage of the chosen words, independently of the eight editable versions.
const LIMIT = 32;
export function lyricPromptHistory(value) {
  if (!value || !Array.isArray(value.prompts)) return undefined;
  const prompts = value.prompts.filter(prompt => typeof prompt === 'string' && prompt.trim()).map(prompt => prompt.trim());
  return { prompts: prompts.slice(-LIMIT), ...(value.incomplete || prompts.length > LIMIT ? { incomplete: true } : {}) };
}

export function versionPromptHistory(version) {
  if (version?.promptHistory) return lyricPromptHistory(version.promptHistory);
  // Older browser drafts saved only the prompt for that version, not its ancestors.
  const prompt = version?.prompt;
  if (prompt && !['Edited by you. No writing prompt.', 'The prompt was not saved for this older version.'].includes(prompt))
    return { prompts: [prompt], incomplete: true };
  return version ? { prompts: [], incomplete: true } : undefined;
}

export function appendLyricPrompt(history, prompt) {
  return lyricPromptHistory({ ...history, prompts: [...(history?.prompts || []), prompt] });
}

export function lyricPromptBrief(sheet, escape) {
  const history = lyricPromptHistory(sheet?.promptHistory);
  if (!history || (!history.prompts.length && !history.incomplete)) return '';
  return '<details class="lyric-prompt-history"><summary>Lyric prompt history</summary>' +
    '<p class="small">The saved guidance and revision nudges used for the chosen lyrics, in order. The words may also include manual edits.</p>' +
    (history.incomplete ? '<p class="small">Some earlier prompts were not retained. The available prompts are shown below.</p>' : '') +
    '<ol>' + history.prompts.map(prompt => '<li><pre class="material-text">' + escape(prompt) + '</pre></li>').join('') + '</ol></details>';
}
