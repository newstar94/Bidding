import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORD_VARIABLES,
  FIELD_METADATA_BY_TABLE,
  getWordColumnLabel,
  getWordSourceTableLabel,
} from "../../frontend/documents/wordVariableManifest.js";

const FORBIDDEN_TYPO_FRAGMENTS = [
  "chu đấu tu",
  "chức vu",
  "đại điện",
  "người dung đấu",
  "noi mở",
  "tài khoan",
  "điện thoai",
  "chung chỉ",
  "mở ta",
  "dam bảo",
  "giá trung",
  "hinh thực",
  "lựa chon",
  "loai ",
  "quyết dinh",
  "ket qua",
  "phuong phap",
  "phuong thực",
  "bat đấu",
  "to chức",
  "đăng tài",
  "hợp đóng",
  "thực hien",
  "trạng thai",
  "ký thuat",
  "ty le",
  "phê duyet",
  "dự an",
  "dự toan",
  "ngan hang",
  "giam giá",
  "phan lo",
  "danh giá",
  "nang luc",
  "tài chinh",
  "lam ro",
  "nguyen nhan",
  "ho tên",
  "đăng nhap",
  "tên to chức",
  "tong số",
  " khong ",
  " duoc ",
];

test("Word dictionary uses reviewed Vietnamese procurement labels", () => {
  assert.equal(getWordSourceTableLabel("goi_thau"), "Gói thầu");
  assert.equal(getWordColumnLabel("chu_dau_tu", "ma_chu_dau_tu"), "Mã chủ đầu tư");
  assert.equal(getWordColumnLabel("chu_dau_tu", "ten_chu_dau_tu"), "Tên chủ đầu tư");
  assert.equal(getWordColumnLabel("nha_thau", "anh_dau"), "Ảnh dấu nhà thầu");
  assert.equal(
    getWordColumnLabel("goi_thau", "hinh_thuc_lua_chon"),
    "Hình thức lựa chọn nhà thầu",
  );
});

test("generated Word dictionary contains none of the known typo fragments", () => {
  const metadataLabels = Object.values(FIELD_METADATA_BY_TABLE)
    .flatMap((fields) => Object.values(fields))
    .map((field) => field.label);
  const labels = [
    ...metadataLabels,
    ...DEFAULT_WORD_VARIABLES.map((field) => field.label),
  ];

  labels.forEach((label) => {
    const normalized = String(label).toLocaleLowerCase("vi");
    FORBIDDEN_TYPO_FRAGMENTS.forEach((fragment) => {
      assert.equal(
        normalized.includes(fragment),
        false,
        `Nhãn còn lỗi chính tả “${fragment}”: ${label}`,
      );
    });
  });
});
