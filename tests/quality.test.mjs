import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityNotice } from '../assets/quality.js';

test('quality notice is useful and cannot inject untrusted markup', () => {
  assert.equal(qualityNotice(), '');
  assert.equal(qualityNotice([{code:'other',seconds:23}]), '');
  assert.equal(qualityNotice([{code:'long_instrumental_outro',seconds:'<script>'}]), '');
  const html=qualityNotice([{code:'long_instrumental_outro',seconds:22.86,message:'<script>alert(1)</script>'}],'needs_review',['voice_validation']);
  assert.match(html,/Needs review/);
  assert.match(html,/Review notes/);
  assert.match(html,/data-review-state="needs_review"/);
  assert.match(html,/23 seconds/);
  assert.doesNotMatch(html,/<script>/);
  const both=qualityNotice([{code:'long_instrumental_outro',seconds:29.66},{code:'long_instrumental_break',seconds:12.32}]);
  assert.match(both,/30 seconds after/);
  assert.match(both,/12 seconds between/);
  assert.doesNotMatch(both,/Needs review|data-review-state/);
  assert.match(qualityNotice([], 'needs_review', ['voice_validation']), /Needs review/);
  assert.doesNotMatch(qualityNotice([], undefined, ['voice_validation']), /badge needs_review/);
  assert.doesNotMatch(qualityNotice([{code:'vocal_dropout', seconds:2}], 'needs_review'), /badge needs_review/);
  assert.equal(qualityNotice([{code:'long_instrumental_break',seconds:9}]), '');
  const dropout=qualityNotice([{code:'vocal_dropout',seconds:1.2,error:'<script>private repair error</script>'}]);
  assert.match(dropout,/A vocal passage could not be fully restored \(1.2 seconds\)/);
  assert.match(dropout,/available to play/);
  assert.doesNotMatch(dropout,/<script>|private repair error/);
  assert.match(qualityNotice([{code:'vocal_dropout',seconds:602}]), /602 seconds/);
  for (const seconds of [0.4, 0, -1, 1440.1, Infinity, NaN, '1.2']) {
    assert.equal(qualityNotice([{code:'vocal_dropout',seconds}]), '');
  }
});
