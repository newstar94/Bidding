import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WORD_VARIABLES,
  getWordColumnLabel,
  getWordSourceTableLabel,
} from "../../frontend/documents/wordVariableManifest.js";

test("Word labels come from one shared manifest", () => {
  assert.equal(getWordSourceTableLabel("goi_thau"), "Gói thầu");
  assert.equal(
    getWordSourceTableLabel("goi_thau_versions"),
    "Danh sách phiên bản của gói thầu",
  );
  assert.equal(
    getWordSourceTableLabel("goi_thau_trong_ke_hoach"),
    "Danh sách gói thầu trong kế hoạch",
  );
  assert.equal(
    getWordSourceTableLabel("ke_hoach_versions"),
    "Danh sách phiên bản của kế hoạch LCNT",
  );
  assert.equal(
    getWordColumnLabel("chu_dau_tu", "ma_so_thue"),
    "Mã số thuế",
  );
  assert.equal(getWordSourceTableLabel("unknown"), "unknown");
  assert.equal(
    getWordColumnLabel("ke_hoach_lcnt", "tong_muc_dau_tu"),
    "Tổng mức đầu tư dự án / Tổng dự toán",
  );
  assert.ok(
    DEFAULT_WORD_VARIABLES.some(
      (field) =>
        field.name === "tong_muc_dau_tu_du_toan" &&
        field.sourceTable === "ke_hoach_lcnt" &&
        field.sourceColumn === "tong_muc_dau_tu",
    ),
  );
});
