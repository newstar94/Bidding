import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteAllPackageVersions,
  deleteLatestPackageVersion,
  getPackageDeleteContext
} from '../../frontend/packages/packageDeleteHelpers.js';
import {
  applyAutoPassedEvaluation,
  applyResultRowsToBids
} from '../../frontend/packages/bidProcessAwardResult.js';
import {
  validateOpeningJointVentureMembers,
  validateOpeningRows
} from '../../frontend/packages/bidProcessOpeningData.js';

function createDeletionModel() {
  const deletions = [];
  return {
    deletions,
    state: {
      goithau: [
        { id: 'gt-00', rootId: 'gt-00', keHoachId: 'kh-1', phienBan: '00', isLatest: 0 },
        { id: 'gt-01', rootId: 'gt-00', keHoachId: 'kh-1', phienBan: '01', isLatest: 1 }
      ],
      thongtinmothau: [
        { id: 'bid-00', goiThauId: 'gt-00' },
        { id: 'bid-01', goiThauId: 'gt-01' }
      ]
    },
    markDeleted(table, ids) {
      deletions.push({ table, ids: Array.isArray(ids) ? ids : [ids] });
    }
  };
}

test('deleting the latest package version restores the previous version and removes its bids', () => {
  const model = createDeletionModel();
  const context = getPackageDeleteContext(model.state.goithau, 'gt-01');

  deleteLatestPackageVersion(model, context);

  assert.deepEqual(model.state.goithau.map(item => item.id), ['gt-00']);
  assert.equal(model.state.goithau[0].isLatest, 1);
  assert.deepEqual(model.state.thongtinmothau.map(item => item.id), ['bid-00']);
  assert.deepEqual(model.deletions, [
    { table: 'goithau', ids: ['gt-01'] },
    { table: 'thongtinmothau', ids: ['bid-01'] }
  ]);
});

test('deleting all package versions also removes every linked opening bid', () => {
  const model = createDeletionModel();
  const context = getPackageDeleteContext(model.state.goithau, 'gt-00');

  deleteAllPackageVersions(model, context);

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(model.state.thongtinmothau, []);
});

test('server pagination metadata exposes every package version for one complete deletion', () => {
  const deletions = [];
  const model = {
    deletions,
    state: {
      goithau: [{
        id: 'gt-02',
        rootId: 'gt-00',
        keHoachId: 'kh-1',
        phienBan: '02',
        isLatest: 1,
        allVersions: [
          { id: 'gt-02', phienBan: '02' },
          { id: 'gt-01', phienBan: '01' },
          { id: 'gt-00', phienBan: '00' }
        ]
      }],
      thongtinmothau: [{ id: 'bid-02', goiThauId: 'gt-02' }]
    },
    markDeleted(table, ids) {
      deletions.push({ table, ids: Array.isArray(ids) ? ids : [ids] });
    }
  };
  const context = getPackageDeleteContext(model.state.goithau, 'gt-02');
  assert.equal(context.versionCount, 3);
  assert.deepEqual(context.relatedIds, ['gt-02', 'gt-01', 'gt-00']);

  deleteAllPackageVersions(model, context);

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(deletions[0], { table: 'goithau', ids: ['gt-02', 'gt-01', 'gt-00'] });
});

function fakeInput(value = '') {
  return { value, classList: { add() {}, remove() {} } };
}

function fakeOpeningRow({ code = '', name = '', members = [] } = {}) {
  const inputs = {
    '.mt-ma-nha-thau': fakeInput(code),
    '.mt-ten-nha-thau': fakeInput(name)
  };
  return {
    _thanhVienLienDanh: members,
    classList: { add() {}, remove() {} },
    querySelector(selector) { return inputs[selector] || null; }
  };
}

test('opening validation rejects missing contractor identity and duplicate joint-venture members', () => {
  const missing = fakeOpeningRow({ code: '', name: '' });
  const duplicate = fakeOpeningRow({
    code: 'vn0101234567',
    name: 'Liên danh A - B',
    members: [{ maNhaThau: 'VN-0101234567' }]
  });

  assert.equal(validateOpeningRows([missing]).valid, false);
  assert.equal(validateOpeningJointVentureMembers([duplicate]).valid, false);
});

test('automatic evaluation marks direct-selection bids as passed without discarding metadata', () => {
  const gt = { danhGiaHsdtMetadata: JSON.stringify({ custom: 'keep' }) };
  const model = {
    state: { thongtinmothau: [{ id: 'bid-1' }] }
  };

  applyAutoPassedEvaluation({ gt, bids: [{ id: 'bid-1' }], model });

  const savedBid = model.state.thongtinmothau[0];
  const metadata = JSON.parse(gt.danhGiaHsdtMetadata);
  assert.equal(savedBid.danhGiaHopLe, 'Đạt');
  assert.equal(savedBid.danhGiaKetLuan, 'Đạt');
  assert.equal(savedBid.danhGiaTaiChinh, 'Xếp hạng 1');
  assert.equal(metadata.custom, 'keep');
  assert.equal(metadata.saved, true);
});

test('award result clears rejection reason for winners and keeps a reason for rejected bids', () => {
  const winnerStatus = fakeInput('trung');
  const loserStatus = fakeInput('truot');
  const loserReason = fakeInput('Không đạt kỹ thuật');
  const rows = [
    {
      getAttribute: () => 'bid-win',
      querySelector: selector => selector === '.row-status-select' ? winnerStatus : null
    },
    {
      getAttribute: () => 'bid-lose',
      querySelector: selector => selector === '.row-status-select' ? loserStatus : loserReason
    }
  ];
  const model = {
    state: {
      thongtinmothau: [
        { id: 'bid-win', lyDoTruot: 'old' },
        { id: 'bid-lose', lyDoTruot: '' }
      ]
    }
  };

  applyResultRowsToBids({ querySelectorAll: () => rows }, model);

  assert.equal(model.state.thongtinmothau[0].lyDoTruot, '');
  assert.equal(model.state.thongtinmothau[1].lyDoTruot, 'Không đạt kỹ thuật');
});
