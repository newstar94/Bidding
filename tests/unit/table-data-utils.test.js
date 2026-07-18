import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectYearMonthOptions,
  matchesYearMonth,
  paginateRecords
} from '../../frontend/shared/tableDataUtils.js';

test('collects Vietnamese date filters without duplicating values', () => {
  const result = collectYearMonthOptions([
    { date: '05/01/2026' },
    { date: '2025-12-10' },
    { date: '20/01/2026' }
  ], item => item.date);
  assert.deepEqual(result.years, ['2026', '2025']);
  assert.deepEqual(result.months, ['12', '1']);
});

test('matches year and month filters for both stored date formats', () => {
  assert.equal(matchesYearMonth('2026-07-20', '2026', '7'), true);
  assert.equal(matchesYearMonth('20/07/2026', '2026', '7'), true);
  assert.equal(matchesYearMonth('', '2026', ''), false);
});

test('paginates local records consistently', () => {
  assert.deepEqual(paginateRecords([1, 2, 3, 4, 5], 2, 2), [3, 4]);
});
