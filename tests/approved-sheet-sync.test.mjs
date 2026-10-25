import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncApprovedLyricSheets, catalogWithSheets } from '../scripts/sync-approved-lyric-sheets.mjs';

const sheet = { text: '[Verse]\n' + 'Approved words stay exactly as written.\n'.repeat(4) + '[End]' };
const song = { id: 'distonyc-test', url: 'https://example.com/original.mp3', lyrics: { text: 'Performance transcript' }, originalPrompt: { idea: 'Confirmed idea', generation: { reviewLyrics: true } } };
const published = { ...song, originalPrompt: { ...song.originalPrompt, voiceModel: 'v6', finalLyricSheet: sheet } };

test('sync preserves the approved text separately from the recording transcript and is idempotent', () => {
  const original = { songs: [song] };
  const result = syncApprovedLyricSheets(original, [published]);
  assert.deepEqual(result.changed, [song.id]);
  assert.deepEqual(result.catalog.songs[0], { ...song, originalPrompt: { ...song.originalPrompt, finalLyricSheet: sheet } });
  assert.equal(original.songs[0].originalPrompt.finalLyricSheet, undefined);
  assert.deepEqual(syncApprovedLyricSheets(result.catalog, [published]).changed, []);
  const source = JSON.stringify(original, null, 2).replace('"songs": [', '"duration": 240.0, "songs": [');
  const numericResult = syncApprovedLyricSheets(JSON.parse(source), [published]);
  assert.ok(catalogWithSheets(source, numericResult).includes('"duration": 240.0'));
});

test('sync refuses different recordings, briefs, existing sheets and nonpublic fields', () => {
  for (const changed of [
    { ...published, url: 'https://example.com/replacement.mp3' },
    { ...published, originalPrompt: { ...published.originalPrompt, idea: 'Changed idea' } },
    { ...published, originalPrompt: { ...published.originalPrompt, finalLyricSheet: { ...sheet, privateNote: 'private' } } },
  ]) assert.throws(() => syncApprovedLyricSheets({ songs: [song] }, [changed]));
  assert.throws(() => syncApprovedLyricSheets({ songs: [{ ...song, originalPrompt: { ...song.originalPrompt, finalLyricSheet: { text: 'Different approved sheet' } } }] }, [published]));
});
