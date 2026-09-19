import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryStatus } from '../assets/recovery.js';
test("only a failed request with fresh recovery evidence avoids 9/11'd Again", () => {
  const now = Date.now();
  const doc = { status: 'failed', recovery: { phase: 'recovering', expiresAt: new Date(now + 60000).toISOString() } };
  assert.equal(recoveryStatus(doc, now), 'recovering');
  assert.equal(recoveryStatus(doc, now + 60001), 'failed');
  assert.equal(recoveryStatus({ ...doc, status: 'canceled' }, now), 'canceled');
  assert.equal(recoveryStatus({ status: 'failed' }, now), 'failed');
});
