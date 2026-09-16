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

test('generation briefs omit automatic defaults but retain explicit zeroes and all chosen controls', () => {
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  assert.equal(generationBrief(schema.defaults, escape), '');
  const choices = { ...schema.defaults, seed: 0, vocalEntry: 0, maxBreakSeconds: 0, genre: 'Jazz <script>', instruments: ['Piano'], avoidInstruments: ['Drums'], duration: 180, bpm: 98, keyscale: 'D minor', meter: '3/4', endingSeconds: 4, structure: 'Verse, Chorus', lyricWorkflow: 'story', avoidPhrases: ['cliche'], requiredPhrases: ['home'], lockedLines: ['Come home'], reviewLyrics: true, candidates: 2, variation: 'adventurous', vocalGainDb: -2, backingGainDb: 1, performance: 'raw', energy: 'build' };
  const html = generationBrief(choices, escape);
  for (const label of ['Seed', 'First vocal (seconds)', 'Longest instrumental break (seconds)', 'Featured instruments', 'Leave out these instruments', 'Section order', 'Closing chord (seconds)', 'Lyric preview', 'Vocal delivery', 'Energy through the song', 'Vocal level adjustment (dB)', 'Band level adjustment (dB)']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('Jazz &lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.equal((html.match(/<dd>0<\/dd>/g) || []).length, 3);
});
