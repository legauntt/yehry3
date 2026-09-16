const labels = { genre: 'Style or genre', instruments: 'Featured instruments', avoidInstruments: 'Leave out these instruments', duration: 'Length (seconds)', bpm: 'Tempo (BPM)', keyscale: 'Key', meter: 'Meter', vocalEntry: 'First vocal (seconds)', endingSeconds: 'Closing chord (seconds)', maxBreakSeconds: 'Longest instrumental break (seconds)', structure: 'Section order', lyricWorkflow: 'Writing approach', avoidPhrases: 'Avoid these lyric phrases', requiredPhrases: 'Include these phrases', lockedLines: 'Keep these lines exactly', performance: 'Vocal delivery', energy: 'Energy through the song', variation: 'Variation', seed: 'Seed', candidates: 'Composition choices', vocalGainDb: 'Vocal level adjustment (dB)', backingGainDb: 'Band level adjustment (dB)', reviewLyrics: 'Lyric preview' };
const names = { story: 'Story first', hook: 'Hook first', rhythm: 'Rhythm first', restrained: 'Restrained', raw: 'Raw', build: 'Build toward the finish', waves: 'Quiet and strong sections', steady: 'Steady groove', conservative: 'More consistent', adventurous: 'More adventurous' };
// The API fills these neutral defaults even when the user leaves them untouched.
const neutral = { lyricWorkflow: 'auto', energy: 'auto', performance: 'natural', variation: 'balanced', candidates: 1, reviewLyrics: false, vocalGainDb: 0, backingGainDb: 0 };
const groups = [
  ['Style & instruments', ['genre', 'instruments', 'avoidInstruments', 'performance', 'energy', 'structure']],
  ['Timing & key', ['duration', 'bpm', 'keyscale', 'meter', 'vocalEntry', 'endingSeconds', 'maxBreakSeconds']],
  ['Lyrics', ['lyricWorkflow', 'avoidPhrases', 'requiredPhrases', 'lockedLines', 'reviewLyrics']],
  ['Choices & mix', ['candidates', 'variation', 'seed', 'vocalGainDb', 'backingGainDb']],
];

export function generationSelections(options = {}) {
  return Object.entries(options || {}).filter(([key, value]) => Object.hasOwn(labels, key)
    && value != null && value !== 'auto' && value !== ''
    && !(typeof value === 'string' && !value.trim())
    && !(Array.isArray(value) && !value.length)
    && !(Object.hasOwn(neutral, key) && neutral[key] === value));
}

export function generationBrief(options, escape) {
  const selected = new Map(generationSelections(options));
  if (!selected.size) return '';
  const sections = groups.map(([title, keys]) => {
    const fields = keys.filter(key => selected.has(key)).map(key => {
      const value = selected.get(key);
      const display = key === 'reviewLyrics' ? 'Approve before composing' : Array.isArray(value) ? value.join('\n') : Object.hasOwn(names, value) ? names[value] : String(value);
      return `<dt>${labels[key]}</dt><dd>${escape(display)}</dd>`;
    }).join('');
    return fields ? `<section class="generation-brief-group"><h4>${title}</h4><dl>${fields}</dl></section>` : '';
  }).join('');
  return `<div class="generation-brief"><h3>V8 generation</h3>${sections}</div>`;
}
