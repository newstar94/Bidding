import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVersionFamily,
  renderVersionSelector,
  resolveSelectedVersion
} from '../../frontend/shared/VersionSelector.js';

const records = [
  { id: 'nt-00', rootId: 'nt-00', phienBan: '00' },
  { id: 'nt-01', rootId: 'nt-00', phienBan: '01' }
];

test('version family is sorted from newest to oldest', () => {
  assert.deepEqual(getVersionFamily(records, records[0]).map(item => item.id), ['nt-01', 'nt-00']);
});

test('selected version falls back to the supplied row', () => {
  assert.equal(resolveSelectedVersion(records, records[0], { 'nt-00': 'nt-01' }).id, 'nt-01');
  assert.equal(resolveSelectedVersion(records, records[0], { 'nt-00': 'missing' }).id, 'nt-00');
});

test('version selector escapes identifiers and keeps the selected version', () => {
  const html = renderVersionSelector({
    versions: records,
    selectedId: 'nt-01',
    rootId: 'nt-00',
    changeAction: 'change-contractor-version'
  });
  assert.match(html, /data-bf-change="change-contractor-version"/);
  assert.match(html, /value="nt-01" selected>01<\/option>/);
});
