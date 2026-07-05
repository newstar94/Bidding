import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canSaveOpeningInfo,
    getAwardRequiredFieldIds,
    validateOpeningTime
} from './bidProcessValidation.js';

test('canSaveOpeningInfo blocks regular package after next evaluation step is saved', () => {
    const gt = {
        trangThai: 'Đang chấm thầu',
        phuongThucLuaChon: 'Một giai đoạn một túi hồ sơ',
        danhGiaHsdtMetadata: JSON.stringify({ saved: true })
    };

    assert.equal(canSaveOpeningInfo(gt), false);
});

test('canSaveOpeningInfo allows direct package until result is saved', () => {
    const gt = {
        trangThai: 'Đang chấm thầu',
        hinhThucLuaChon: 'Chỉ định thầu rút gọn'
    };

    assert.equal(canSaveOpeningInfo(gt), true);
});

test('validateOpeningTime rejects opening time before closing time', () => {
    const result = validateOpeningTime({
        thoiGianDongThau: '2026-07-05T10:00:00',
        thoiGianMoThau: '2026-07-05T09:59:00'
    }, () => '05/07/2026 10:00');

    assert.equal(result.valid, false);
    assert.match(result.message, /Thời gian mở thầu/);
});

test('getAwardRequiredFieldIds includes capacity report date only when needed', () => {
    const ids = getAwardRequiredFieldIds({
        isDirectOrSpecial: true,
        danhGiaNangLucVal: 'Có',
        hasField: id => id === 'award-so-bctd'
    });

    assert.deepEqual(ids, [
        'award-decision-no',
        'award-decision-date',
        'award-so-bctd',
        'date-yeu-cau-bao-gia',
        'date-gui-bao-gia',
        'date-bao-cao-danh-gia',
        'date-moi-thuong-thao',
        'date-thuong-thao',
        'date-trinh-ket-qua'
    ]);
});
