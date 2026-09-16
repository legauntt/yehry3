// Suggested caption vocabulary, not a generator allowlist. ACE accepts custom text.
// https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/Tutorial.md
export const genres = ['Acoustic', 'Alternative rock', 'Ambient', 'Blues', 'Classical', 'Country', 'Disco', 'Electronic', 'Folk', 'Funk', 'Gospel', 'Hip-hop', 'House', 'Indie rock', 'Jazz', 'Lo-fi', 'Metal', 'Opera', 'Orchestral', 'Pop', 'Punk', 'R&B', 'Reggae', 'Rock', 'Sea shanty', 'Soul', 'Synth-pop', 'Synthwave', 'Waltz'];
export const instruments = ['Acoustic guitar', 'Electric guitar', 'Electric bass', 'Upright bass', 'Piano', 'Electric piano', 'Organ', 'Synthesizer', 'Synth pads', 'Drum kit', '808 drums', 'Drum machine', 'Hand percussion', 'Tambourine', 'Strings', 'Violin', 'Viola', 'Cello', 'Double bass', 'Harp', 'Brass', 'Trumpet', 'Trombone', 'French horn', 'Saxophone', 'Flute', 'Clarinet', 'Oboe', 'Accordion', 'Banjo', 'Mandolin', 'Harmonica'];
const sections = ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Post-chorus', 'Bridge', 'Instrumental break', 'Solo', 'Final chorus', 'Outro'];
const shapes = [
  ['verse-chorus', 'Verse & chorus', ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Bridge', 'Final chorus', 'Outro']],
  ['chorus-first', 'Start with the hook', ['Chorus', 'Verse', 'Chorus', 'Verse', 'Bridge', 'Final chorus', 'Outro']],
  ['verse-led', 'Verse-led story', ['Intro', 'Verse', 'Verse', 'Bridge', 'Verse', 'Outro']],
  ['build', 'Build to a final chorus', ['Intro', 'Verse', 'Pre-chorus', 'Chorus', 'Verse', 'Pre-chorus', 'Bridge', 'Final chorus', 'Outro']],
];
const options = (values, escape) => values.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');

export function generationControl(key, label, schema, escape) {
  const id = 'gen-' + key;
  if (key === 'genre') return `<label for="${id}">${label}</label><select id="${id}"><option value="">Auto · choose for this song</option>${options(genres, escape)}<option value="custom">Custom style or blend…</option></select><div class="generation-custom" hidden><label for="${id}-custom">Your style or genre</label><input id="${id}-custom" maxlength="${schema.textLimits.genre}" placeholder="e.g. smoky jazz with a waltz feel"></div><input type="hidden" data-generation="genre">`;
  if (key === 'instruments' || key === 'avoidInstruments') return `<label for="${id}">${label}</label><select id="${id}" aria-describedby="${id}-hint"><option value="">Choose an instrument to add…</option>${options(instruments, escape)}<option value="custom">Custom instrument…</option></select><div class="generation-custom" hidden><label for="${id}-custom">${key === 'instruments' ? 'Custom featured instrument' : 'Custom instrument to leave out'}</label><div class="generation-add"><input id="${id}-custom" maxlength="${schema.listLimits[key][1]}" placeholder="Instrument name"><button type="button" class="quiet" data-add-instrument>Add</button></div></div><ul class="generation-chips" aria-label="${escape(label)} selected"></ul><p id="${id}-hint" class="small generation-hint">Choose up to ${schema.listLimits[key][0]}. Leave empty for Auto.</p><p class="field-error generation-input-error" role="status"></p><textarea hidden data-generation="${key}"></textarea>`;
  if (key === 'structure') return `<label for="${id}-preset">${label}</label><select id="${id}-preset"><option value="">Auto · choose for this song</option>${shapes.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}<option value="custom">Build a custom order…</option></select><div class="generation-section-editor" hidden><p class="small generation-hint">Rename, move or remove sections. Repeated verses and choruses are welcome.</p><ol class="generation-sections" aria-label="Song sections in order"></ol><label for="gen-section-add">Add a section</label><select id="gen-section-add"><option value="">Choose a section to add…</option>${options(sections, escape)}<option value="custom">Custom section…</option></select><p class="small generation-section-status" role="status"></p></div><input type="hidden" id="${id}" data-generation="structure">`;
  return null;
}

export function mountGenerationControls(root, { schema, escape }) {
  const changed = field => field.dispatchEvent(new Event('input', { bubbles: true }));
  const genre = root.querySelector('[data-generation="genre"]');
  const genreSelect = root.querySelector('#gen-genre');
  const genreCustom = root.querySelector('#gen-genre-custom');
  const knownGenre = genres.find(value => value.toLowerCase() === genre.value.toLowerCase());
  // Keep the saved spelling in the canonical field until the user changes it.
  genreSelect.value = genre.value ? (knownGenre || 'custom') : '';
  genreCustom.value = genre.value;
  genreCustom.parentElement.hidden = genreSelect.value !== 'custom';
  genreSelect.onchange = () => {
    genreCustom.parentElement.hidden = genreSelect.value !== 'custom';
    genre.value = genreSelect.value === 'custom' ? genreCustom.value : genreSelect.value;
    changed(genre);
    if (genreSelect.value === 'custom') genreCustom.focus();
  };
  genreCustom.oninput = () => { genre.value = genreCustom.value; changed(genre); };

  for (const key of ['instruments', 'avoidInstruments']) {
    const field = root.querySelector(`[data-generation="${key}"]`), holder = field.parentElement;
    const select = holder.querySelector('select'), custom = holder.querySelector('input');
    const chips = holder.querySelector('ul'), error = holder.querySelector('.generation-input-error');
    const [limit] = schema.listLimits[key];
    let values = field.value.split('\n').filter(value => value.trim());
    const render = () => {
      chips.innerHTML = values.map((value, i) => `<li><span>${escape(value)}</span><button type="button" data-remove="${i}" aria-label="Remove ${escape(value)} from ${key === 'instruments' ? 'featured instruments' : 'excluded instruments'}">×</button></li>`).join('');
      for (const option of select.options) option.disabled = Boolean(option.value) && (values.length >= limit || values.some(value => value.toLowerCase() === option.value.toLowerCase()));
      field.value = values.join('\n');
      holder.querySelector('.generation-hint').textContent = values.length ? `${values.length} of ${limit} selected. Choose another or remove one.` : `Choose up to ${limit}. Leave empty for Auto.`;
    };
    const add = value => {
      const clean = value.trim();
      if (!clean) { error.textContent = 'Enter an instrument name.'; custom.focus(); return; }
      if (values.length >= limit) { error.textContent = `Choose at most ${limit} instruments.`; return; }
      if (values.some(item => item.toLowerCase() === clean.toLowerCase())) { error.textContent = 'That instrument is already selected.'; return; }
      values.push(clean); custom.value = ''; error.textContent = ''; render(); changed(field);
    };
    select.onchange = () => {
      holder.querySelector('.generation-custom').hidden = select.value !== 'custom';
      if (select.value === 'custom') custom.focus();
      else if (select.value) { add(select.value); select.value = ''; }
    };
    holder.querySelector('[data-add-instrument]').onclick = () => add(custom.value);
    custom.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); add(custom.value); } };
    chips.onclick = event => {
      const button = event.target.closest('[data-remove]'); if (!button) return;
      values.splice(Number(button.dataset.remove), 1); error.textContent = ''; render(); changed(field); select.focus();
    };
    render();
  }

  const structure = root.querySelector('[data-generation="structure"]');
  const preset = root.querySelector('#gen-structure-preset'), editor = root.querySelector('.generation-section-editor');
  const list = root.querySelector('.generation-sections'), addSection = root.querySelector('#gen-section-add');
  const status = root.querySelector('.generation-section-status');
  let order = structure.value ? structure.value.split(/,\s*/) : [];
  const matchingShape = () => shapes.find(([, , sequence]) => sequence.join(', ') === structure.value)?.[0];
  preset.value = structure.value ? (matchingShape() || 'custom') : '';
  const sync = () => {
    structure.value = order.map(value => value.trim()).filter(Boolean).join(', ');
    preset.value = order.length ? (matchingShape() || 'custom') : 'custom';
    status.textContent = structure.value.length > schema.textLimits.structure ? `Shorten the section order to ${schema.textLimits.structure} characters.` : `${order.length} ${order.length === 1 ? 'section' : 'sections'} · use the arrows to change the order.`;
    changed(structure);
  };
  const render = () => {
    editor.hidden = preset.value === '';
    list.innerHTML = order.map((value, i) => `<li><span class="generation-section-number" aria-hidden="true">${i + 1}</span><input value="${escape(value)}" aria-label="Section ${i + 1}" maxlength="${schema.textLimits.structure}" data-section="${i}"><div class="generation-section-actions"><button type="button" class="quiet" data-move="-1" data-index="${i}" aria-label="Move section ${i + 1} earlier" ${i === 0 ? 'disabled data-unavailable' : ''}>↑</button><button type="button" class="quiet" data-move="1" data-index="${i}" aria-label="Move section ${i + 1} later" ${i === order.length - 1 ? 'disabled data-unavailable' : ''}>↓</button><button type="button" class="quiet" data-remove-section="${i}" aria-label="Remove section ${i + 1}">×</button></div></li>`).join('');
  };
  preset.onchange = () => {
    if (!preset.value) { order = []; structure.value = ''; status.textContent = ''; changed(structure); }
    else if (preset.value !== 'custom') { order = [...shapes.find(([id]) => id === preset.value)[2]]; sync(); }
    render();
  };
  list.oninput = event => {
    if (!event.target.matches('[data-section]')) return;
    order[Number(event.target.dataset.section)] = event.target.value; sync();
  };
  list.onclick = event => {
    const button = event.target.closest('button'); if (!button) return;
    let index;
    if (button.hasAttribute('data-remove-section')) { index = Number(button.dataset.removeSection); order.splice(index, 1); }
    else { const from = Number(button.dataset.index); index = from + Number(button.dataset.move); if (index < 0 || index >= order.length) return; [order[from], order[index]] = [order[index], order[from]]; }
    sync(); render();
    const focus = list.querySelector(`[data-section="${Math.min(index, order.length - 1)}"]`) || addSection;
    focus.focus();
  };
  addSection.onchange = () => {
    if (!addSection.value) return;
    order.push(addSection.value === 'custom' ? 'Custom section' : addSection.value); addSection.value = '';
    sync(); render(); const input = list.querySelector('li:last-child input'); input.focus(); input.select();
  };
  render();
}
