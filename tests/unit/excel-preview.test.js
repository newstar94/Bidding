import assert from "node:assert/strict";
import test from "node:test";

import { getExcelPreviewKeys } from "../../frontend/packages/GoiThauModals.js";

test("Excel preview hides every internal metadata column", () => {
  assert.deepEqual(
    getExcelPreviewKeys({
      hoTen: "Nguyễn Văn A",
      soChungChi: "C01.01.00001",
      _valid: true,
      _comment: "Hợp lệ",
      _operation: "create",
      _futureMetadata: "internal"
    }),
    ["hoTen", "soChungChi"]
  );
});

test("Excel preview accepts wrapped row data", () => {
  assert.deepEqual(
    getExcelPreviewKeys({ data: { maGoiThau: "gói-01", _operation: "update" } }),
    ["maGoiThau"]
  );
});
