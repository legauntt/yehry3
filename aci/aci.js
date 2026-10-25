import { AGENTS, SAMPLE_RECORDS, STAGES, STORAGE_KEY, freshState, restoreState, runBlocker, queueDemo, advanceDemo, today } from './model.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byId = id => AGENTS.find(agent => agent.id === id);
let state;
try { state = restoreState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = freshState(); }
let toastTimer, timer, storageWarning = false;
function announce(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch {
    if (!storageWarning) announce('Browser storage is unavailable. Preview changes will last until you leave this page.');
    storageWarning = true;
  }
}
function avatar(id) {
  const face = id === 'pancakeo'
    ? '<path d="M15 36c-5-13 34-17 35-2v14c-1 19-33 20-34 0Z" fill="#efc49d"/><path d="M12 26c0-9 42-11 43-1 7 3 6 10-1 11-12 5-35 4-43 0-5-3-5-7 1-10Z" fill="#da8b62"/><path d="M13 25c12 5 29 6 41 0M12 33c13 4 30 5 42-1m-32 9v6m17-7v6m-17 7c5 5 11 5 16 0"/>'
    : '<path d="M12 49c-5-45 47-45 45-2l-6 17H19Z" fill="#c8c1df"/><path d="m19 34 12-3m7 0 11 4m-22 4v6m15-6v6m-14 10h12"/><path d="M10 36v14m47-14v14M10 36c-3-35 49-36 48 0" stroke-width="3"/>';
  return `<svg viewBox="0 0 68 72" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${face}</svg>`;
}
function cover(art) {
  const object = art === 'moon'
    ? '<path d="M83 116V61l19-14 19 14v55m-52 0h66M93 65h19m-19 12h19m-19 12h19m-19 12h19"/><path d="M99 115v-7h8v7"/><path d="m60 76 12-9m58-20 12-9m-4 44 13 4"/><circle cx="64" cy="44" r="10"/>'
    : art === 'paper'
      ? '<path d="M75 100V69c0-17 46-19 48-1v29c0 25-48 24-48 3Zm48-25c32-16 32 25 0 17M75 81 52 60v23l24 18m2-37h45m-39-4c1-16 33-16 32 0M90 35c-12-8 10-10-1-19m17 20c-10-8 10-10 0-21"/>'
      : '<ellipse cx="103" cy="94" rx="40" ry="12"/><path d="M63 94v8c0 17 80 17 80 0v-8m-80-1v-9c0-16 80-16 80 0v10m-80-10c0 17 80 17 80 0"/><path d="m86 75 14-8 15 8-15 7-14-7ZM82 52l-7-11m28 8V33m22 21 10-11m-82 67 7-1m90 0 7 1"/>';
  return `<svg viewBox="0 0 210 150" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${object}</svg>`;
}
function renderAgents() {
  // Preserve keyboard focus when changing a switch or queueing a preview.
  const focused = document.activeElement?.id;
  $('#agent-grid').innerHTML = AGENTS.map(agent => {
    const enabled = state.enabled[agent.id], blocker = runBlocker(state, agent.id);
    const status = state.paused ? 'Studio paused' : enabled ? 'Demo ready' : 'Schedule off';
    return `<article class="agent-card" aria-labelledby="name-${agent.id}"><div class="agent-main"><div class="agent-top"><div class="agent-avatar ${agent.id}">${avatar(agent.id)}</div><div><p class="agent-code">UNDERSTUDY / ${agent.number}</p><h3 class="agent-name" id="name-${agent.id}">${agent.name}<span>spoof</span></h3><p class="agent-byline">${agent.byline}</p></div><span class="pill agent-status ${!enabled || state.paused ? 'paused' : ''}">${status}</span></div><p class="agent-description">${agent.description}</p><div class="traits">${agent.traits.map(trait => `<span class="trait">${trait}</span>`).join('')}</div><div class="agent-stats"><div><strong>${agent.count}</strong><span>source recordings</span></div><div><strong>${state.used[agent.id]} / ${state.daily}</strong><span>demo slots used</span></div><div><strong>v0</strong><span>seed profile</span></div></div><div class="agent-schedule"><div>Daily at ${escape(state.time)} Pacific<span>${enabled ? 'Automatic songs · preview schedule' : 'Automatic schedule paused'}</span></div><button type="button" class="switch" id="schedule-${agent.id}" role="switch" aria-label="Automatic schedule for ${agent.name} spoof" aria-checked="${enabled}" data-schedule="${agent.id}"></button></div></div><div class="agent-actions"><button type="button" class="text-button" data-profile="${agent.id}">Inside the profile ↗</button><button type="button" class="button" id="run-${agent.id}" data-run="${agent.id}" ${blocker ? 'disabled' : ''} title="${escape(blocker || 'Simulate a full song run. No generation or spending.')}" aria-label="Run demo for ${agent.name} spoof">${blocker.includes('allowance') ? 'Daily limit reached' : state.jobs.some(j => j.agent === agent.id) ? 'Demo in queue' : 'Run demo'} <span aria-hidden="true">→</span></button></div></article>`;
  }).join('');
  if (focused?.startsWith('schedule-')) document.getElementById(focused)?.focus();
}
function renderQueue() {
  const count = state.jobs.length;
  $('#queue-summary').textContent = count ? `${count} demo ${count === 1 ? 'song' : 'songs'} · one at a time` : 'The demo queue is empty';
  $('#queue-items').innerHTML = count ? state.jobs.map((job, i) => `<article class="queue-job"><div class="job-disc ${job.agent}" aria-hidden="true"></div><div><h3>${escape(job.title)}</h3><p>${byId(job.agent).name} spoof · simulated run</p></div><div class="job-progress">${state.paused ? 'Paused' : i ? 'Waiting its turn' : STAGES[job.stage]}<progress value="${i ? 0 : job.stage + 1}" max="5" aria-label="Demo progress for ${escape(job.title)}"></progress></div><button type="button" class="small-button" data-cancel="${escape(job.id)}" aria-label="Cancel demo for ${byId(job.agent).name} spoof">Cancel</button></article>`).join('')
    : '<div class="queue-empty"><span aria-hidden="true">◎</span><div><h3>Quiet in here. For now.</h3><p>Run a demo from either agent to follow an idea all the way to the record shelf.</p></div></div>';
}
function renderRecords() {
  const filter = $('#record-filter').value;
  const records = [...state.records, ...SAMPLE_RECORDS].filter(record => filter === 'all' || record.agent === filter);
  $('#records-empty').hidden = records.length > 0;
  $('#record-grid').innerHTML = records.map((record, i) => `<article class="record"><div class="record-cover ${record.art}"><span class="record-kind">${record.sample ? 'EXAMPLE SLEEVE' : 'SIMULATED RELEASE'}</span>${cover(record.art)}<span class="record-edition">ACI / ${String(i + 1).padStart(3, '0')}</span></div><p class="record-meta">${byId(record.agent).name} spoof · Tony C concept</p><h3>${escape(record.title)}</h3><p class="record-description">${escape(record.style)}</p><div class="record-bottom"><span>Audio not generated</span><button type="button" class="text-button" data-record="${escape(record.id)}">Read the prompt ↗</button></div></article>`).join('');
}
function render() {
  $('#studio-status').textContent = state.paused ? 'Demo studio paused' : 'Demo studio ready';
  $('#pause-all').textContent = state.paused ? 'Resume studio' : 'Pause studio';
  $('#allowance').textContent = `${Object.values(state.used).reduce((a, b) => a + b, 0)} / ${state.daily * AGENTS.length}`;
  $('#spend-limit').textContent = `$${state.budget}`;
  renderAgents(); renderQueue(); renderRecords();
}
function detail(eyebrow, html) {
  $('#dialog-eyebrow').textContent = eyebrow;
  $('#dialog-body').innerHTML = html;
  $('#detail-dialog').showModal();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
  const { profile, schedule, run, cancel, record } = button.dataset;
  if (profile) {
    const agent = byId(profile);
    detail(`UNDERSTUDY ${agent.number} / SEED PROFILE`, `<h2 id="dialog-title">Inside ${agent.name} spoof.</h2><p>${agent.description}</p><div class="dialog-chips">${agent.traits.map(trait => `<span class="trait">${trait}</span>`).join('')}</div><h3>A starting direction</h3><ul>${agent.rules.map(rule => `<li>${rule}</li>`).join('')}</ul><h3>The source shelf</h3><p>${agent.count} recordings and ${agent.ideas} distinct saved idea texts were found under this author label in the September 25 catalog snapshot. These are available examples, not a trained model or a verified author identity.</p><h3>How it would learn</h3><p>Curate the original briefs, reduce remix duplicates, and save a versioned profile with selected examples. These traits are proposed starting points. Human feedback can refine them; generated songs stay separate from the human source material.</p>`);
  } else if (schedule) {
    state.enabled[schedule] = !state.enabled[schedule]; save(); renderAgents();
    if (!storageWarning) announce(`${byId(schedule).name} spoof’s preview schedule is ${state.enabled[schedule] ? 'on' : 'off'}. No real schedule is running.`);
  } else if (run) {
    if (queueDemo(state, run)) { save(); render(); announce('Demo queued. Watch it move through the stages; no audio or spending is involved.'); $('#queue-summary').tabIndex = -1; $('#queue-summary').focus({ preventScroll: true }); }
  } else if (cancel) {
    state.jobs = state.jobs.filter(job => job.id !== cancel); save(); render(); announce('Demo canceled. Its daily slot stays used, just as a started attempt would.'); $('#queue-summary').tabIndex = -1; $('#queue-summary').focus({ preventScroll: true });
  } else if (record) {
    const item = [...state.records, ...SAMPLE_RECORDS].find(item => item.id === record);
    detail(`${byId(item.agent).name.toUpperCase()} SPOOF / ${item.sample ? 'EXAMPLE' : 'SIMULATED RELEASE'}`, `<h2 id="dialog-title">${escape(item.title)}</h2><blockquote>${escape(item.prompt)}</blockquote><p>This is authored demo text, not an agent-generated prompt. A connected run would retain its original brief, profile version, lyrics, checks, and recording here.</p><div class="settings-note"><strong>No recording yet</strong><p>This ${item.sample ? 'example sleeve' : 'simulated run'} has no audio. No production request was created.</p></div>`);
  }
});
$('#pause-all').addEventListener('click', () => { state.paused = !state.paused; save(); render(); announce(state.paused ? 'Demo studio paused. In-progress previews are held.' : 'Demo studio resumed.'); });
$('#how-it-works').addEventListener('click', () => detail('THE PLAN / FROM INSTINCT TO RECORD', '<h2 id="dialog-title">A studio with a curfew.</h2><ol><li><strong>Learn the tendencies.</strong> Build a profile from curated author briefs and selected examples.</li><li><strong>Take the initiative.</strong> Within a daily allowance, invent a new prompt and turn it into lyrics and a musical plan.</li><li><strong>Make the record.</strong> Render the band and Tony’s voice, run bounded checks, and publish to the ACI shelf.</li><li><strong>Know when to stop.</strong> Keep its own queue and budget. Pause when an allowance is exhausted or a job needs attention.</li></ol><div class="settings-note"><strong>This page is a rehearsal.</strong><p>The demo uses authored examples and a short stage animation. No model, worker, provider, or production API is connected. Schedules do not run automatically.</p></div>'));
$('#open-limits').addEventListener('click', () => {
  $('#daily-limit').value = state.daily; $('#budget-limit').value = state.budget; $('#run-time').value = state.time;
  $('#limits-dialog').showModal();
});
$('#limits-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  state.daily = Number($('#daily-limit').value); state.budget = Number($('#budget-limit').value); state.time = $('#run-time').value;
  save(); render(); $('#limits-dialog').close();
  if (!storageWarning) announce('Preview settings saved in this browser.');
});
$('#record-filter').addEventListener('change', renderRecords);
$('#reset-preview').addEventListener('click', () => {
  detail('DEMO PREVIEW / START AGAIN', '<h2 id="dialog-title">Reset this rehearsal?</h2><p>This clears demo runs, simulated releases, and preview settings in this browser. The three example sleeves stay.</p><button type="button" class="button primary" id="confirm-reset">Reset preview data</button>');
  $('#confirm-reset').addEventListener('click', () => { state = freshState(); save(); $('#record-filter').value = 'all'; render(); $('#detail-dialog').close(); announce('Preview reset. Ready for a fresh rehearsal.'); });
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
function themeLabel() { $('#theme').setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? 'Use light theme' : 'Use dark theme'); }
$('#theme').addEventListener('click', () => { window.yehry3Theme?.setDark(!window.yehry3Theme.isDark()); themeLabel(); });
window.addEventListener('yehry3:theme', themeLabel);
function tick() {
  if (document.hidden || document.querySelector('dialog[open]')) return;
  if (state.day !== today()) { state = restoreState(state); save(); render(); }
  if (state.paused || !state.jobs.length) return;
  const released = advanceDemo(state);
  save(); renderQueue();
  if (released) { renderAgents(); renderRecords(); announce(`Demo complete: “${released.title}” is on the ACI shelf. No audio was generated.`); }
}
function startTimer() { clearInterval(timer); timer = setInterval(tick, 1800); }
window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(toastTimer); });
window.addEventListener('pageshow', startTimer);
render(); themeLabel(); startTimer();
