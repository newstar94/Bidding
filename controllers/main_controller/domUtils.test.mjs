import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTaxCodeForCompare, normalizeTaxCodeForLookup } from './domUtils.js';

test('normalizeTaxCodeForLookup strips bidding code prefixes before tax lookup', () => {
    assert.equal(normalizeTaxCodeForLookup('vn0107659123'), '0107659123');
    assert.equal(normalizeTaxCodeForLookup('vnz0107659123'), '0107659123');
    assert.equal(normalizeTaxCodeForLookup('vnp0107659123'), '0107659123');
    assert.equal(normalizeTaxCodeForLookup('VNP-0107659123'), '0107659123');
});

test('normalizeTaxCodeForLookup keeps plain tax code unchanged', () => {
    assert.equal(normalizeTaxCodeForLookup('0107659123'), '0107659123');
});

test('normalizeTaxCodeForCompare canonicalizes prefixed and separated tax codes', () => {
    assert.equal(normalizeTaxCodeForCompare('vn0108955340'), '0108955340');
    assert.equal(normalizeTaxCodeForCompare('0108955340'), '0108955340');
    assert.equal(normalizeTaxCodeForCompare('VN-0108955340'), '0108955340');
    assert.equal(normalizeTaxCodeForCompare('0108955340-001'), '0108955340001');
});
