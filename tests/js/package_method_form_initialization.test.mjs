import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('field initialization preserves the method while an explicit field change resets it', () => {
  const source = readFileSync('frontend/app/BiddingControllerForms.js', 'utf8');
  const start = source.indexOf('const handleLinhVucChange =');
  const end = source.indexOf('gtLinhVucSelect.addEventListener', start);
  const calls = [];
  const handler = runInNewContext(`${source.slice(start, end)}; handleLinhVucChange`, {
    gtLinhVucSelect: { value: 'Phi tư vấn' },
    gtHinhThucSelect: { querySelectorAll: () => [] },
    gtTuyChonContainer: null,
    gtPhanLoContainer: null,
    document: { getElementById: () => null },
    setDisabled() {},
    setRuntimeStyle() {},
    updatePhuongPhapDanhGiaOptions: (force) => calls.push(force),
  });
  handler();
  handler({ type: 'change' });
  assert.deepEqual(calls, [false, true]);
});
