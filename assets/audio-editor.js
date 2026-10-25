import { api, signedIn } from './api.js';
import { player } from './player.js';
import { currentScope } from './page-scope.js';
import { editSettings, peaks, fadeGain, timeLabel } from './audio-edit-model.js';

export async function openAudioEditor(song) {
  if (!signedIn('admin') || document.querySelector('.audio-editor')) return;
  if (!document.querySelector('link[data-audio-editor]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/assets/audio-editor.css'; link.dataset.audioEditor = ''; document.head.append(link);
  }
  const focus = document.activeElement, controller = new AbortController();
  const dialog = document.createElement('dialog'); dialog.className = 'audio-editor'; dialog.setAttribute('aria-labelledby', 'audio-editor-title');
  dialog.innerHTML = `<div class="ae-heading"><div><p class="eyebrow">ADMIN · AUDIO EDITOR</p><h2 id="audio-editor-title"></h2></div><button type="button" class="quiet" data-close aria-label="Close audio editor">Close ×</button></div>
    <p>Choose a new ending and fade. Every save creates a separate MP3; the full original stays available. Processing runs while the studio PC is online.</p>
    <p data-status role="status">Loading the original recording…</p>
    <fieldset disabled data-controls><legend class="sr-only">Trim and preview</legend>
      <div class="ae-wave"><canvas width="1200" height="210" tabindex="0" role="slider" aria-label="Waveform playhead" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></canvas></div>
      <div class="ae-legend"><span>▰ Waveform</span><span class="ae-vocals">▰ Estimated vocals</span><span class="ae-fade">◢ Fade out</span><span class="ae-removed">▰ Cropped away</span></div>
      <p class="small" data-analysis role="status">Finding vocal sections…</p>
      <button type="button" class="quiet" data-analyze>Recheck vocals</button>
      <div class="ae-transport"><button type="button" class="quiet" data-play>Play from cursor</button><button type="button" class="quiet" data-preview>Preview ending</button><button type="button" class="quiet" data-stop>Stop</button><output data-time>0:00.0</output><button type="button" class="quiet" data-cut>End at cursor</button></div>
      <label class="ae-end">Crop end <input type="range" min="1" max="1" step="0.1" value="1" data-end-range></label>
      <div class="ae-fields"><label>End time (seconds)<input type="number" min="1" step="0.1" data-end required></label><label>Fade out (seconds)<input type="number" min="0" max="60" step="0.1" value="5" data-fade required></label><p data-summary></p></div>
      <label class="ae-default"><input type="checkbox" data-default checked> Use this edit as the default recording</label>
      <button type="button" class="primary" data-save>Save edited MP3</button>
    </fieldset>
    <section class="ae-versions" aria-label="Saved recordings"><h3>Saved recordings</h3><div data-versions></div></section>`;
  dialog.querySelector('h2').textContent = song.title;
  document.body.append(dialog); dialog.showModal();
  const $ = query => dialog.querySelector(query), status = $('[data-status]'), canvas = $('canvas'), ctx = canvas.getContext('2d');
  const endpoint = `/admin/songs/${encodeURIComponent(song.id)}/audio-editor`;
  let closed = false, context, buffer, waveform, state, cursor = 0, source, gainNode, frame, poll, startedAt, playOffset, playEnd, requestId, saving = false, playSequence = 0;
  const scope = currentScope();
  const notify = message => { if (!closed) status.textContent = message; };
  const settings = () => editSettings(Number($('[data-end]').value), Number($('[data-fade]').value), Math.min(buffer.duration, state.source.duration));
  function stop() {
    playSequence++;
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
    gainNode?.disconnect(); gainNode = null;
    cancelAnimationFrame(frame); frame = null;
  }
  function draw() {
    if (!buffer || closed) return;
    const width = canvas.width, height = canvas.height, duration = buffer.duration, end = Number($('[data-end]').value), fade = Number($('[data-fade]').value);
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#11121d'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#16483f';
    for (const [start, finish] of state.analysis?.regions || []) ctx.fillRect(start / duration * width, 0, (finish - start) / duration * width, height);
    ctx.fillStyle = '#bcb4f5';
    waveform.forEach((amplitude, index) => { const h = Math.max(2, amplitude * height * .9); ctx.fillRect(index / waveform.length * width, (height - h) / 2, 1.2, h); });
    ctx.fillStyle = '#03040bcc'; ctx.fillRect(end / duration * width, 0, width, height);
    ctx.fillStyle = '#ffc97955'; ctx.beginPath(); ctx.moveTo((end - fade) / duration * width, 0); ctx.lineTo(end / duration * width, height); ctx.lineTo(end / duration * width, 0); ctx.fill();
    ctx.strokeStyle = '#ffcc82'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(end / duration * width, 0); ctx.lineTo(end / duration * width, height); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cursor / duration * width, 0); ctx.lineTo(cursor / duration * width, height); ctx.stroke();
    canvas.setAttribute('aria-valuenow', cursor.toFixed(1)); canvas.setAttribute('aria-valuetext', timeLabel(cursor));
    $('[data-time]').textContent = `${timeLabel(cursor)} / ${timeLabel(duration)}`;
    $('[data-summary]').textContent = `${timeLabel(end)} kept · ${timeLabel(Math.max(0, duration - end))} removed`;
  }
  function tick() {
    if (!source) return;
    cursor = Math.min(playEnd, playOffset + context.currentTime - startedAt); draw(); frame = requestAnimationFrame(tick);
  }
  async function play(preview) {
    try {
      const { end, fade } = settings(); stop(); const sequence = playSequence; player.pause(); await context.resume();
      if (closed || sequence !== playSequence) return;
      playOffset = preview ? Math.max(0, end - Math.max(12, fade + 4)) : Math.min(cursor, buffer.duration - .01);
      playEnd = preview ? end : buffer.duration; cursor = playOffset; startedAt = context.currentTime;
      const node = context.createBufferSource(), gain = context.createGain(); node.buffer = buffer; node.connect(gain); gain.connect(context.destination);
      gainNode = gain;
      if (preview && fade) { gain.gain.setValueAtTime(fadeGain(playOffset, end, fade), startedAt); gain.gain.setValueAtTime(1, startedAt + Math.max(0, end - fade - playOffset)); gain.gain.linearRampToValueAtTime(0, startedAt + end - playOffset); }
      node.onended = () => { if (source === node) { cursor = playEnd; stop(); draw(); } gain.disconnect(); };
      source = node; node.start(0, playOffset, playEnd - playOffset); tick();
    } catch (error) { notify(error.message); }
  }
  function seek(value) { stop(); cursor = Math.max(0, Math.min(buffer?.duration || 0, value)); draw(); }
  function validate() { draw(); const busy = saving || state.jobs.some(row => ['working', 'queued'].includes(row.state)); $('[data-analyze]').disabled = busy || !state.online; try { settings(); $('[data-save]').disabled = busy; } catch { $('[data-save]').disabled = true; } }
  function changed() { stop(); requestId = null; validate(); }
  function versions() {
    const root = $('[data-versions]'); root.replaceChildren();
    const rows = [{ id: null, url: state.source.url, duration: state.source.duration }, ...state.edits];
    rows.forEach((row, i) => {
      const line = document.createElement('div'); line.className = 'ae-version';
      const link = document.createElement('a'); link.className = 'text-link'; link.href = row.url; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = `${i ? `Edit ${i}` : 'Original'} · ${timeLabel(row.duration)}${i ? ` · ${row.fade}s fade` : ''} ↗`;
      const button = document.createElement('button'); button.className = 'quiet'; button.type = 'button'; button.textContent = state.defaultEditId === row.id ? 'Default recording' : 'Use as default'; button.disabled = state.defaultEditId === row.id;
      button.onclick = async () => { button.disabled = true; try { await api(endpoint, { role: 'admin', method: 'PATCH', body: { editId: row.id } }); notify('Default recording updated. It will be used the next time the song starts.'); dispatchEvent(new CustomEvent('yehry3:audio-edit', { detail: { id: song.id } })); await refresh(); } catch (error) { notify(error.message); button.disabled = false; } };
      line.append(link, button); root.append(line);
    });
  }
  async function refresh() {
    const next = await api(endpoint, { role: 'admin', signal: controller.signal });
    if (closed) return;
    if (state && state.source.url !== next.source.url) throw new Error('The original recording changed. Close and reopen the editor.');
    const previous = state; state = next;
    versions();
    const method = state.analysis?.method;
    $('[data-analysis]').textContent = method === 'isolated-vocals' ? 'Estimated vocals from the isolated vocal stem. Quiet singing or instrument bleed can affect detection.' : method === 'transcript' ? 'Estimated vocal sections from audio transcription. Timing and missing words can affect detection.' : method === 'unavailable' ? 'Vocal detection is unavailable for this recording. You can still trim and preview by ear.' : state.online ? 'Detecting vocal sections…' : 'Vocal markers are unavailable while the studio PC is offline. You can still queue an edit.';
    const active = state.jobs.find(row => ['queued', 'working'].includes(row.state));
    if (active) notify(active.kind === 'analyze' ? state.online ? 'Detecting vocal sections…' : 'Vocal analysis queued. It will run when the studio PC is online.' : state.online ? 'Creating and verifying the edited MP3… You can close this editor and return later.' : 'Edit queued. It will be created when the studio PC is online.');
    else if (previous?.jobs.some(row => ['queued', 'working'].includes(row.state))) {
      const finished = state.jobs[0];
      if (finished?.state === 'ready' && finished.kind === 'render') dispatchEvent(new CustomEvent('yehry3:audio-edit', { detail: { id: song.id } }));
      notify(finished?.state === 'failed' ? 'Audio processing could not finish. Your original is safe. Try again.' : finished?.kind === 'render' ? 'Edited MP3 saved. Open it under Saved recordings.' : 'Ready. Select a point on the waveform to listen or choose an ending.');
    }
    if (buffer) validate();
    clearTimeout(poll);
    if (active) poll = setTimeout(pollState, 3000);
  }
  async function pollState() { if (closed) return; try { await refresh(); } catch (error) { notify(error.message); if (!closed) poll = setTimeout(pollState, 8000); } }
  async function queue(kind) {
    const body = { requestId: kind === 'render' ? requestId ||= crypto.randomUUID() : crypto.randomUUID(), sourceUrl: state.source.url, kind, ...(kind === 'render' ? { ...settings(), makeDefault: $('[data-default]').checked } : {}) };
    saving = true; $('[data-save]').disabled = true;
    try { await api(endpoint, { role: 'admin', method: 'POST', body, signal: controller.signal }); requestId = null; await refresh(); }
    finally { saving = false; if (!closed && buffer) validate(); }
  }
  function close() { if (closed) return; closed = true; stop(); clearTimeout(poll); controller.abort(); context?.close().catch(() => {}); dialog.remove(); buffer = null; waveform = null; if (focus?.isConnected) focus.focus(); }
  $('[data-close]').onclick = () => dialog.close(); dialog.addEventListener('close', close); scope.onLeave(close);
  $('[data-play]').onclick = () => play(false); $('[data-preview]').onclick = () => play(true); $('[data-stop]').onclick = stop;
  canvas.addEventListener('pointerdown', event => { if (!buffer) return; const box = canvas.getBoundingClientRect(); seek((event.clientX - box.left) / box.width * buffer.duration); });
  canvas.addEventListener('keydown', event => { if (!buffer || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); seek(event.key === 'Home' ? 0 : event.key === 'End' ? buffer.duration : cursor + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)); });
  $('[data-cut]').onclick = () => { $('[data-end]').value = Math.max(1, Math.floor(Math.min(cursor, state.source.duration) * 10) / 10); $('[data-end-range]').value = $('[data-end]').value; changed(); };
  $('[data-end-range]').oninput = () => { $('[data-end]').value = $('[data-end-range]').value; changed(); };
  $('[data-end]').oninput = () => { $('[data-end-range]').value = $('[data-end]').value; changed(); };
  $('[data-fade]').oninput = changed; $('[data-default]').onchange = () => { requestId = null; };
  $('[data-save]').onclick = () => queue('render').catch(error => notify(error.message));
  $('[data-analyze]').onclick = () => queue('analyze').catch(error => notify(error.message));
  try {
    await refresh(); if (closed) return;
    if (!state.supported) throw new Error('This recording is not available in the audio editor.');
    const bytes = await api(`/admin/songs/${encodeURIComponent(song.id)}/audio-source`, { role: 'admin', binary: true, timeout: 120000, signal: controller.signal });
    if (closed) return;
    context = new AudioContext({ sampleRate: 24000 }); buffer = await context.decodeAudioData(bytes);
    if (closed) return;
    if (Math.abs(buffer.duration - state.source.duration) > 2) throw new Error('The audio duration changed. Reopen the editor after the recording is updated.');
    waveform = peaks(buffer);
    const duration = Math.floor(Math.min(buffer.duration, state.source.duration) * 10) / 10;
    $('[data-end]').max = $('[data-end-range]').max = duration; $('[data-end]').value = $('[data-end-range]').value = duration; $('[data-fade]').value = Math.min(5, duration);
    canvas.setAttribute('aria-valuemax', buffer.duration.toFixed(1)); $('[data-controls]').disabled = false; draw(); changed();
    if (!state.jobs.some(row => ['queued', 'working'].includes(row.state))) notify('Ready. Select a point on the waveform to listen or choose an ending.');
    if (!state.analysis && state.online && !state.jobs.some(row => ['queued', 'working'].includes(row.state))) await queue('analyze');
  } catch (error) { notify(error.message); }
}
