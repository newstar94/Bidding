import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizePlanBasisRows,
} from "../../frontend/plans/PlanBasisEditor.js";

test("plan basis editor payload preserves order and ids while stripping projection", () => {
  assert.deepEqual(sanitizePlanBasisRows([
    { id: "khcc-2", noiDungGoc: "  Căn cứ thứ hai  ", parseStatus: "PARTIAL" },
    { id: "khcc-1", noiDungGoc: "Căn cứ thứ nhất", tenCanCu: "Quyết định" },
    { noiDungGoc: "   " },
  ]), [
    { id: "khcc-2", noiDungGoc: "Căn cứ thứ hai" },
    { id: "khcc-1", noiDungGoc: "Căn cứ thứ nhất" },
  ]);
});
