// Tony's voice follows the pitch tracked from a guide singer. This chooses how far that track is
// tidied before he sings it; melody, key and timing never change. The choice is remembered per browser.
const rememberKey = 'yehry3:pitch-repair-v1';
export const pitchModes = {
  clean: ['Clean', 'Steadiest. Octave slips in the guide singer’s pitch are fixed before Tony sings, so far fewer cracks.'],
  haunted: ['Haunted', 'Only the briefest slips are fixed. Most of the possessed moments stay.'],
  wild: ['Wild', 'Untouched. Every crack, yelp and octave drop stays in.'],
};
export const defaultPitch = 'clean';
const known = (value) => Object.hasOwn(pitchModes, value) ? value : null;
export const rememberedPitch = () => { try { return known(localStorage.getItem(rememberKey)); } catch { return null; } };
const remember = (value) => { try { localStorage.setItem(rememberKey, value); } catch { /* The request still carries the choice. */ } };

export function pitchControl(schema, { compare = false } = {}) {
  if (!schema.choices?.pitchRepair) return '';
  const modes = schema.choices.pitchRepair.filter(known).sort((a, b) => Object.keys(pitchModes).indexOf(a) - Object.keys(pitchModes).indexOf(b));
  const options = modes.map((mode) => `<option value="${mode}">${pitchModes[mode][0]}</option>`).join('');
  return `<div class="pitch-repair"><label for="gen-pitchRepair">Tony’s pitch</label>
    <select id="gen-pitchRepair" data-generation="pitchRepair" aria-describedby="pitch-repair-hint">${options}</select>
    <p class="small" id="pitch-repair-hint" aria-live="polite"></p>${compare && schema.choices.pitchCompare ? `
    <label for="gen-pitchCompare">B side <span class="small">(optional)</span></label>
    <select id="gen-pitchCompare" data-generation="pitchCompare" aria-describedby="pitch-compare-hint"><option value="">No B side</option>${options}</select>
    <p class="small" id="pitch-compare-hint">Tony sings the same song a second time with this setting, so you can switch between the two while it plays. The song takes longer to finish.</p>` : ''}</div>`;
}

// `saved` is the choice already stored with this request, if any; it outranks the remembered one.
export function mountPitchControl(root, { saved, onChange }) {
  const select = root.querySelector('#gen-pitchRepair');
  if (!select) return;
  const hint = root.querySelector('#pitch-repair-hint'), other = root.querySelector('#gen-pitchCompare');
  const show = () => {
    hint.textContent = `${pitchModes[select.value][1]} Remembered for your next request.`;
    if (!other) return;
    for (const option of other.options) option.disabled = option.value === select.value;
    if (other.value === select.value) other.value = '';
  };
  select.value = known(saved) || rememberedPitch() || defaultPitch;
  show();
  select.addEventListener('change', () => { remember(select.value); show(); onChange?.(); });
}
