import assert from "node:assert/strict";
import test from "node:test";

import {
  getWordColumnLabel,
  getWordSourceTableLabel,
} from "../../frontend/documents/wordVariableManifest.js";

test("Word labels come from one shared manifest", () => {
  assert.equal(getWordSourceTableLabel("goi_thau"), "Gói thầu");
  assert.equal(
    getWordColumnLabel("chu_dau_tu", "ma_so_thue"),
    "Mã số thuế",
  );
  assert.equal(getWordSourceTableLabel("unknown"), "unknown");
});
