import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpeningActionState,
  buildOpeningContractorIdentity,
} from "../../frontend/packages/bidProcessOpeningState.js";

test("opening-state seam preserves explicit action and contractor identity contracts", () => {
  const pkg = {
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  assert.equal(buildOpeningActionState({ pkg, hasSavedOpeningData: true }).actionMode, "edit");
  assert.match(buildOpeningContractorIdentity({
    value: "Nhà thầu A",
    className: "contractor-name",
    contractorVersionId: "contractor-1",
    violationStatus: "VIOLATION_CONFIRMED",
  }), /bidder-name--violator/);
});
