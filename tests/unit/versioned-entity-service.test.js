import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canDeleteVersions,
  createInitialVersion,
  createNextVersion,
  getNextVersion,
  preparePackageSnapshot,
  rememberSelectedVersion,
  removeAllVersions,
  removeLatestVersion
} from '../../frontend/shared/VersionedEntityService.js';

test('starts a package snapshot without copying opening or award results', () => {
  const snapshot = preparePackageSnapshot({
    id: 'gt-old',
    trangThai: 'Đã có kết quả',
    nhaThauTrungThauId: 'nt-1',
    giaTrungThau: 95,
    danhGiaHsdtMetadata: { schemaVersion: 1, cancelDetails: { lyDo: 'old' } },
    phanLoList: [{ id: 'lot-old', maPhanLo: 'L1', nhaThauTrungThauId: 'nt-1', giaTrungThau: 95 }],
    awardedPhanLoList: [{ id: 'lot-old', maPhanLo: 'L1', nhaThauTrungThauId: 'nt-1' }],
    tuyChonMuaThemList: [{ id: 'option-old', hangMuc: 'A' }],
    giaHanList: [{ id: 'extension-old' }]
  }, { keHoachId: 'kh-new' });

  assert.equal(snapshot.trangThai, 'Chuẩn bị');
  assert.equal(snapshot.keHoachId, 'kh-new');
  assert.equal(snapshot.nhaThauTrungThauId, null);
  assert.equal(snapshot.danhGiaHsdtMetadata, null);
  assert.deepEqual(snapshot.awardedPhanLoList, []);
  assert.deepEqual(snapshot.giaHanList, []);
  assert.equal(snapshot.phanLoList[0].id, undefined);
  assert.equal(snapshot.phanLoList[0].nhaThauTrungThauId, null);
  assert.equal(snapshot.tuyChonMuaThemList[0].id, undefined);
});

test('creates initial and next versions with stable root id', () => {
  const initial = createInitialVersion({ name: 'A' }, { id: 'entity-00', timestamp: '2026-07-12 10:00:00' });
  const records = [initial];
  const next = createNextVersion(records, initial, { name: 'B' }, { id: 'entity-01', timestamp: '2026-07-13 10:00:00' });
  assert.equal(initial.isLatest, 0);
  assert.equal(next.rootId, 'entity-00');
  assert.equal(next.phienBan, '01');
  assert.equal(getNextVersion([...records, next], next), '02');
});

test('uses server pagination metadata when calculating the next version', () => {
  const selected = {
    id: 'entity-01',
    rootId: 'entity-00',
    phienBan: '01',
    allVersions: [
      { id: 'entity-03', phienBan: '03' },
      { id: 'entity-02', phienBan: '02' },
      { id: 'entity-01', phienBan: '01' },
      { id: 'entity-00', phienBan: '00' }
    ]
  };
  assert.equal(getNextVersion([selected], selected), '04');
});

test('remembers the version just saved so the UI does not keep showing an older image', () => {
  const state = {};
  rememberSelectedVersion(state, 'selectedNhaThauVersion', { id: 'nt-01', rootId: 'nt-00' });
  assert.equal(state.selectedNhaThauVersion['nt-00'], 'nt-01');
});

test('removes latest or all versions while maintaining latest marker', () => {
  const records = [
    { id: 'entity-00', rootId: 'entity-00', phienBan: '00', isLatest: 0 },
    { id: 'entity-01', rootId: 'entity-00', phienBan: '01', isLatest: 1 }
  ];
  const latestResult = removeLatestVersion(records, records[1]);
  assert.deepEqual(latestResult.removed.map(item => item.id), ['entity-01']);
  assert.equal(latestResult.records[0].isLatest, 1);
  assert.deepEqual(removeAllVersions(records, records[0]).records, []);
});

test('prevents deleting versions referenced by another table', () => {
  const versions = [{ id: 'kh-00' }, { id: 'kh-01' }];
  const blocked = canDeleteVersions(versions, [{
    name: 'goithau', records: [{ id: 'gt-1', keHoachId: 'kh-01' }], foreignKey: 'keHoachId'
  }]);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.references[0].relation, 'goithau');
  assert.equal(canDeleteVersions(versions, [{ records: [], foreignKey: 'keHoachId' }]).allowed, true);
});
