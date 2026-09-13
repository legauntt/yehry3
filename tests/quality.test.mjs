import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityNotice } from '../assets/quality.js';

test('quality notice is useful and cannot inject untrusted markup', () => {
  assert.equal(qualityNotice(), '');
  assert.equal(qualityNotice([{code:'other',seconds:23}]), '');
  assert.equal(qualityNotice([{code:'long_instrumental_outro',seconds:'<script>'}]), '');
  const html=qualityNotice([{code:'long_instrumental_outro',seconds:22.86,message:'<script>alert(1)</script>'}]);
  assert.match(html,/Has issues/);
  assert.match(html,/23 seconds/);
  assert.doesNotMatch(html,/<script>/);
  const both=qualityNotice([{code:'long_instrumental_outro',seconds:29.66},{code:'long_instrumental_break',seconds:12.32}]);
  assert.match(both,/30 seconds after/);
  assert.match(both,/12 seconds between/);
  assert.equal(qualityNotice([{code:'long_instrumental_break',seconds:9}]), '');
});
