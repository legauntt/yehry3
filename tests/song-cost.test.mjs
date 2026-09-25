import test from 'node:test';
import assert from 'node:assert/strict';
import { songCost, songCostLabel } from '../assets/song-cost.js';
import { settledSongCosts } from '../assets/settled-song-costs.js';

test('recorded generation costs take precedence over length estimates', () => {
  const [id, cents] = Object.entries(settledSongCosts)[0];
  const song = { id, musicBackend: 'eleven_music', duration: 600 };
  assert.deepEqual(songCost(song), { cents, estimated: false });
  assert.match(songCostLabel(song), /Recorded generation cost/);
  const [dollarId, dollarCents] = Object.entries(settledSongCosts).find(([, value]) => value >= 100);
  assert.ok(songCostLabel({ id: dollarId, musicBackend: 'eleven_music' }).includes(`>$${(dollarCents / 100).toFixed(2)}<`));
  for (const [id, cents] of Object.entries(settledSongCosts)) {
    assert.match(id, /^distonyc-[a-f0-9]{24}$/);
    assert.ok(Number.isSafeInteger(cents) && cents >= 0);
  }
});

test('missing charges use labeled duration estimates or the fifty-cent fallback', () => {
  assert.deepEqual(songCost({ musicBackend: 'eleven_music', duration: 245 }), { cents: 61, estimated: true });
  assert.match(songCostLabel({ musicBackend: 'eleven_music', duration: 180 }), />45 ¢</);
  for (const [cents, label] of [[99, '99 ¢'], [100, '$1.00'], [119, '$1.19']]) {
    assert.ok(songCostLabel({ musicBackend: 'eleven_music', duration: cents * 4 }).includes(`>${label}<`));
  }
  for (const duration of [undefined, null, 0, -1, NaN, Infinity, '180']) {
    assert.deepEqual(songCost({ originalPrompt: { musicBackend: 'eleven_music' }, duration }), { cents: 50, estimated: true });
  }
});

test('local recordings are labeled free', () => {
  assert.equal(songCost({ musicBackend: 'local' }), null);
  assert.match(songCostLabel({ musicBackend: 'local' }), />FREE</);
});

test('unattributed recordings do not get a cost', () => {
  for (const song of [{}, { musicBackend: 'unknown' }]) {
    assert.equal(songCost(song), null);
    assert.equal(songCostLabel(song), '');
  }
});
