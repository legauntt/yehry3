import test from 'node:test';
import assert from 'node:assert/strict';
import { songCost, songCostLabel } from '../assets/song-cost.js';
import { settledSongCosts } from '../assets/settled-song-costs.js';

test('recorded generation costs take precedence over length estimates', () => {
  const [id, cents] = Object.entries(settledSongCosts)[0];
  const song = { id, musicBackend: 'eleven_music', duration: 600 };
  assert.deepEqual(songCost(song), { cents, estimated: false });
  assert.doesNotMatch(songCostLabel(song), / est\./);
  for (const [id, cents] of Object.entries(settledSongCosts)) {
    assert.match(id, /^distonyc-[a-f0-9]{24}$/);
    assert.ok(Number.isSafeInteger(cents) && cents >= 0);
  }
});

test('missing charges use labeled duration estimates or the fifty-cent fallback', () => {
  assert.deepEqual(songCost({ musicBackend: 'eleven_music', duration: 245 }), { cents: 61, estimated: true });
  assert.match(songCostLabel({ musicBackend: 'eleven_music', duration: 180 }), /Cost \$0\.45 est\./);
  for (const duration of [undefined, null, 0, -1, NaN, Infinity, '180']) {
    assert.deepEqual(songCost({ originalPrompt: { musicBackend: 'eleven_music' }, duration }), { cents: 50, estimated: true });
  }
});

test('local and unattributed recordings do not get a paid cost', () => {
  for (const song of [{}, { musicBackend: 'local' }, { musicBackend: 'unknown' }]) {
    assert.equal(songCost(song), null);
    assert.equal(songCostLabel(song), '');
  }
});
