import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExtensionRows } from './packageValidation.js';

test('validateExtensionRows accepts increasing extension rows', () => {
    const result = validateExtensionRows('05/07/2026 09:00', [
        { timeStr: '05/07/2026 10:00', reason: 'Gia hạn lần 1' },
        { timeStr: '05/07/2026 11:00', reason: 'Gia hạn lần 2' }
    ]);

    assert.equal(result.valid, true);
    assert.deepEqual(result.rows, [
        { timeStr: '05/07/2026 10:00', reason: 'Gia hạn lần 1' },
        { timeStr: '05/07/2026 11:00', reason: 'Gia hạn lần 2' }
    ]);
});

test('validateExtensionRows requires time and reason', () => {
    const result = validateExtensionRows('05/07/2026 09:00', [
        { timeStr: '05/07/2026 10:00', reason: '' }
    ]);

    assert.equal(result.valid, false);
    assert.match(result.error, /Vui lòng nhập đầy đủ/);
});

test('validateExtensionRows rejects non-increasing times', () => {
    const result = validateExtensionRows('05/07/2026 09:00', [
        { timeStr: '05/07/2026 08:00', reason: 'Sai giờ' }
    ]);

    assert.equal(result.valid, false);
    assert.match(result.error, /phải lớn hơn thời gian đóng thầu gốc/);
});
