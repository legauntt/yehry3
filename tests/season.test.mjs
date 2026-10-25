import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halloweenSeason } from '../assets/season.js';
test('Halloween starts October 1 and ends November 1 in Pacific time', () => {
  for (const [date, expected] of [
    ['2026-10-01T06:59:59Z', false], ['2026-10-01T07:00:00Z', true],
    ['2026-11-01T06:59:59Z', true], ['2026-11-01T07:00:00Z', false],
    ['2027-10-15T12:00:00Z', false],
  ]) assert.equal(halloweenSeason(new Date(date)), expected, date);
});
