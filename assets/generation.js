import { normalizeGeneration } from './generation-options.js';
import { generationControl, mountGenerationControls } from './generation-controls.js';
import { generationBrief } from './generation-brief.js';
import { pitchControl, mountPitchControl } from './pitch-repair.js';
export { generationBrief } from './generation-brief.js';

const labels = { genre: 'Style or genre', instruments: 'Featured instruments', avoidInstruments: 'Leave out these instruments', duration: 'Length (seconds)', bpm: 'Tempo (BPM)', keyscale: 'Key', meter: 'Meter', vocalEntry: 'First vocal (seconds)', endingSeconds: 'Closing chord (seconds)', maxBreakSeconds: 'Longest instrumental break (seconds)', structure: 'Section order', lyricWorkflow: 'Writing approach', avoidPhrases: 'Avoid these lyric phrases', requiredPhrases: 'Include these phrases', lockedLines: 'Keep these lines exactly', performance: 'Vocal delivery', energy: 'Energy through the song', variation: 'Variation', seed: 'Seed', candidates: 'Composition choices', vocalGainDb: 'Vocal level adjustment (dB)', backingGainDb: 'Band level adjustment (dB)' };
const names = { auto: 'Choose for this song', story: 'Story first', hook: 'Hook first', rhythm: 'Rhythm first', natural: 'Natural and expressive', restrained: 'Restrained', raw: 'Raw', build: 'Build toward the finish', waves: 'Quiet and strong sections', steady: 'Steady groove', balanced: 'Balanced', conservative: 'More consistent', adventurous: 'More adventurous' };
const preferenceKey = 'yehry3:generation-preferences-v1';
const getPreferences = () => { try { return JSON.parse(localStorage.getItem(preferenceKey) || 'null'); } catch { return null; } };

// `pitchRoot` lets the pitch choice sit outside the Advanced panel; it still travels with the generation options.
export function mountGeneration(root, { draft, schema, enabled, storage, escape, pitchRoot }) {
  const key = `generation-draft:${draft.id}`;
  let initial = draft.details?.generation, explicitlyDisabled = false;
  let required = false, voiceRequired = false, backend = 'local';
  const durationRange = () => [schema.ranges.duration[0], backend === 'eleven_music' ? Math.min(600, schema.ranges.duration[1]) : schema.ranges.duration[1]];
  try { const saved = JSON.parse(storage.get(key) || 'null'); if (saved) { explicitlyDisabled = saved.enabled === false; initial = saved.value ?? initial; } } catch {}
  const savedPitch = initial?.pitchRepair;
  const preferences = getPreferences();
  if (!initial && preferences && draft.status === 'draft') initial = preferences;
  if (!enabled) {
    root.innerHTML = initial && !explicitlyDisabled ? '<p class="field-error">V8 generation is temporarily unavailable. Your choices are saved.</p>' + generationBrief(initial, escape) : '';
    return { setBackend(value) { backend = value; required = voiceRequired || backend === 'eleven_music'; }, setRequired(value) { voiceRequired = Boolean(value); required = voiceRequired || backend === 'eleven_music'; }, read() { if (required || initial && !explicitlyDisabled) throw new Error('V8 generation is unavailable. Try again shortly.'); return null; }, clear() {} };
  }
  const input = (key) => {
    const control = generationControl(key, labels[key], schema, escape);
    if (control) return control;
    const id = 'gen-' + key;
    let field;
    if (schema.ranges[key]) {
      const [min, max] = schema.ranges[key];
      field = `<input id="${id}" data-generation="${key}" type="number" min="${min}" max="${max}" step="${key.endsWith('GainDb') ? '.5' : '1'}" placeholder="Auto">`;
    } else if (schema.choices[key]) {
      field = `<select id="${id}" data-generation="${key}">${!Object.hasOwn(schema.defaults, key) ? '<option value="">Auto</option>' : ''}${schema.choices[key].map((v) => `<option value="${v}">${names[v] || v}</option>`).join('')}</select>`;
    } else if (key === 'keyscale') {
      field = `<select id="${id}" data-generation="${key}"><option value="">Auto</option>${['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'].flatMap((note) => ['major','minor'].map((mode) => `<option>${note} ${mode}</option>`)).join('')}</select>`;
    } else if (schema.listLimits[key] || key === 'structure') {
      field = `<textarea id="${id}" data-generation="${key}" rows="2" maxlength="${schema.listLimits[key] ? (schema.listLimits[key][1] + 1) * schema.listLimits[key][0] : 600}" placeholder="${schema.listLimits[key] ? 'One entry per line' : 'Intro, verse, chorus, verse, chorus, bridge, final chorus'}"></textarea>`;
    } else field = `<input id="${id}" data-generation="${key}" maxlength="${schema.textLimits[key]}" placeholder="Auto">`;
    return `<label for="${id}">${labels[key]}</label>${field}${key === 'duration' ? '<p class="small" id="generation-duration-hint"></p>' : ''}`;
  };
  const group = (title, keys, note) => `<details class="generation-group"><summary>${title}</summary><p class="small">${note}</p><div class="generation-grid">${keys.map((key) => `<div class="${key === 'structure' ? 'generation-wide' : ''}">${input(key)}</div>`).join('')}</div></details>`;
  root.innerHTML = `<section class="generation-panel"><h3>Song generation</h3><label class="generation-enable"><input type="checkbox" id="generation-enabled"> <span id="generation-enable-label">Use V8 generation</span></label><p class="small" id="generation-mode-note">Available with every Tony voice. Choose a new composition or a reinterpretation of a basis song.</p><div id="generation-fields" hidden>
    ${pitchRoot ? '' : pitchControl(schema, { compare: true })}
    ${group('Style & instruments', ['genre','instruments','avoidInstruments','performance','energy','structure'], 'Pick a suggested style or instrument, or add your own. These choices guide the sound; the menus are not an exhaustive list.')}
    ${group('Timing & key', ['duration','bpm','keyscale','meter','vocalEntry','endingSeconds','maxBreakSeconds'], 'Leave blank for Auto. Tempo, key and timing are musical targets; expressive performances can vary. 6/8 also uses a compound-meter prompt.')}
    ${group('Lyrics', ['lyricWorkflow','avoidPhrases','requiredPhrases','lockedLines'], 'One phrase or locked line per line. Your supplied lyrics and explicitly requested words take priority over general avoidance.')}
    <label class="generation-enable"><input type="checkbox" id="gen-reviewLyrics"> Let me edit and approve the lyrics before composing</label>
    ${group('Choices & mix', ['candidates','variation','seed','vocalGainDb','backingGainDb'], 'Choose 1 for automatic generation, or 2–3 to compare compositions before Tony voice conversion. More choices take longer. Mix adjustments retain peak checks.')}
    <div class="actions"><button type="button" class="quiet" id="generation-remember">Remember these choices</button><button type="button" class="quiet" id="generation-forget">Forget saved choices</button></div><p class="small" id="generation-preference-status" role="status">${preferences ? 'Saved choices are available in this browser.' : 'Choices are saved with this request. Remember them only if you want them on future requests.'}</p>
    </div></section>`;
  if (pitchRoot) pitchRoot.innerHTML = pitchControl(schema, { compare: true });
  const scopes = pitchRoot ? [root, pitchRoot] : [root];
  const generationFields = () => scopes.flatMap((scope) => [...scope.querySelectorAll('[data-generation]')]);
  const enable = root.querySelector('#generation-enabled'), fields = root.querySelector('#generation-fields');
  for (const field of generationFields()) {
    const key = field.dataset.generation;
    const value = initial?.[key] ?? schema.defaults[key] ?? '';
    field.value = Array.isArray(value) ? value.join('\n') : value;
  }
  mountGenerationControls(root, { schema, escape });
  mountPitchControl(pitchRoot || root, { saved: savedPitch, onChange: () => persist() });
  root.querySelector('#gen-reviewLyrics').checked = Boolean(initial?.reviewLyrics);
  enable.checked = Boolean(initial) && !explicitlyDisabled;
  const read = () => {
    if (!enable.checked) return null;
    const value = { version: 1, reviewLyrics: root.querySelector('#gen-reviewLyrics').checked };
    for (const field of generationFields()) {
      const key = field.dataset.generation, raw = field.value.trim();
      if (backend === 'eleven_music' && ['candidates', 'variation'].includes(key)) continue;
      if (!raw) continue;
      value[key] = schema.ranges[key] ? Number(raw) : schema.listLimits[key] ? raw.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : raw;
    }
    if (backend === 'eleven_music') { value.candidates = 1; value.variation = 'balanced'; }
    return normalizeGeneration(value, { ...schema, ranges: { ...schema.ranges, duration: durationRange() } });
  };
  const persist = () => {
    try { storage.set(key, JSON.stringify({ enabled: enable.checked, value: read() })); } catch { /* Keep editable invalid input in the DOM. */ }
  };
  const toggle = () => {
    fields.hidden = !enable.checked;
    fields.querySelectorAll('input,select,textarea,button').forEach((field) => { field.disabled = !enable.checked || field.hasAttribute('data-unavailable') || backend === 'eleven_music' && ['candidates', 'variation'].includes(field.dataset.generation); });
    // Outside the hidden panel, so it stays visible; without generation there is nowhere to record the choice.
    pitchRoot?.querySelectorAll('select').forEach((field) => { field.disabled = !enable.checked; });
    pitchRoot?.querySelector('#pitch-repair-off')?.toggleAttribute('hidden', enable.checked);
  };
  enable.onchange = () => { toggle(); persist(); };
  toggle();
  fields.addEventListener('input', persist);
  root.querySelector('#generation-remember').onclick = () => {
    const status = root.querySelector('#generation-preference-status');
    try { localStorage.setItem(preferenceKey, JSON.stringify(read())); status.textContent = 'Remembered for new requests in this browser. You can still change each request.'; }
    catch (error) { status.textContent = error.message || 'This browser could not save preferences.'; }
  };
  root.querySelector('#generation-forget').onclick = () => {
    try { localStorage.removeItem(preferenceKey); root.querySelector('#generation-preference-status').textContent = 'Saved preferences removed. The current request keeps its choices.'; }
    catch { root.querySelector('#generation-preference-status').textContent = 'This browser could not remove saved preferences.'; }
  };
  const applyRequired = () => {
    const paid = backend === 'eleven_music';
    const [minimum, maximum] = durationRange();
    const duration = root.querySelector('#gen-duration');
    duration.max = maximum;
    duration.setAttribute('aria-describedby', 'generation-duration-hint');
    root.querySelector('#generation-duration-hint').textContent = `${minimum}–${maximum} whole seconds, or leave blank for Auto.${paid ? ' Eleven Music has a 600-second maximum.' : ''}`;
    required = voiceRequired || paid;
    if (required) enable.checked = true;
    enable.disabled = required;
    root.querySelector('#generation-enable-label').textContent = paid ? 'Use song controls with Eleven Music' : 'Use V8 generation';
    root.querySelector('#generation-mode-note').textContent = paid
      ? 'Leave length blank for Auto: usually 3–5 minutes, with occasional shorter or longer songs up to Eleven Music’s 10-minute limit. Your chosen length and cost appear before confirmation. Local variation and composition choices are unavailable.'
      : required ? 'Tony V8 and V9 use V8 song generation. Leave length blank for the song planner: aim around four minutes, normally at least two, with an exceptionally rare 19-minute maximum.'
      : 'Available with every Tony voice. Choose a new composition or a reinterpretation of a basis song.';
    for (const key of ['candidates', 'variation']) {
      const field = root.querySelector(`[data-generation="${key}"]`);
      field.closest('.generation-grid > div').hidden = paid;
    }
    toggle(); persist();
  };
  return { read, setRequired(value) { voiceRequired = Boolean(value); applyRequired(); },
    setBackend(value) { backend = value; applyRequired(); }, clear() { storage.remove(key); } };
}

export async function mountGenerationReview(root, { draft, api, escape, reload }) {
  if (!draft.generationReview || draft.generationReview.state !== 'pending') return;
  root.innerHTML = '<p role="status">Loading your generation review…</p>';
  try {
    const { review } = await api(`/prompts/${encodeURIComponent(draft.id)}/generation-review`, { role: 'submitter' });
    if (!review || review.id !== draft.generationReview.id || review.state !== 'pending') throw new Error('The review changed. Refresh status to see the latest choice.');
    const lyrics = review.kind === 'lyrics';
    const localKey = 'yehry3:lyric-review:' + review.id;
    root.innerHTML = `<section class="generation-review"><h3>${lyrics ? 'Review your lyrics' : 'Choose your composition'}</h3><p>${lyrics ? 'Edit the sheet, then approve it to begin composing. The approved sheet becomes the saved song plan.' : 'Compare the hook and ending of each composition. These previews use the draft singer; Tony voice conversion follows your choice.'}</p><form id="generation-review-form">${lyrics ? '<label for="review-lyrics">Lyric sheet</label><textarea id="review-lyrics" rows="18" maxlength="32000" required></textarea><p class="small">Keep the [End] marker. Previously locked lines must remain exactly as written.</p>' : review.payload.candidates.map((candidate) => `<fieldset class="composition-choice"><legend><label><input type="radio" name="composition" value="${candidate.index}" required> Composition ${candidate.index + 1}</label></legend>${candidate.clips.map((clip, i) => `<p class="small">${clip.label} · ${Math.round(clip.start)} seconds</p><audio controls preload="metadata" data-candidate="${candidate.index}" data-clip="${i}"></audio>`).join('')}</fieldset>`).join('')}<div class="actions"><button class="primary" type="submit">${lyrics ? 'Approve lyrics & continue' : 'Use this composition'}</button><button class="quiet" type="button" id="cancel-generation">Cancel this request</button></div><p class="field-error" role="alert"></p></form></section>`;
    const form = root.querySelector('form'), urls = [];
    if (lyrics) {
      const field = root.querySelector('#review-lyrics');
      let saved; try { saved = localStorage.getItem(localKey); } catch {}
      field.value = saved ?? review.payload.lyrics;
      if (draft.details?.lyricSheet?.mode !== 'adapt' && draft.details?.lyricSheet) {
        field.readOnly = true; field.value = review.payload.lyrics;
        field.nextElementSibling.textContent = 'This request keeps your supplied wording. Approve this sheet or cancel to start a request with different words.';
      } else field.oninput = () => { try { localStorage.setItem(localKey, field.value); } catch {} };
    } else {
      root.querySelectorAll('audio').forEach((audio) => {
        const clip = review.payload.candidates[Number(audio.dataset.candidate)].clips[Number(audio.dataset.clip)];
        const bytes = Uint8Array.from(atob(clip.audio), (c) => c.charCodeAt(0));
        audio.src = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })); urls.push(audio.src);
        audio.onplay = () => root.querySelectorAll('audio').forEach((other) => { if (other !== audio) other.pause(); });
      });
    }
    const send = async (action) => {
      form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await api(`/prompts/${encodeURIComponent(draft.id)}/generation-review`, { method: 'POST', role: 'submitter', body: {
          reviewId: review.id, version: draft.version, action,
          ...(lyrics ? { lyrics: root.querySelector('#review-lyrics').value } : { candidate: Number(new FormData(form).get('composition')) })
        } });
        try { localStorage.removeItem(localKey); } catch {}
        urls.forEach((url) => URL.revokeObjectURL(url));
        await reload();
      } catch (error) { form.querySelector('.field-error').textContent = error.message; }
      finally { form.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
    };
    form.onsubmit = (event) => { event.preventDefault(); if (form.reportValidity()) send('approve'); };
    root.querySelector('#cancel-generation').onclick = () => send('cancel');
    const cleanup = new MutationObserver(() => { if (!root.isConnected) { urls.forEach((url) => URL.revokeObjectURL(url)); cleanup.disconnect(); } });
    cleanup.observe(document.body, { childList: true, subtree: true });
  } catch (error) { root.innerHTML = `<p class="field-error">${escape(error.message)}</p>`; }
}
