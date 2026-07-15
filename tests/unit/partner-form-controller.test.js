import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectPartnerFormData,
  createPartnerLookupHandlers,
  mapPartnerLookupFields,
  PARTNER_FORM_CONFIGS,
  validatePartnerRecord
} from '../../frontend/partners/PartnerFormController.js';

const config = {
  codeId: 'code', taxId: 'tax', nameId: 'name', shortNameId: 'short',
  representativeId: 'representative', representativePositionId: 'position',
  phoneId: 'phone', emailId: 'email', bankAccountId: 'account', bankNameId: 'bank',
  extraFields: { bank_code: 'bankCode' },
  address: { detailInputId: 'detail', provinceSelectId: 'province', wardSelectId: 'ward' }
};

test('maps common partner lookup data from one configuration', () => {
  const mapped = mapPartnerLookupFields({
    org_code: 'vn0101', tax_code: '0101', name: 'CÔNG TY A',
    representative_name: 'NGUYỄN VĂN A', bank_code: '970422'
  }, config);
  assert.equal(mapped.code, 'vn0101');
  assert.equal(mapped.tax, '0101');
  assert.equal(mapped.name, 'Công ty a');
  assert.equal(mapped.representative, 'Nguyễn Văn A');
  assert.equal(mapped.bankCode, '970422');
});

test('partner lookup handlers clear and apply address consistently', async () => {
  const controls = Object.fromEntries(
    ['code','tax','name','short','representative','position','phone','email','account','bank','bankCode','detail','province','ward']
      .map(id => [id, { value: 'old', innerHTML: '', disabled: false }])
  );
  const root = { getElementById: id => controls[id] || null };
  const form = { dataset: { diaChiGoc: 'old' } };
  let appliedAddress = '';
  const handlers = createPartnerLookupHandlers({
    form, config, root,
    applyAddress: async address => { appliedAddress = address; }
  });
  controls.code.value = 'vn1234567890';
  controls.tax.value = '1234567890';
  handlers.clearLookupData();
  assert.equal(controls.code.value, 'vn1234567890');
  assert.equal(controls.tax.value, '1234567890');
  assert.equal(controls.name.value, '');
  assert.equal(controls.ward.disabled, true);
  await handlers.applyLookupData({ name: 'Công ty B', address: 'Hà Nội' });
  assert.equal(controls.name.value, 'Công ty B');
  assert.equal(form.dataset.diaChiGoc, 'Hà Nội');
  assert.equal(appliedAddress, 'Hà Nội');
});

test('shared partner form collection keeps optional tax and bank fields', () => {
  const partnerConfig = PARTNER_FORM_CONFIGS.nhathau;
  const controls = {};
  Object.values(partnerConfig.fields).forEach(field => {
    const id = typeof field === 'string' ? field : field.target;
    controls[id] = { value: '', type: 'text' };
  });
  controls['nt-ma'].value = ' VN01 ';
  controls['nt-ten'].value = 'CÔNG TY A';
  controls['nt-ngayapdung'].value = '13/07/2026';
  controls['nt-sotaikhoan'].value = '';
  controls['nt-noimotaikhoan'].value = '';
  controls['nt-diachichitiet'] = { value: 'Số 1' };
  controls['nt-tinh'] = { selectedIndex: 0, options: [{ getAttribute: () => 'Hà Nội' }] };
  controls['nt-xa'] = { selectedIndex: 0, options: [{ getAttribute: () => 'Phường A' }] };
  const root = { getElementById: id => controls[id] || null };
  const data = collectPartnerFormData(root, { dataset: {} }, partnerConfig, {
    convertDate: () => '2026-07-13'
  });
  assert.equal(data.maNhaThau, 'VN01');
  assert.equal(data.tenNhaThau, 'Công ty a');
  assert.equal(data.maSoThue, '');
  assert.equal(data.soTaiKhoan, '');
  assert.equal(data.noiMoTaiKhoan, '');
  assert.equal(data.diaChi, 'Số 1 | Phường A | Hà Nội');
});

test('partner validation keeps investor tax and contractor bank fields optional', () => {
  assert.deepEqual(validatePartnerRecord({
    maChuDauTu: 'VN01', maSoThue: '', soDienThoai: '', email: ''
  }, [], '', PARTNER_FORM_CONFIGS.chudautu), []);
  assert.deepEqual(validatePartnerRecord({
    maNhaThau: 'VN02', maSoThue: '', soTaiKhoan: '', noiMoTaiKhoan: '', soDienThoai: '', email: ''
  }, [], '', PARTNER_FORM_CONFIGS.nhathau), []);
});

test('partner validation reports duplicate identity and invalid contact fields', () => {
  const errors = validatePartnerRecord({
    maNhaThau: 'VN01', maSoThue: '123', soDienThoai: '12', email: 'invalid'
  }, [{ id: 'nt-1', rootId: 'nt-1', maNhaThau: 'vn01', maSoThue: '0101234567' }], '', PARTNER_FORM_CONFIGS.nhathau);
  assert.deepEqual(errors.map(error => error.controlId), ['nt-ma', 'nt-mst', 'nt-sdt', 'nt-email']);
});

test('partner validation ignores other versions of the record being edited', () => {
  const records = [
    { id: 'nt-v00', rootId: 'nt-root', maNhaThau: 'VN01', maSoThue: '0101234567' },
    { id: 'nt-v01', rootId: 'nt-root', maNhaThau: 'VN01', maSoThue: '0101234567' }
  ];
  assert.deepEqual(validatePartnerRecord({
    maNhaThau: 'VN01', maSoThue: '0101234567', soDienThoai: '', email: ''
  }, records, 'nt-v01', PARTNER_FORM_CONFIGS.nhathau), []);
});
