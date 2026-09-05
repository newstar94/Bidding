import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteGoiThau } from '../../frontend/packages/packageLifecycleWorkflow.js';

test('delete confirmation appears before server lookup and cancellation deletes nothing', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pkg = { id: 'pkg', tenGoiThau: 'Diagnostic', keHoachId: 'plan' };
  const state = { goithau: [pkg], kehoach: [{ id: 'plan' }], thongtinmothau: [] };
  let confirmations = 0;
  let lookups = 0;
  const controller = {
    model: { state, useServerSidePagination: false },
    fetchRecordByLookup: async () => { lookups++; await gate; return null; },
    view: { customConfirm: async () => { confirmations++; return false; } },
  };
  const pending = deleteGoiThau.call(controller, 'pkg');
  await Promise.resolve();
  assert.equal(lookups, 0);
  assert.equal(confirmations, 1);
  release();
  await pending;
  assert.equal(confirmations, 1);
  assert.equal(lookups, 0);
  assert.deepEqual(state.goithau, [pkg]);
});
