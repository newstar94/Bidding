import assert from 'node:assert/strict';
import test from 'node:test';

import { collectOpeningBidsFromRows, validateOpeningJointVentureMembers } from './bidProcessOpeningData.js';

function createOpeningRow(leadCode, members = []) {
    const classes = new Set();
    const leadInput = { value: leadCode };
    return {
        _thanhVienLienDanh: members,
        classList: {
            add(name) {
                classes.add(name);
            },
            remove(name) {
                classes.delete(name);
            },
            contains(name) {
                return classes.has(name);
            }
        },
        querySelector(selector) {
            return selector === '.mt-ma-nha-thau' ? leadInput : null;
        }
    };
}

test('validateOpeningJointVentureMembers accepts unique member tax codes', () => {
    const row = createOpeningRow('0107659123', [
        { maSoThue: '0107659124' },
        { maSoThue: '0107659125' }
    ]);

    const result = validateOpeningJointVentureMembers([row]);

    assert.equal(result.valid, true);
    assert.equal(result.invalidInputs.length, 0);
    assert.equal(row.classList.contains('invalid'), false);
});

test('validateOpeningJointVentureMembers rejects duplicate lead and member tax code', () => {
    const row = createOpeningRow('0107659123', [
        { maSoThue: '0107659123' }
    ]);

    const result = validateOpeningJointVentureMembers([row]);

    assert.equal(result.valid, false);
    assert.equal(result.invalidInputs.length, 1);
    assert.equal(row.classList.contains('invalid'), true);
});

test('validateOpeningJointVentureMembers rejects duplicate tax code with vn prefix', () => {
    const row = createOpeningRow('vn0108955340', [
        { maSoThue: '0108955340' }
    ]);

    const result = validateOpeningJointVentureMembers([row]);

    assert.equal(result.valid, false);
    assert.equal(result.invalidInputs.length, 1);
    assert.equal(row.classList.contains('invalid'), true);
});

test('validateOpeningJointVentureMembers rejects duplicate tax codes between members', () => {
    const row = createOpeningRow('0107659123', [
        { maSoThue: '0107659124' },
        { maSoThue: ' 0107659124 ' }
    ]);

    const result = validateOpeningJointVentureMembers([row]);

    assert.equal(result.valid, false);
    assert.equal(result.invalidInputs.length, 1);
    assert.equal(row.classList.contains('invalid'), true);
});

test('collectOpeningBidsFromRows accepts array-like rows without map', () => {
    const fields = {
        '.mt-ma-nha-thau': { value: '0107659123' },
        '.mt-ten-nha-thau': { value: 'Nha thau A' },
        '.mt-loai-nha-thau': { value: 'Độc lập' },
        '.mt-ty-le-giam-gia': { value: '0' }
    };
    const row = {
        getAttribute(name) {
            return name === 'data-id' ? 'bid-1' : '';
        },
        querySelector(selector) {
            return fields[selector] || { value: '' };
        }
    };
    const rowsLikeNodeList = {
        0: row,
        length: 1,
        forEach(callback) {
            callback(row, 0);
        }
    };
    const model = {
        getLatestNhaThau() {
            return [{ id: 'nt-1', maNhaThau: '0107659123', tenNhaThau: 'Nha thau A', loaiNhaThau: 'Độc lập' }];
        },
        parseVND() {
            return 0;
        },
        state: { nhathau: [] },
        persistData() {}
    };

    const bids = collectOpeningBidsFromRows({
        rows: rowsLikeNodeList,
        gtId: 'gt-1',
        model,
        isDirectOrSpecial: false
    });

    assert.equal(bids.length, 1);
    assert.equal(bids[0].id, 'bid-1');
    assert.equal(bids[0].nhaThauId, 'nt-1');
});

test('collectOpeningBidsFromRows saves joint venture lead and sub members', () => {
    const fields = {
        '.mt-ma-nha-thau': { value: 'vn3700224226' },
        '.mt-ten-nha-thau': { value: 'Lien danh A-B' },
        '.mt-loai-nha-thau': { value: 'Liên danh' },
        '.mt-ty-le-giam-gia': { value: '0' }
    };
    const row = {
        _leadMemberName: 'Nha thau dung dau',
        _leadMemberLookupData: { diaChi: 'Dia chi lead', tenVietTat: 'LEAD' },
        _thanhVienLienDanh: [
            { maNhaThau: 'vn0108955340', maSoThue: '0108955340', tenNhaThau: 'Nha thau thanh vien', diaChi: 'Dia chi thanh vien' }
        ],
        getAttribute(name) {
            return name === 'data-id' ? 'bid-jv-1' : '';
        },
        querySelector(selector) {
            return fields[selector] || { value: '' };
        }
    };
    const model = {
        getLatestNhaThau() {
            return [{
                id: 'nt-jv-1',
                maNhaThau: 'vn3700224226',
                tenNhaThau: 'Lien danh A-B',
                loaiNhaThau: 'Liên danh',
                thanhVienLienDanh: []
            }, {
                id: 'nt-member-1',
                maNhaThau: 'vn0108955340',
                tenNhaThau: 'Nha thau thanh vien',
                loaiNhaThau: 'Độc lập'
            }];
        },
        parseVND() {
            return 0;
        },
        state: { nhathau: [] },
        persistData() {}
    };

    const [bid] = collectOpeningBidsFromRows({
        rows: [row],
        gtId: 'gt-1',
        model,
        isDirectOrSpecial: false
    });

    assert.equal(bid.loaiNhaThau, 'Liên danh');
    assert.equal(bid.tenNhaThau, 'Lien danh A-B');
    assert.equal(bid.thanhVienLienDanh.length, 2);
    assert.deepEqual(
        bid.thanhVienLienDanh.map(member => member.vaiTro),
        ['Đứng đầu liên danh', 'Thành viên liên danh']
    );
    assert.equal(bid.thanhVienLienDanh[0].maSoThue, '3700224226');
    assert.equal(bid.thanhVienLienDanh[0].diaChi, 'Dia chi lead');
    assert.equal(bid.thanhVienLienDanh[1].maSoThue, '0108955340');
    assert.equal(bid.thanhVienLienDanh[1].diaChi, 'Dia chi thanh vien');
});

test('collectOpeningBidsFromRows falls back to contractor joint venture members', () => {
    const fields = {
        '.mt-ma-nha-thau': { value: 'vn3700224226' },
        '.mt-ten-nha-thau': { value: 'Lien danh A-B' },
        '.mt-loai-nha-thau': { value: 'Liên danh' },
        '.mt-ty-le-giam-gia': { value: '0' }
    };
    const row = {
        _leadMemberName: 'Nha thau dung dau',
        getAttribute(name) {
            return name === 'data-id' ? 'bid-jv-2' : '';
        },
        querySelector(selector) {
            return fields[selector] || { value: '' };
        }
    };
    const model = {
        getLatestNhaThau() {
            return [{
                id: 'nt-jv-1',
                maNhaThau: 'vn3700224226',
                tenNhaThau: 'Lien danh A-B',
                loaiNhaThau: 'Liên danh',
                thanhVienLienDanh: [
                    { maSoThue: 'vn3700224226', tenNhaThau: 'Nha thau dung dau', vaiTro: 'Đứng đầu liên danh' },
                    { maSoThue: 'vn0108955340', tenNhaThau: 'Nha thau thanh vien', vaiTro: 'Thành viên liên danh' }
                ]
            }];
        },
        parseVND() {
            return 0;
        },
        state: { nhathau: [] },
        persistData() {}
    };

    const [bid] = collectOpeningBidsFromRows({
        rows: [row],
        gtId: 'gt-1',
        model,
        isDirectOrSpecial: false
    });

    assert.equal(bid.thanhVienLienDanh.length, 2);
    assert.equal(bid.thanhVienLienDanh[1].tenNhaThau, 'Nha thau thanh vien');
});

test('collectOpeningBidsFromRows filters duplicate member matching lead after prefix normalization', () => {
    const fields = {
        '.mt-ma-nha-thau': { value: 'vn0108955340' },
        '.mt-ten-nha-thau': { value: 'Lien danh A-B' },
        '.mt-loai-nha-thau': { value: 'Liên danh' },
        '.mt-ty-le-giam-gia': { value: '0' }
    };
    const row = {
        _leadMemberName: 'Nha thau dung dau',
        _thanhVienLienDanh: [
            { maSoThue: '0108955340', tenNhaThau: 'Nha thau dung dau' },
            { maSoThue: 'vn3700224226', tenNhaThau: 'Nha thau thanh vien' }
        ],
        getAttribute(name) {
            return name === 'data-id' ? 'bid-jv-dup' : '';
        },
        querySelector(selector) {
            return fields[selector] || { value: '' };
        }
    };
    const model = {
        getLatestNhaThau() {
            return [
                { id: 'nt-lead', maNhaThau: 'vn0108955340', tenNhaThau: 'Nha thau dung dau', loaiNhaThau: 'Liên danh' },
                { id: 'nt-member', maNhaThau: 'vn3700224226', tenNhaThau: 'Nha thau thanh vien', loaiNhaThau: 'Độc lập' }
            ];
        },
        parseVND() {
            return 0;
        },
        state: { nhathau: [] },
        persistData() {}
    };

    const [bid] = collectOpeningBidsFromRows({
        rows: [row],
        gtId: 'gt-1',
        model,
        isDirectOrSpecial: false
    });

    assert.equal(bid.thanhVienLienDanh.length, 2);
    assert.equal(bid.thanhVienLienDanh[1].maSoThue, '3700224226');
});

test('collectOpeningBidsFromRows keeps contractor joint venture display name', () => {
    const fields = {
        '.mt-ma-nha-thau': { value: 'vn3700224226' },
        '.mt-ten-nha-thau': { value: 'Lien danh A-B' },
        '.mt-loai-nha-thau': { value: 'Liên danh' },
        '.mt-ty-le-giam-gia': { value: '0' }
    };
    const row = {
        _leadMemberName: 'Nha thau dung dau',
        _leadMemberLookupData: { diaChi: 'Dia chi lien danh', tenVietTat: 'LDAB' },
        _thanhVienLienDanh: [
            { maNhaThau: 'vn0108955340', maSoThue: '0108955340', tenNhaThau: 'Nha thau thanh vien', diaChi: 'Dia chi thanh vien' }
        ],
        getAttribute(name) {
            return name === 'data-id' ? 'bid-jv-3' : '';
        },
        querySelector(selector) {
            return fields[selector] || { value: '' };
        }
    };
    const contractor = {
        id: 'nt-jv-1',
        maNhaThau: 'vn3700224226',
        tenNhaThau: 'Lien danh A-B',
        loaiNhaThau: 'Liên danh',
        thanhVienLienDanh: []
    };
    const model = {
        getLatestNhaThau() {
            return [
                contractor,
                { id: 'nt-member-1', maNhaThau: 'vn0108955340', tenNhaThau: 'Nha thau thanh vien', loaiNhaThau: 'Độc lập' }
            ];
        },
        parseVND() {
            return 0;
        },
        state: { nhathau: [contractor] },
        persistData() {}
    };

    collectOpeningBidsFromRows({
        rows: [row],
        gtId: 'gt-1',
        model,
        isDirectOrSpecial: false
    });

    assert.equal(contractor.tenNhaThau, 'Lien danh A-B');
    assert.equal(contractor.maSoThue, '3700224226');
    assert.equal(contractor.diaChi, 'Dia chi lien danh');
});
