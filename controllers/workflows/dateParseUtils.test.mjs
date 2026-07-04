import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBidDateTime } from './dateParseUtils.js';

function assertLocalDate(date, parts) {
    assert.equal(date.getFullYear(), parts.year);
    assert.equal(date.getMonth(), parts.month - 1);
    assert.equal(date.getDate(), parts.day);
    assert.equal(date.getHours(), parts.hour);
    assert.equal(date.getMinutes(), parts.minute);
}

test('parseBidDateTime parses Vietnamese date time', () => {
    assertLocalDate(parseBidDateTime('05/07/2026 09:30'), {
        year: 2026,
        month: 7,
        day: 5,
        hour: 9,
        minute: 30
    });
});

test('parseBidDateTime parses ISO local date time', () => {
    assertLocalDate(parseBidDateTime('2026-07-05T09:30'), {
        year: 2026,
        month: 7,
        day: 5,
        hour: 9,
        minute: 30
    });
});

test('parseBidDateTime returns null for empty or invalid values', () => {
    assert.equal(parseBidDateTime(''), null);
    assert.equal(parseBidDateTime('khong phai ngay'), null);
});
