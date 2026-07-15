import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContractorVersion, selectPartnerVersionForDate } from '../../frontend/partners/contractorVersionBinding.js';

const versions = [
  { id: 'nt-00', rootId: 'nt-00', phienBan: '00', ngayApDung: '2026-03-01' },
  { id: 'nt-01', rootId: 'nt-00', phienBan: '01', ngayApDung: '2026-07-20' },
  { id: 'nt-02', rootId: 'nt-00', phienBan: '02', ngayApDung: '2026-09-01' }
];

test('uses version 00 for a business date before the first effective date', () => {
  assert.equal(selectPartnerVersionForDate(versions, 'nt-02', '2026-01-01')?.id, 'nt-00');
});

test('uses the closest effective version without crossing the business date', () => {
  assert.equal(selectPartnerVersionForDate(versions, 'nt-00', '2026-08-15')?.id, 'nt-01');
});

test('keeps an exact binding when no business date is supplied', () => {
  assert.equal(selectPartnerVersionForDate(versions, 'nt-01', '')?.id, 'nt-01');
});

test('resolves a joint-venture member by exact version id before its code', () => {
  const model = { state: { nhathau: [
    { id: 'nt-00', maNhaThau: 'vn123', tenNhaThau: 'Tên phiên bản 00', phienBan: '00', isLatest: 0 },
    { id: 'nt-01', maNhaThau: 'vn123', tenNhaThau: 'Tên phiên bản 01', phienBan: '01', isLatest: 1 }
  ] } };
  assert.equal(resolveContractorVersion(model, { thanhVienNhaThauId: 'nt-00', maNhaThau: 'vn123' })?.id, 'nt-00');
});

test('resolves a legacy joint-venture member by contractor code when id is missing', () => {
  const model = { state: { nhathau: [
    { id: 'nt-00', maNhaThau: 'vn6200063569', phienBan: '00', isLatest: 1 }
  ] } };
  assert.equal(resolveContractorVersion(model, { maSoThue: '6200063569' })?.id, 'nt-00');
});
