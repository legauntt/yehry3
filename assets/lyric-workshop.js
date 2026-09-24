import { lyricError, wordCount } from './request-materials.js';

const MAX = 12000;
const actions = [['funnier', 'Funnier'], ['heartfelt', 'More heartfelt'], ['darker', 'Darker'], ['hook', 'Stronger hook'], ['simpler', 'Easier to sing'], ['rhymes', 'Tighter rhymes']];
const active = state => ['queued', 'working'].includes(state);

export function mountLyricWorkshop(root, { draft, materials, api, storage, escape, context, scope }) {
  const key = 'lyric-workshop:' + draft.id;
  let saved;
  try { saved = JSON.parse(storage.get(key)); } catch { /* Keep working with the current sheet. */ }
  const original = materials.getLyrics();
  let state = saved?.v === 1 && typeof saved.lyrics === 'string' && Array.isArray(saved.versions)
    ? saved : { v: 1, lyrics: original, base: original, instruction: '', versions: [], pending: null };
  for (const version of state.versions) version.id ||= crypto.randomUUID();
  state.currentVersion ||= state.versions.findLast(version => version.lyrics === state.lyrics)?.id;
  const idea = draft.prompt;
  const shortIdea = idea.length > 420 ? idea.slice(0, 420).replace(/\s+\S*$/, '') + '…' : idea;
  let available = false, timer, destroyed = false, polling = false, opener;
  root.innerHTML = `<section class="lyric-workshop-entry"><div><p class="eyebrow">Words before music</p><h3>Shape the lyrics</h3><p>Generate a first draft from your song idea, give it a nudge, and choose the words you want Tony to sing.</p></div><button type="button" class="quiet" data-workshop-open aria-haspopup="dialog">Open lyric workshop</button><p class="small" data-workshop-summary>Optional. Your song enters the queue only after final confirmation.</p></section>
    <dialog class="lyric-workshop" aria-labelledby="lyric-workshop-title" aria-describedby="lyric-workshop-intro">
      <header class="lyric-workshop-header"><div><p class="eyebrow">Draft · edit · make it yours</p><h2 id="lyric-workshop-title">Lyric workshop</h2></div><button type="button" class="quiet" data-workshop-close aria-label="Close lyric workshop">Close</button></header>
      <p id="lyric-workshop-intro">Guide the words, edit any line, or try a different direction. Only <strong>Use these lyrics</strong> adds this draft to your song.</p>
      <section class="workshop-idea" aria-labelledby="workshop-idea-title"><h3 id="workshop-idea-title">Your song idea</h3><p id="workshop-idea-text">${escape(shortIdea)}</p><button type="button" class="text-link" data-workshop-idea-toggle aria-expanded="false" aria-controls="workshop-idea-text" ${idea === shortIdea ? 'hidden' : ''}>Show more</button></section>
      <p class="small" data-workshop-availability role="status"></p><button type="button" class="text-link" data-workshop-check hidden>Check writer again</button>
      <div class="workshop-progress" data-workshop-progress hidden><div class="workshop-hat-track" aria-hidden="true"><span class="workshop-hat-travel"><svg class="workshop-hat" viewBox="0 0 100 80" focusable="false"><path class="hat-brim" d="M12 53 Q45 42 92 55 Q96 61 80 65 L22 64 Z"/><path class="hat-crown" d="M13 53 Q11 23 43 19 Q70 15 84 51 L68 59 L25 59 Z"/><path class="hat-seam" d="M43 20 Q57 32 58 56 M20 51 Q47 59 80 50"/><path class="hat-band" d="M21 55 Q46 63 73 55 L69 62 Q46 69 24 61 Z"/></svg></span></div><p class="workshop-progress-title">Tony’s hat is chasing a rhyme…</p></div>
      <p class="small workshop-status" data-workshop-status role="status" aria-live="polite"></p>
      <div class="lyric-workshop-grid"><section class="workshop-guidance">
        <label for="workshop-direction">Extra lyric guidance <span class="small">(optional)</span></label><textarea id="workshop-direction" rows="4" maxlength="1000" aria-describedby="workshop-guidance-help" placeholder="Add a twist, a mood, or a phrase to keep—or leave this blank."></textarea>
        <p class="small" id="workshop-guidance-help">Leave this blank and click Generate lyrics. Your song idea, direction, and song choices guide the first draft.</p>
        <button type="button" class="primary" data-workshop-generate>Generate lyrics</button>
        <fieldset class="workshop-nudges"><legend>Give this draft a nudge</legend>${actions.map(([id, label]) => `<button type="button" class="quiet" data-lyric-action="${id}">${label}</button>`).join('')}</fieldset>
        <p class="field-error" data-workshop-error role="alert"></p>
        <div class="actions"><button type="button" class="quiet" data-workshop-retry hidden>Retry connection</button><button type="button" class="quiet" data-workshop-stop hidden>Stop writing</button></div>
      </section><section class="workshop-sheet">
        <div class="workshop-sheet-heading"><label for="workshop-lyrics">Your lyric draft</label><span class="small" data-workshop-count></span></div>
        <textarea id="workshop-lyrics" rows="17" maxlength="12000" spellcheck="true" placeholder="Click Generate lyrics for a first draft from your song idea. You can also write or paste your own." aria-describedby="workshop-sheet-help"></textarea>
        <p id="workshop-sheet-help" class="small">Edit directly. Keep line breaks and any section labels.</p>
        <label for="workshop-version">Version history</label><select id="workshop-version" aria-describedby="workshop-version-prompt"></select>
        <div class="workshop-version-context"><strong class="small">Prompt for this version</strong><p class="small" id="workshop-version-prompt"></p></div>
      </section></div>
      <footer class="lyric-workshop-footer"><p class="small" data-workshop-storage></p><p class="small">Your chosen words will be saved as “Keep my wording.” You can change that in Lyrics &amp; references. Confirmed lyrics become public with the request.</p><button type="button" class="primary" data-workshop-use>Use these lyrics</button><button type="button" class="quiet" data-workshop-close>Keep draft &amp; close</button></footer>
    </dialog>`;
  const find = selector => root.querySelector(selector), dialog = find('dialog');
  const sheet = find('#workshop-lyrics'), instruction = find('#workshop-direction'), versions = find('#workshop-version');
  const error = find('[data-workshop-error]'), status = find('[data-workshop-status]');
  const busy = () => Boolean(state.pending);
  const alive = () => !destroyed && root.isConnected && !scope.left;
  function remember() {
    const serialized = JSON.stringify(state);
    storage.set(key, serialized);
    find('[data-workshop-storage]').textContent = storage.get(key) === serialized
      ? 'Draft and the last 8 versions are saved in this browser tab.'
      : 'This browser could not save your draft. Copy your words before closing this page.';
  }
  function snapshot(lyrics, label, prompt = null) {
    if (!lyrics.trim()) return;
    // A fresh model response owns its prompt even when its text matches an older version.
    if (prompt === null && state.versions.some(version => version.id === state.currentVersion && version.lyrics === lyrics)) return;
    const version = { id: crypto.randomUUID(), lyrics, label, prompt: prompt ?? 'Edited by you. No writing prompt.' };
    state.versions.push(version);
    state.versions = state.versions.slice(-8);
    state.currentVersion = version.id;
  }
  function revisionPrompt(body) {
    const action = actions.find(([id]) => id === body.action)?.[1];
    return [action ? action + '.' : '', body.instruction].filter(Boolean).join('\n\n');
  }
  function paint() {
    if (sheet.value !== state.lyrics) sheet.value = state.lyrics;
    if (instruction.value !== state.instruction) instruction.value = state.instruction;
    sheet.readOnly = busy(); instruction.disabled = busy();
    sheet.setAttribute('aria-busy', String(busy()));
    find('[data-workshop-progress]').hidden = !busy();
    find('[data-workshop-count]').textContent = wordCount(state.lyrics) + ' words';
    const generate = find('[data-workshop-generate]');
    find('#workshop-guidance-help').textContent = state.lyrics.trim()
      ? 'Leave this blank to polish the current lyrics. Add a lyrics-only direction to change the story, mood, or wording.'
      : 'Leave this blank and click Generate lyrics. Your song idea, direction, and song choices guide the first draft.';
    generate.textContent = busy() ? 'Writing…' : state.lyrics.trim() ? 'Revise lyrics' : 'Generate lyrics';
    generate.disabled = busy() || !available;
    for (const button of root.querySelectorAll('[data-lyric-action]')) button.disabled = busy() || !available || !state.lyrics.trim();
    find('[data-workshop-stop]').hidden = !busy();
    find('[data-workshop-use]').disabled = busy() || !state.lyrics.trim() || Boolean(lyricError(state.lyrics)) || state.lyrics.length > MAX;
    versions.innerHTML = '<option value="">Current edits</option>' + state.versions.map((version, index) => `<option value="${version.id}">${index + 1}. ${escape(version.label)}${version.prompt ? ' — ' + escape(version.prompt.replace(/\s+/g, ' ').slice(0, 65)) : ''}</option>`).join('');
    versions.disabled = busy() || !state.versions.length;
    const selected = state.versions.find(version => version.id === state.currentVersion && version.lyrics === state.lyrics);
    versions.value = selected?.id || '';
    find('#workshop-version-prompt').textContent = selected
      ? selected.prompt || 'The prompt was not saved for this older version.'
      : 'Your current words. Generate or revise to save a version with its prompt.';
  }
  async function check() {
    find('[data-workshop-check]').hidden = true;
    try {
      const data = await api('/lyric-workshop', { role: 'submitter' });
      if (!alive()) return;
      available = data.version === 1 && data.available;
      find('[data-workshop-availability]').textContent = available ? 'The lyric writer is ready.' : 'The lyric writer is offline. You can edit or use your saved words and try writing later.';
    } catch {
      if (!alive()) return;
      available = false;
      find('[data-workshop-availability]').textContent = 'Could not reach the lyric writer. Your saved words are still editable.';
    }
    find('[data-workshop-check]').hidden = available; paint();
  }
  function receive(job) {
    if (active(job.state)) {
      state.pending.jobId = job.id;
      status.textContent = job.state === 'queued' ? 'Waiting for the lyric writer… You can close this window and return.'
        : job.phase === 'writing' ? 'Writing your lyrics… Your previous draft is safe.' : 'Checking that this request is about lyrics…';
      remember(); paint(); return;
    }
    const request = state.pending?.body;
    state.pending = null;
    find('[data-workshop-retry]').hidden = true;
    if (job.state === 'ready' && typeof job.lyrics === 'string' && !lyricError(job.lyrics) && job.lyrics.length <= MAX) {
      snapshot(state.lyrics, 'Before this revision');
      state.lyrics = job.lyrics;
      snapshot(job.lyrics, actions.find(([id]) => id === request?.action)?.[1] || (request?.lyrics?.trim() ? 'Custom revision' : 'First draft'),
        request ? revisionPrompt(request) : 'The prompt was not saved for this older version.');
      state.instruction = '';
      status.textContent = 'Draft ready. Edit a line, try a nudge, or use these lyrics.';
      error.textContent = '';
    } else {
      status.textContent = '';
      error.textContent = job.message || 'The writer could not finish this draft. Your previous words are unchanged.';
    }
    remember(); paint();
  }
  async function poll() {
    clearTimeout(timer);
    if (!alive() || !dialog.open || !state.pending || polling) return;
    polling = true;
    try {
      const data = state.pending.jobId
        ? await api('/lyric-workshop/' + encodeURIComponent(state.pending.jobId), { role: 'submitter' })
        : await api('/lyric-workshop', { method: 'POST', role: 'submitter', body: state.pending.body });
      if (!alive()) return;
      receive(data.job);
      error.textContent = active(data.job.state) ? '' : error.textContent;
      find('[data-workshop-retry]').hidden = true;
      if (state.pending && dialog.open) timer = setTimeout(poll, 1500);
    } catch (failure) {
      if (!alive()) return;
      if (failure.status === 404 || (!state.pending?.jobId && [400, 403, 409, 429, 503].includes(failure.status))) {
        state.pending = null; remember(); paint();
      }
      error.textContent = failure.message;
      find('[data-workshop-retry]').hidden = !state.pending;
    } finally { polling = false; }
  }
  async function generate(action = 'custom') {
    if (busy() || !available) return;
    error.textContent = '';
    if (state.lyrics.length > MAX || lyricError(state.lyrics)) { error.textContent = 'The workshop accepts up to 12,000 characters of lyrics. Shorten this draft first.'; return; }
    snapshot(state.lyrics, 'Your edited draft');
    let songContext;
    try { songContext = context(); } catch (failure) { error.textContent = failure.message; return; }
    const direction = state.instruction.trim() || (state.lyrics.trim() ? 'Polish these lyrics while keeping their story and memorable phrases.' : 'Write a first lyric draft from my song idea and all supplied song preferences.');
    state.pending = { body: { requestId: crypto.randomUUID(), draftId: draft.id, action,
      instruction: action === 'custom' ? direction : state.instruction.trim(), lyrics: state.lyrics, ...songContext }, jobId: null };
    status.textContent = 'Sending your lyric direction…'; remember(); paint();
    find('[data-workshop-progress]').scrollIntoView({ block: 'nearest' });
    await poll();
  }
  find('[data-workshop-open]').onclick = async event => {
    opener = event.currentTarget;
    // A sheet changed outside the workshop becomes the new editing starting point.
    const current = materials.getLyrics();
    if (!busy() && current !== state.base) {
      snapshot(state.lyrics, 'Earlier workshop draft'); state.lyrics = current; state.base = current;
    }
    dialog.showModal(); paint(); remember(); instruction.focus({ preventScroll: true }); dialog.scrollTop = 0;
    void check(); void poll();
  };
  for (const button of root.querySelectorAll('[data-workshop-close]')) button.onclick = () => dialog.close();
  dialog.addEventListener('close', () => { clearTimeout(timer); remember(); opener?.focus(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  sheet.oninput = () => { state.lyrics = sheet.value; remember(); paint(); };
  instruction.oninput = () => { state.instruction = instruction.value; remember(); };
  find('[data-workshop-idea-toggle]').onclick = event => {
    const expanded = event.currentTarget.getAttribute('aria-expanded') !== 'true';
    event.currentTarget.setAttribute('aria-expanded', String(expanded));
    event.currentTarget.textContent = expanded ? 'Show less' : 'Show more';
    find('#workshop-idea-text').textContent = expanded ? idea : shortIdea;
  };
  versions.onchange = () => {
    const selected = state.versions.find(version => version.id === versions.value);
    if (!selected) { paint(); return; }
    snapshot(state.lyrics, 'Your edited draft');
    // Saving current edits must not evict the older version being restored.
    if (!state.versions.some(version => version.id === selected.id)) state.versions.splice(0, 1, selected);
    state.lyrics = selected.lyrics; state.currentVersion = selected.id; remember(); paint();
  };
  find('[data-workshop-generate]').onclick = () => generate();
  for (const button of root.querySelectorAll('[data-lyric-action]')) button.onclick = () => generate(button.dataset.lyricAction);
  find('[data-workshop-retry]').onclick = () => { error.textContent = ''; void poll(); };
  find('[data-workshop-check]').onclick = check;
  find('[data-workshop-stop]').onclick = async () => {
    const pending = state.pending;
    if (!pending || polling) return;
    try {
      // Resolve an uncertain POST by its stable request ID before canceling it.
      if (!pending.jobId) pending.jobId = (await api('/lyric-workshop', { method: 'POST', role: 'submitter', body: pending.body })).job.id;
      const { job } = await api('/lyric-workshop/' + encodeURIComponent(pending.jobId), { method: 'DELETE', role: 'submitter' });
      if (alive()) receive(job);
    } catch (failure) { if (alive()) error.textContent = failure.message; }
  };
  find('[data-workshop-use]').onclick = () => {
    if (busy() || !state.lyrics.trim() || lyricError(state.lyrics) || state.lyrics.length > MAX) return;
    materials.setLyrics(state.lyrics);
    state.base = materials.getLyrics();
    snapshot(state.lyrics, 'Chosen for your song'); remember();
    find('[data-workshop-summary]').textContent = 'Chosen lyrics: ' + wordCount(state.base) + ' words · Keep my wording. Review the request when you’re ready.';
    dialog.close();
  };
  function destroy() { destroyed = true; clearTimeout(timer); if (dialog.open) dialog.close(); }
  scope.onLeave(destroy);
  paint();
  return { destroy };
}
