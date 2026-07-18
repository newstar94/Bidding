import assert from 'node:assert/strict';
import test from 'node:test';

import { debounce } from '../../frontend/app/domUtils.js';

test('flushes a pending debounced lookup immediately without running it twice', async () => {
    const calls = [];
    const lookup = debounce((value) => calls.push(value), 20);

    lookup('vn0104380600');
    lookup.flush();
    assert.deepEqual(calls, ['vn0104380600']);

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(calls, ['vn0104380600']);
});
