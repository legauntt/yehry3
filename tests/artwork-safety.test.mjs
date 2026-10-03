import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { makeSafetyPrompt, isSafetyRejection } from '../scripts/artwork-safety.mjs';

test('safe interpretations omit arbitrary source text and allow visual changes', () => {
  const packet = { song: { title: 'RAW-TITLE', lyrics: 'RAW-LYRICS moon', songPlan: { genre: 'opera RAW-INSTRUCTION' } } };
  const prompt = makeSafetyPrompt(packet, 'basic', 1);
  assert.doesNotMatch(prompt, /RAW-/);
  assert.match(prompt, /opera/);
  assert.match(prompt, /moon/);
  assert.match(prompt, /freely change the subject/);
  assert.match(makeSafetyPrompt(packet, 'basic', 2), /purely abstract/);
  assert.equal(isSafetyRejection("'code': 'moderation_blocked'"), true);
  assert.equal(isSafetyRejection('{"code":"content_policy_violation"}'), true);
  for (const log of ['moderation_blocked in a title', "'code': 'token_invalidated'", 'timeout', 'HTTP 429'])
    assert.equal(isSafetyRejection(log), false);
});

async function scenario(t, { failures = 1, error = 'moderation_blocked', budget = '10', pins = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'artwork-safety-'));
  t.after(() => rm(root, { recursive: true }));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'assets/artwork'), { recursive: true });
  for (const file of ['song-artwork.mjs', 'artwork-policy.mjs', 'artwork-budget.mjs', 'artwork-safety.mjs'])
    await copyFile(new URL('../scripts/' + file, import.meta.url), path.join(root, 'scripts', file));
  await copyFile(new URL('../assets/artwork-versions.js', import.meta.url), path.join(root, 'assets', 'artwork-versions.js'));
  const prefix = '// Saved covers. Updated by scripts/song-artwork.mjs.\nexport default ';
  await writeFile(path.join(root, 'assets/artwork-catalog.js'), prefix + '{};\n');
  const callsFile = path.join(root, 'calls.json');
  await writeFile(callsFile, '[]');
  await writeFile(path.join(root, 'fake-cli.cjs'), `
    const fs = require('node:fs');
    const job = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--input') + 1], 'utf8'));
    const file = ${JSON.stringify(callsFile)};
    const calls = JSON.parse(fs.readFileSync(file)); calls.push(job.prompt); fs.writeFileSync(file, JSON.stringify(calls));
    if (calls.length <= ${failures}) { console.error(JSON.stringify({ error: { code: ${JSON.stringify(error)} } })); process.exit(1); }
    const image = Buffer.alloc(1100); image.write('RIFF'); image.write('WEBP', 8); fs.writeFileSync(job.out, image);
  `);
  await writeFile(path.join(root, 'scripts/prepare-cover.py'), "require('node:fs').copyFileSync(process.argv[2], process.argv[3]);");
  const song = { id: 'test-song', title: 'RAW-TITLE', adminPinned: false, lyrics: { text: 'RAW-LYRICS moon' }, songPlan: { genre: 'rock' } };
  let reads = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/songs/summary') res.end(JSON.stringify({ songs: [{ ...song, adminPinned: pins[reads++] ?? false }] }));
    else res.end(JSON.stringify({ song }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = (...extra) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/song-artwork.mjs'), 'run', '--exclude-pinned',
      '--api', `http://127.0.0.1:${server.address().port}`, '--state', path.join(root, 'state'), '--budget', budget,
      '--python', process.execPath, '--cli', path.join(root, 'fake-cli.cjs'), ...extra],
      { windowsHide: true, env: { ...process.env, OPENAI_API_KEY: 'fake-test-key' } });
    let output = '';
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  const result = await run();
  const ledger = () => readFile(path.join(root, 'state/ledger.json'), 'utf8').then(JSON.parse);
  const calls = () => readFile(callsFile, 'utf8').then(JSON.parse);
  const registry = () => readFile(path.join(root, 'assets/artwork-catalog.js'), 'utf8').then(s => JSON.parse(s.slice(prefix.length).trim().replace(/;$/, '')));
  return { root, result, run, ledger, calls, registry };
}

test('a safety rejection gets a changed prompt and a separate spend reservation', async t => {
  const s = await scenario(t);
  assert.equal(s.result.code, 0, s.result.output);
  const calls = await s.calls();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /RAW-LYRICS/);
  assert.doesNotMatch(calls[1], /RAW-/);
  const ledger = await s.ledger();
  assert.equal(ledger.events.filter(e => e.type === 'reservation').length, 2);
  assert.equal(ledger.events.filter(e => e.type === 'safety-retry').length, 1);
  assert.equal(Object.values(ledger.jobs)[0].status, 'complete');
  assert.equal((await s.registry())['test-song'].interpretation, 'automatic-safe-interpretation');
  await s.run();
  assert.equal((await s.calls()).length, 2);
});

test('two rejected safe interpretations stop, even with recovery requested after restart', async t => {
  const s = await scenario(t, { failures: 99 });
  assert.equal(s.result.code, 1);
  assert.equal((await s.calls()).length, 3);
  assert.match((await s.calls())[2], /purely abstract/);
  await s.run('--retry-safety');
  assert.equal((await s.calls()).length, 3);
  assert.equal(Object.values(await s.registry()).length, 0);
});

test('authentication failures never trigger safety retries', async t => {
  const s = await scenario(t, { error: 'token_invalidated', failures: 99 });
  assert.equal(s.result.code, 1);
  await s.run('--retry-safety');
  assert.equal((await s.calls()).length, 1);
});

test('budget exhaustion prevents another paid call and recovery uses a safe prompt only', async t => {
  const s = await scenario(t, { budget: '.02' });
  assert.equal(s.result.code, 1);
  assert.equal((await s.calls()).length, 1);
  assert.match(s.result.output, /budget exhausted/);
  // A fresh period/budget can recover a positively identified historical rejection.
  const result = await s.run('--retry-safety', '--budget', '10', '--budget-period', 'monthly');
  assert.equal(result.code, 0, result.output);
  assert.equal((await s.calls()).length, 2);
  assert.doesNotMatch((await s.calls())[1], /RAW-/);
});

test('a pin arriving after rejection prevents the retry', async t => {
  const s = await scenario(t, { pins: [false, false, true] });
  assert.equal(s.result.code, 0, s.result.output);
  assert.equal((await s.calls()).length, 1);
  assert.equal(Object.values(await s.registry()).length, 0);
  assert.equal(Object.values((await s.ledger()).jobs)[0].status, 'protected-pinned');
});
