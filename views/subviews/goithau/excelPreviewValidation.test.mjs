import assert from 'node:assert/strict';
import test from 'node:test';

import { getExcelPreviewFieldError } from './excelPreviewValidation.js';

test('validates required package fields and numeric package price', () => {
    assert.equal(
        getExcelPreviewFieldError('goithau', 'tenGoiThau', ''),
        'Tên gói thầu không được để trống'
    );
    assert.equal(
        getExcelPreviewFieldError('goithau', 'giaGoiThau', '-1'),
        'Giá gói thầu không được nhỏ hơn 0'
    );
    assert.equal(getExcelPreviewFieldError('goithau', 'giaGoiThau', '1000'), null);
});

test('validates contractor tax code and email fields', () => {
    assert.equal(
        getExcelPreviewFieldError('nhathau', 'maSoThue', 'abc'),
        'Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)'
    );
    assert.equal(
        getExcelPreviewFieldError('nhathau', 'email', 'invalid'),
        'Email không đúng định dạng'
    );
    assert.equal(getExcelPreviewFieldError('nhathau', 'email', 'test@example.com'), null);
});

test('validates expert CCCD field', () => {
    assert.equal(
        getExcelPreviewFieldError('chuyengia', 'soCCCD', '123'),
        'Số Căn cước công dân phải gồm đúng 12 chữ số'
    );
    assert.equal(getExcelPreviewFieldError('chuyengia', 'soCCCD', '123456789012'), null);
});
