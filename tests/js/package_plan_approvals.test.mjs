import assert from "node:assert/strict";
import test from "node:test";

import {
  linkedPlanIdsForPackage,
  resolveLinkedPlanSnapshot,
  resolvePackagePlanApprovals,
} from "../../frontend/packages/detail/packagePlanApprovals.js";

function fixture() {
  const packageV0 = {
    id: "gt-v0",
    rootId: "gt-root",
    keHoachId: "kh-v0",
  };
  const packageV1 = {
    id: "gt-v1",
    rootId: "gt-root",
    keHoachId: "kh-v1",
  };
  const packageV2 = {
    id: "gt-v2",
    rootId: "gt-root",
    keHoachId: "kh-v2",
  };
  return {
    packageV0,
    model: {
      state: {
        goithau: [packageV0, packageV1, packageV2],
        kehoach: [
          {
            id: "kh-v0", phienBan: "00", quyetDinhPheDuyet: "01/QĐ-A",
            ngayPheDuyet: "2026-01-05", pheDuyet: "Dự toán và kế hoạch",
          },
          {
            id: "kh-v1", phienBan: "01", quyetDinhPheDuyet: "01/QĐ-A",
            ngayPheDuyet: "05/01/2026", pheDuyet: "Dự toán và kế hoạch",
          },
          {
            id: "kh-v2", phienBan: "02", quyetDinhPheDuyet: "02/QĐ-A",
            ngayPheDuyet: "2026-02-10", pheDuyet: "Kế hoạch",
          },
        ],
      },
      getLatestPlan() {
        return this.state.kehoach[2];
      },
    },
  };
}

test("package approvals include every linked plan version and collapse duplicate decision/date pairs", () => {
  const { model, packageV0 } = fixture();
  assert.deepEqual(linkedPlanIdsForPackage(model, packageV0), ["kh-v0", "kh-v1", "kh-v2"]);
  assert.deepEqual(resolvePackagePlanApprovals(model, packageV0), [
    {
      decisionNumber: "01/QĐ-A",
      approvalDate: "2026-01-05",
      approvalType: "Phê duyệt dự toán và kế hoạch",
      planVersions: ["00", "01"],
    },
    {
      decisionNumber: "02/QĐ-A",
      approvalDate: "2026-02-10",
      approvalType: "Phê duyệt kế hoạch",
      planVersions: ["02"],
    },
  ]);
});

test("detail resolves the exact package-linked plan snapshot before latest fallback", () => {
  const { model, packageV0 } = fixture();
  assert.equal(resolveLinkedPlanSnapshot(model, packageV0)?.id, "kh-v0");
});
