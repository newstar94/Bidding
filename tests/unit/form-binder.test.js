import assert from 'node:assert/strict';
import test from 'node:test';

import { collectFormValues, setFormValues } from '../../frontend/shared/FormBinder.js';

test('form binder loads and collects configured controls', () => {
  const controls = {
    name: { value: '', type: 'text' },
    active: { checked: false, type: 'checkbox' }
  };
  const root = { getElementById: id => controls[id] || null };
  const mapping = { ten: 'name', hoatDong: 'active' };
  setFormValues(root, { ten: 'Nhà thầu A', hoatDong: true }, mapping);
  assert.equal(controls.name.value, 'Nhà thầu A');
  assert.equal(controls.active.checked, true);
  assert.deepEqual(collectFormValues(root, mapping), { ten: 'Nhà thầu A', hoatDong: true });
});
