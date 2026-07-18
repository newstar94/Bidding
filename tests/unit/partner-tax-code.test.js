import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatPartnerIdentityCode,
    isVietnamTaxCode,
    normalizeOrganizationName,
    normalizePersonName,
    normalizeProcurementOrgCode,
    normalizeVietnamTaxCode
} from '../../frontend/app/domUtils.js';
import { findStoredPartnerLookupData, getPartnerLookupInput, lookupPartnerInfo } from '../../frontend/partners/partnerTaxLookup.js';
import {
    composeInternalAddress,
    parseStoredInternalAddress,
    parseVietnamAddress,
    splitAddressParts,
    stripVietnamCountrySuffix
} from '../../frontend/shared/PartnerHelpers.js';

test('normalizes procurement organization codes without deriving tax codes', () => {
    assert.equal(normalizeProcurementOrgCode('VN-0312345678'), 'vn0312345678');
    assert.equal(normalizeProcurementOrgCode('vnz 000050923'), 'vnz000050923');
    assert.equal(normalizeProcurementOrgCode('vnp.0312345678001'), 'vnp0312345678001');
    assert.equal(normalizeVietnamTaxCode('vn0312345678'), 'vn0312345678');
});

test('formats investor and contractor identity codes in lowercase for display', () => {
    assert.equal(formatPartnerIdentityCode(' VN3000166995 '), 'vn3000166995');
    assert.equal(formatPartnerIdentityCode('VNP0109965278'), 'vnp0109965278');
    assert.equal(formatPartnerIdentityCode('', '--'), '--');
});

test('keeps organization-code and tax-code lookup inputs independent', () => {
    assert.deepEqual(getPartnerLookupInput('vn0109965278'), { orgCode: 'vn0109965278', taxCode: '' });
    assert.deepEqual(getPartnerLookupInput('0109965278'), { orgCode: '', taxCode: '0109965278' });
    assert.equal(getPartnerLookupInput('NT-ECO'), null);
});

test('treats a successful empty partner lookup as a normal miss', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        found: false,
        code: 'PARTNER_NOT_FOUND'
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
    try {
        assert.equal(await lookupPartnerInfo({ orgCode: 'vn3000166995', partnerRole: 'CDT' }), null);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('uses a stored contractor before external lookup sources', () => {
    const result = findStoredPartnerLookupData([{
        maNhaThau: 'vn0104380600',
        maSoThue: '0104380600',
        tenNhaThau: 'Nhà thầu trong DB',
        nguoiDaiDien: 'Nguyễn Văn A'
    }], { orgCode: 'vn0104380600', partnerRole: 'NT' });

    assert.equal(result.source, 'DB');
    assert.equal(result.name, 'Nhà thầu trong DB');
    assert.equal(result.representative_name, 'Nguyễn Văn A');
});

test('uses a stored investor before external lookup sources', () => {
    const result = findStoredPartnerLookupData([{
        maChuDauTu: 'vnz000050923',
        tenChuDauTu: 'Chủ đầu tư trong DB',
        daiDienCdt: 'Trần Thị B'
    }], { orgCode: 'vnz000050923', partnerRole: 'CDT' });

    assert.equal(result.source, 'DB');
    assert.equal(result.name, 'Chủ đầu tư trong DB');
    assert.equal(result.representative_name, 'Trần Thị B');
});

test('normalizes prefixed tax code values before validation and lookup', () => {
    assert.equal(normalizeVietnamTaxCode(' 0312 345 678 '), '0312345678');
    assert.equal(isVietnamTaxCode('vnp.0312345678-001'), false);
    assert.equal(isVietnamTaxCode('vn-abc'), false);
});

test('normalizes Vietnamese representative names to initial-capital form', () => {
    assert.equal(normalizePersonName('  ĐỖ   VĂN xỨNG '), 'Đỗ Văn Xứng');
    assert.equal(normalizePersonName("nguyễn thị minh-khai"), 'Nguyễn Thị Minh-Khai');
});

test('normalizes uniformly-cased organization names without damaging intentional mixed case', () => {
    assert.equal(
        normalizeOrganizationName('TRUNG TÂM CUNG ỨNG DỊCH VỤ CÔNG XÃ MƯỜNG HAM'),
        'Trung tâm cung ứng dịch vụ công xã Mường Ham'
    );
    assert.equal(normalizeOrganizationName('CÔNG TY TNHH MTV DỊCH VỤ AN PHÁT'), 'Công ty TNHH MTV dịch vụ an phát');
    assert.equal(normalizeOrganizationName('Công ty TNHH Dịch vụ An Phát'), 'Công ty TNHH Dịch vụ An Phát');
});

test('keeps ward and province once when composing an internal address', () => {
    const address = composeInternalAddress(
        'So 42 VSIP duong so 4, Khu cong nghiep Viet Nam - Singapore-Phuong Binh Hoa, Thanh pho Ho Chi Minh',
        'Phuong Binh Hoa',
        'Thanh pho Ho Chi Minh'
    );

    assert.equal(
        address,
        'So 42 VSIP duong so 4, Khu cong nghiep Viet Nam - Singapore | Phuong Binh Hoa | Thanh pho Ho Chi Minh'
    );
});

test('removes a trailing Vietnam country suffix before parsing an address', () => {
    assert.deepEqual(
        stripVietnamCountrySuffix([
            '86/11 Thống Nhất',
            'Phường Gò Vấp',
            'Thành phố Hồ Chí Minh',
            'Việt Nam'
        ]),
        ['86/11 Thống Nhất', 'Phường Gò Vấp', 'Thành phố Hồ Chí Minh']
    );
    assert.deepEqual(
        stripVietnamCountrySuffix(['86/11 Thống Nhất', 'Việt Nam', 'Phường Gò Vấp']),
        ['86/11 Thống Nhất', 'Phường Gò Vấp']
    );
});

test('splits a looked-up full address into detail, ward and province', async () => {
    globalThis._vietnamProvinces = [{ name: 'Thành phố Hồ Chí Minh', code: 79 }];
    globalThis._vietnamWards = { 79: [{ name: 'Phường Gò Vấp', code: 26884 }] };

    const parsed = await parseVietnamAddress(
        '86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam'
    );

    assert.equal(parsed.detail, '86/11 Thống Nhất');
    assert.equal(parsed.wardName, 'Phường Gò Vấp');
    assert.equal(parsed.provinceName, 'Thành phố Hồ Chí Minh');
});

test('splits a legacy address even when the administrative API is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    const originalProvinces = globalThis._vietnamProvinces;
    const originalWards = globalThis._vietnamWards;
    globalThis._vietnamProvinces = [];
    globalThis._vietnamWards = {};
    globalThis.fetch = async () => { throw new Error('offline'); };

    try {
        const parsed = await parseVietnamAddress(
            '86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam'
        );

        assert.equal(parsed.detail, '86/11 Thống Nhất');
        assert.equal(parsed.wardName, 'Phường Gò Vấp');
        assert.equal(parsed.provinceName, 'Thành phố Hồ Chí Minh');
        assert.equal(parsed.wardCode, '');
        assert.equal(parsed.provinceCode, '');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis._vietnamProvinces = originalProvinces;
        globalThis._vietnamWards = originalWards;
    }
});

test('keeps a legacy ward name when it is absent from the current catalog', async () => {
    globalThis._vietnamProvinces = [{ name: 'Thành phố Hồ Chí Minh', code: 79 }];
    globalThis._vietnamWards = { 79: [] };

    const parsed = await parseVietnamAddress(
        '86/11 Thống Nhất; Phường Gò Vấp; Thành phố Hồ Chí Minh; Việt Nam'
    );

    assert.deepEqual(splitAddressParts(parsed.formattedAddress), [
        '86/11 Thống Nhất',
        'Phường Gò Vấp',
        'Thành phố Hồ Chí Minh'
    ]);
    assert.equal(parsed.detail, '86/11 Thống Nhất');
    assert.equal(parsed.wardName, 'Phường Gò Vấp');
    assert.equal(parsed.provinceName, 'Thành phố Hồ Chí Minh');
    assert.equal(parsed.wardCode, '');
    assert.equal(parsed.provinceCode, 79);
});

test('marks a legacy comma-separated stored address for reparsing', () => {
    const parsed = parseStoredInternalAddress(
        '86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam'
    );

    assert.equal(parsed.requiresLookup, true);
    assert.equal(parsed.rawAddress, '86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam');
});

test('cleans duplicated administration from a malformed structured address', () => {
    const parsed = parseStoredInternalAddress(
        '86/11 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam | Phường Gò Vấp | Thành phố Hồ Chí Minh'
    );

    assert.equal(parsed.requiresLookup, false);
    assert.equal(parsed.detail, '86/11 Thống Nhất');
    assert.equal(parsed.wardName, 'Phường Gò Vấp');
    assert.equal(parsed.provinceName, 'Thành phố Hồ Chí Minh');
});
