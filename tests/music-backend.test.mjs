import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetNote } from '../assets/music-backend.js';

const provider = (extra = {}) => ({ fresh: true, availableCents: 3621, resetAt: '2026-10-17T12:00:00.000Z', ...extra });

test('without a plan balance the cap sentence is unchanged', () => {
  assert.equal(budgetNote({ remainingCents: 16600 }, 75), ' $166.00 is available to reserve.');
  assert.equal(budgetNote({ remainingCents: 16600, provider: null }, 75), ' $166.00 is available to reserve.');
  assert.equal(budgetNote(undefined, 75), '');
});

test('a fresh plan balance is shown beside the cap with its renewal date', () => {
  const note = budgetNote({ remainingCents: 16600, provider: provider() }, 75);
  assert.match(note, /\$166\.00 is available to reserve\./);
  assert.match(note, /about \$36\.21 of generation credits left, renewing Oct 17\./);
  assert.doesNotMatch(note, /not enough/);
});

test('a length the credits cannot cover is called out before the server refuses it', () => {
  assert.match(budgetNote({ remainingCents: 16600, provider: provider({ availableCents: 50 }) }, 75), /not enough for this length/);
  assert.doesNotMatch(budgetNote({ remainingCents: 16600, provider: provider({ availableCents: 75 }) }, 75), /not enough/);
});

test('a stale balance is not presented as current', () => {
  const note = budgetNote({ remainingCents: 16600, provider: provider({ fresh: false, availableCents: null }) }, 75);
  assert.equal(note, ' $166.00 is available to reserve.');
});
