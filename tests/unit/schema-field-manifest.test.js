import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WORD_VARIABLES,
  FIELD_METADATA_BY_TABLE
} from "../../frontend/documents/wordVariableManifest.js";

test("generated field manifest shares Word and Vietnamese formatting metadata", () => {
  const packageFields = FIELD_METADATA_BY_TABLE.goi_thau;
  assert.equal(packageFields.ngay_quyet_dinh_ket_qua.format, "date");
  assert.equal(packageFields.thoi_gian_mo_thau.format, "datetime");
  assert.equal(packageFields.gia_goi_thau.format, "currency");
  assert.ok(DEFAULT_WORD_VARIABLES.some((item) => (
    item.name === "gia_gt"
    && item.sourceTable === "goi_thau"
    && item.sourceColumn === "gia_goi_thau"
  )));
});
