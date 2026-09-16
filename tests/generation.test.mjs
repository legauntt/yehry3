import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalizeGeneration } from '../assets/generation-options.js';
import { generationBrief } from '../assets/generation.js';
import { qualityNotice } from '../assets/quality.js';
const schema = JSON.parse(readFileSync(new URL('../assets/generation-schema.json', import.meta.url)));

test('browser and worker agree on explicit controls and Unicode validation without silent substitutions', () => {
  const cases = [null, { version: 1 }, { version: 1, meter: '6/8', keyscale: 'Eb minor', bpm: 77, duration: 180, seed: 0, vocalGainDb: -2.5 }, { version: 1, instruments: ['Straße','STRASSE'], avoidPhrases: ['crooked grin','shoes'] }, { version: 1, bpm: true }, { version: 1, duration: 90 }, { version: 1, unknown: 'x' }, { version: 1, instruments: ['Bass'], avoidInstruments: ['bass'] }, { version: 1, genre: '😀'.repeat(61) }];
  const expected = cases.map((value) => { try { return { value: normalizeGeneration(value, schema) }; } catch { return { error: true }; } });
  const result = spawnSync(process.env.V8_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-X','utf8','-c', "import sys,json;sys.path.insert(0,'pc-worker');from generation_controls import normalize\nrows=[]\nfor item in json.load(sys.stdin):\n try: rows.append({'value':normalize(item)})\n except ValueError: rows.append({'error':True})\nprint(json.dumps(rows,ensure_ascii=False))"], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(result.status,0,result.error?.message || result.stderr); assert.deepEqual(JSON.parse(result.stdout),expected);
});

test('confirmed choices render as text and lexical notices describe uncertainty', () => {
  const escape = (v) => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html = generationBrief({ version:1, genre:'constructor', instruments:['<script>bad</script>'], reviewLyrics:true },escape);
  assert.ok(html.includes('constructor')); assert.ok(!html.includes('function Object')); assert.ok(!html.includes('<script>'));
  assert.ok(qualityNotice([{code:'early_lyric_ending',seconds:40}]).includes('listening check'));
  assert.ok(qualityNotice([{code:'unconfirmed_lyric_ending'}]).includes('could not confirm'));
  assert.equal(qualityNotice([{code:'early_lyric_ending',seconds:5}]),'');
});
