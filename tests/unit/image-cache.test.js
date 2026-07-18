import assert from 'node:assert/strict';
import test from 'node:test';

import { safeImageSrc } from '../../frontend/shared/view_helpers.js';

test('adds an image version to uploaded files but never changes base64 images', () => {
  assert.equal(
    safeImageSrc('/images/nha_thau/nt-1_stamp.png', '2026-07-13 08:09:10'),
    '/images/nha_thau/nt-1_stamp.png?v=2026-07-13%2008%3A09%3A10'
  );
  const base64 = 'data:image/png;base64,AAAA';
  assert.equal(safeImageSrc(base64, 'new'), base64);
});
