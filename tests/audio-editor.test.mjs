import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editSettings, peaks, fadeGain } from '../assets/audio-edit-model.js';
import { songSides } from '../assets/sides.js';
import { performanceTranscript } from '../assets/performance-lyrics.js';

test('crop validation and preview fade include zero fade and full fade', () => {
  assert.deepEqual(editSettings(30, 0, 60), { end: 30, fade: 0 });
  for (const args of [[61, 0, 60], [30, 31, 60], [0, 0, 60], [30, NaN, 60]]) assert.throws(() => editSettings(...args));
  assert.equal(fadeGain(28, 30, 4), .5); assert.equal(fadeGain(20, 30, 4), 1); assert.equal(fadeGain(30, 30, 0), 0);
  const waveform = peaks({ length: 4, numberOfChannels: 2, getChannelData: i => i ? [0, 1, 0, .5] : [-.5, 0, .25, 0] }, 2);
  assert.deepEqual([...waveform], [1, .5]);
});
test('edited recording and Original remain selectable in default order', () => {
  const source = '/original.mp3', url = '/edit.mp3';
  const song = { id: 'test', url, originalAudio: { url: source }, audioEdits: [{ url, sourceUrl: source, fade: 3 }] };
  assert.deepEqual(songSides(song).map(row => [row.label, row.url]), [['Edit 1', url], ['Original', source]]);
  assert.deepEqual(songSides({ ...song, url: source, originalAudio: null }).map(row => row.label), ['Original', 'Edit 1']);
  assert.deepEqual(songSides({ ...song, url: '/replacement.mp3', originalAudio: null }), []);
});
test('transcripts stay bound to preserved original after a cropped edit becomes default', () => {
  const source = '/original.mp3', song = { id: 'test', url: '/edit.mp3', duration: 20, originalAudio: { url: source, duration: 30 } };
  const value = { version: 1, songId: 'test', audioUrl: source, audioSha256: 'a'.repeat(64), inputSha256: 'a'.repeat(64), input: 'released-recording', model: 'faster-whisper large-v3', review: 'machine', duration: 30, segments: [{ start: 1, end: 2, text: 'Hello', uncertain: false }] };
  assert.equal(performanceTranscript(value, song, 'whisper').audioUrl, source);
  assert.throws(() => performanceTranscript({ ...value, audioUrl: '/other.mp3' }, song, 'whisper'));
});
