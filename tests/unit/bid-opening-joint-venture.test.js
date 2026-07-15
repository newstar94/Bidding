import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOpeningLookupNames } from '../../frontend/packages/bidProcessOpeningData.js';

test('keeps the joint-venture name when the lead member is looked up', () => {
    const result = resolveOpeningLookupNames(
        'Liên danh',
        'Liên danh An Phát - Minh Long',
        'Công ty TNHH An Phát'
    );

    assert.equal(result.bidName, 'Liên danh An Phát - Minh Long');
    assert.equal(result.leadMemberName, 'Công ty TNHH An Phát');
});

test('independent contractor name still follows the lookup result', () => {
    const result = resolveOpeningLookupNames(
        'Độc lập',
        'Tên nhập tạm',
        'Công ty TNHH An Phát'
    );

    assert.equal(result.bidName, 'Công ty TNHH An Phát');
});
