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

const modeOptions = (schema) => schema.choices.pitchRepair.filter(known).sort((a, b) => Object.keys(pitchModes).indexOf(a) - Object.keys(pitchModes).indexOf(b))
  .map((mode) => `<option value="${mode}">${pitchModes[mode][0]}</option>`).join('');

export function pitchControl(schema) {
  if (!schema.choices?.pitchRepair) return '';
  return `<div class="pitch-repair"><label for="gen-pitchRepair">Tony’s pitch</label>
    <select id="gen-pitchRepair" data-generation="pitchRepair" aria-describedby="pitch-repair-hint">${modeOptions(schema)}</select>
    <p class="small" id="pitch-repair-hint" aria-live="polite"></p><p class="small" id="pitch-repair-off" hidden>Pitch applies to V8 song generation. Turn it on in Advanced to choose.</p></div>`;
}

// The B side lives in Advanced, beside the other song controls, rather than with the pitch choice on Essentials.
export function pitchCompareControl(schema) {
  if (!schema.choices?.pitchRepair || !schema.choices.pitchCompare) return '';
  return `<details class="generation-group pitch-compare"><summary>B side <span class="small">(optional)</span></summary>
    <p class="small" id="pitch-compare-hint">Tony sings the same song a second time with this setting, so you can switch between the two while it plays. The song takes longer to finish.</p>
    <div class="generation-grid"><div><label for="gen-pitchCompare">Second pitch setting</label>
    <select id="gen-pitchCompare" data-generation="pitchCompare" aria-describedby="pitch-compare-hint"><option value="">No B side</option>${modeOptions(schema)}</select></div></div></details>`;
}

// `saved` is the choice already stored with this request, if any; it outranks the remembered one.
export function mountPitchControl(root, { saved, onChange, compareRoot = root }) {
  const select = root.querySelector('#gen-pitchRepair');
  if (!select) return;
  const hint = root.querySelector('#pitch-repair-hint'), other = compareRoot.querySelector('#gen-pitchCompare');
  const show = () => {
    hint.textContent = `${pitchModes[select.value][1]} Remembered for your next request.`;
    if (!other) return;
    for (const option of other.options) option.disabled = option.value === select.value;
    if (other.value === select.value) other.value = '';
  };
  select.value = known(saved) || rememberedPitch() || defaultPitch;
  show();
  select.addEventListener('change', () => { remember(select.value); show(); onChange?.(); });
  // The control can sit outside the panel whose edits are saved automatically, so it reports its own.
  other?.addEventListener('change', () => onChange?.());
}
