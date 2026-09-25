import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { freshState, restoreState, queueDemo, advanceDemo, runBlocker, STAGES } from '../aci/model.js';

test('demo admissions share daily limits, preserve canceled attempts, and release only to demo state', () => {
  const state = freshState();
  assert.equal(queueDemo(state, 'unknown'), false);
  assert.equal(queueDemo(state, 'pancakeo'), true);
  assert.equal(queueDemo(state, 'pancakeo'), false);
  assert.equal(queueDemo(state, 'scythe'), true);
  assert.equal(state.jobs.length, 2);
  state.paused = true;
  assert.equal(advanceDemo(state), null);
  assert.equal(state.jobs[0].stage, 0);
  state.paused = false;
  for (let i = 0; i < STAGES.length; i++) advanceDemo(state);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].agent, 'pancakeo');
  assert.equal(state.records[0].url, undefined);
  assert.equal(state.jobs[0].agent, 'scythe');
  assert.equal(state.jobs[0].stage, 0);
  state.jobs = [];
  assert.match(runBlocker(state, 'scythe'), /allowance/);
  state.daily = 2;
  state.budget = 0;
  assert.equal(queueDemo(state, 'scythe'), false);
});

test('restoration bounds untrusted stored state and rolls allowances over without losing records', () => {
  const state = freshState();
  queueDemo(state, 'pancakeo');
  for (let i = 0; i < STAGES.length; i++) advanceDemo(state);
  queueDemo(state, 'scythe');
  const restored = restoreState({ ...state, daily: 999, budget: -2, time: '26:00' });
  assert.equal(restored.daily, 1);
  assert.equal(restored.budget, 5);
  assert.equal(restored.time, '09:00');
  const tomorrow = restoreState({ ...state, day: 'old day' });
  assert.deepEqual(tomorrow.used, { pancakeo: 0, scythe: 0 });
  assert.equal(tomorrow.jobs.length, 0);
  assert.equal(tomorrow.records.length, 1);
  assert.deepEqual(restoreState({ jobs: [null, {}, { agent: 'someone' }], records: [false, {}] }).jobs, []);
});

test('built ACI has its own assets, no presence/player injection, and remains noindex', async () => {
  const html = await readFile(new URL('../dist/aci/index.html', import.meta.url), 'utf8');
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /\/aci\/aci.js/);
  assert.doesNotMatch(html, /\/assets\/(listeners|app|player|api|shell)\.js/);
  assert.match(html, /LOCAL PREVIEW/);
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /href="\/aci/);
});
