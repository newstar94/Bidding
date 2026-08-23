import assert from "node:assert/strict";
import test from "node:test";

import {
  getApprovedShortDateFormulaSuggestion,
  getDerivedWordVariableCodes,
  matchesWordVariableSearch,
  normalizeWordVariableSearch,
} from "../../frontend/documents/wordVariablePresentation.js";

test("Word money and date mappings expose their derived copy-ready codes", () => {
  assert.deepEqual(getDerivedWordVariableCodes("gia_gt", "currency"), [
    { code: "{bangchu_gia_gt}", label: "Bằng chữ" },
  ]);
  assert.deepEqual(getDerivedWordVariableCodes("tg_dang_tai_kh", "datetime"), [
    { code: "{S_tg_dang_tai_kh}", label: "Ngày ngắn (05/3/2026)" },
  ]);
  assert.deepEqual(getDerivedWordVariableCodes("{ngay_phe_duyet}", "date"), [
    { code: "{S_ngay_phe_duyet}", label: "Ngày ngắn (05/3/2026)" },
  ]);
  assert.deepEqual(getDerivedWordVariableCodes("ten_goi_thau", "text"), []);
});

test("Word-variable search is accent-insensitive across code, meaning and source", () => {
  const searchableValues = [
    "{gia_gt}",
    "{bangchu_gia_gt}",
    "Giá gói thầu",
    "Gói thầu",
    "gia_goi_thau",
  ];

  assert.equal(matchesWordVariableSearch("bangchu_gia", searchableValues), true);
  assert.equal(matchesWordVariableSearch("gia goi thau", searchableValues), true);
  assert.equal(matchesWordVariableSearch("nguồn không tồn tại", searchableValues), false);
  assert.equal(normalizeWordVariableSearch("Gói thầu"), "goi thau");
});

test("computed Word date guidance uses the approved short-date convention", () => {
  assert.deepEqual(getApprovedShortDateFormulaSuggestion(), {
    label: "Ngày ngắn (05/3/2026)",
    formula: "formatDate(__var__)",
  });
});
