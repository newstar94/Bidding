import assert from 'node:assert/strict';
import test from 'node:test';

import { mutatePersistAndSync, persistAndSync } from '../../frontend/shared/MutationService.js';

test('persists every table before rendering and starting synchronization', async () => {
  const calls = [];
  const controller = {
    model: { async persistData(key) { calls.push(`persist:${key}`); } },
    async autoSync() { calls.push('sync'); return { ok: true }; }
  };
  const result = await persistAndSync(controller, ['goithau', 'goithau', 'thongtinmothau'], {
    afterPersist() { calls.push('render'); }
  });
  assert.deepEqual(calls, ['persist:goithau', 'persist:thongtinmothau', 'render', 'sync']);
  assert.equal(result.ok, true);
});

test('mutation service updates state and queues deletions before persistence', async () => {
  const calls = [];
  const controller = {
    model: {
      state: { goithau: [{ id: 'old' }] },
      normalizeRecordKeys: record => record,
      markDeleted: (table, ids) => calls.push(`delete:${table}:${ids.join(',')}`),
      persistData: async key => calls.push(`persist:${key}`)
    },
    autoSync: async () => { calls.push('sync'); return { ok: true }; }
  };
  await mutatePersistAndSync(controller, {
    upserts: { goithau: { id: 'new', name: 'Gói mới' } },
    deletions: { goithau: ['old'] }
  });
  assert.deepEqual(controller.model.state.goithau, [{ id: 'new', name: 'Gói mới' }]);
  assert.deepEqual(calls, ['delete:goithau:old', 'persist:goithau', 'sync']);
});
