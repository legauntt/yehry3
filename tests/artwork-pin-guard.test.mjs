import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

async function guardedRun(t, pins) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'artwork-guard-'));
  t.after(() => rm(fixture, { recursive: true }));
  await mkdir(path.join(fixture, 'scripts'));
  await mkdir(path.join(fixture, 'assets/artwork'), { recursive: true });
  for (const file of ['song-artwork.mjs', 'artwork-policy.mjs', 'artwork-budget.mjs']) {
    await copyFile(new URL('../scripts/' + file, import.meta.url), path.join(fixture, 'scripts', file));
  }
  const registry = '// Saved covers. Updated by scripts/song-artwork.mjs.\nexport default {};\n';
  await writeFile(path.join(fixture, 'assets/artwork-catalog.js'), registry);
  const marker = path.join(fixture, 'api-called');
  await writeFile(path.join(fixture, 'fake-cli.cjs'), `
    const fs = require('node:fs');
    const file = process.argv[process.argv.indexOf('--input') + 1];
    const job = JSON.parse(fs.readFileSync(file, 'utf8'));
    const image = Buffer.alloc(1100); image.write('RIFF'); image.write('WEBP', 8);
    fs.writeFileSync(job.out, image); fs.writeFileSync(${JSON.stringify(marker)}, 'yes');
  `);
  await writeFile(path.join(fixture, 'scripts/prepare-cover.py'), "require('node:fs').copyFileSync(process.argv[2], process.argv[3]);");
  let pinReads = 0;
  const song = { id: 'test-song', title: 'Test Song', adminPinned: false, votes: 0, lyrics: { text: 'A boat under the stars' }, originalPrompt: { idea: 'folk' }, songPlan: { genre: 'folk' } };
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/songs/summary') res.end(JSON.stringify({ songs: [{ ...song, adminPinned: pins[pinReads++] }] }));
    else if (req.url === '/songs/test-song') res.end(JSON.stringify({ song }));
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(fixture, 'scripts/song-artwork.mjs'), 'run',
      '--api', `http://127.0.0.1:${server.address().port}`, '--state', path.join(fixture, 'state'),
      '--python', process.execPath, '--cli', path.join(fixture, 'fake-cli.cjs'), '--exclude-pinned'],
    { windowsHide: true, env: { ...process.env, OPENAI_API_KEY: 'not-a-real-key' } });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(path.join(fixture, 'assets/artwork-catalog.js'), 'utf8'), registry);
  const ledger = JSON.parse(await readFile(path.join(fixture, 'state/ledger.json'), 'utf8'));
  assert.equal(Object.values(ledger.jobs)[0].status, 'protected-pinned');
  return { called: await access(marker).then(() => true, () => false), pinReads };
}

test('a pin added after planning prevents the image API call', async t => {
  const result = await guardedRun(t, [false, true]);
  assert.equal(result.called, false);
  assert.equal(result.pinReads, 2);
});

test('a pin added during rendering prevents installation of the generated cover', async t => {
  const result = await guardedRun(t, [false, false, true]);
  assert.equal(result.called, true);
  assert.equal(result.pinReads, 3);
});

test('unknown pin status prevents the image API call', async t => {
  const result = await guardedRun(t, [false, undefined]);
  assert.equal(result.called, false);
});
