import assert from "node:assert/strict";
import test from "node:test";

import { adaptDetailedEvaluationCriteriaForBid } from "../../frontend/packages/detailedEvaluationCriteria.js";

test("validity criteria keep unique STT when source repeats a top-level number", () => {
  const source = [
    { id: "v1", group: "validity", code: "BID_SECURITY", name: "Bảo đảm dự thầu", stt: "1" },
    { id: "v2", group: "validity", code: "JV_AGREEMENT", name: "Thỏa thuận liên danh (đối với nhà thầu liên danh)", stt: "2" },
    { id: "v3", group: "validity", code: "LEGAL_STATUS", name: "Tư cách hợp lệ", stt: "3" },
    { id: "v31", group: "validity", name: "Nhà thầu là tổ chức", stt: "3.1" },
    { id: "v311", group: "validity", name: "Hạch toán tài chính độc lập", stt: "3.1.1" },
    { id: "v4", group: "validity", name: "Không bị tạm ngừng tham gia Hệ thống", stt: "3" },
    { id: "v5", group: "validity", name: "Không có nhân sự vi phạm quy định đấu thầu", stt: "3" },
  ];

  assert.deepEqual(
    adaptDetailedEvaluationCriteriaForBid(source, { loaiNhaThau: "Độc lập" })
      .map((criterion) => criterion.stt),
    ["1", "2", "2.1", "2.1.1", "3", "4"],
  );
  assert.deepEqual(
    adaptDetailedEvaluationCriteriaForBid(source, { loaiNhaThau: "Liên danh" })
      .map((criterion) => criterion.stt),
    ["1", "2", "3", "3.1", "3.1.1", "4", "5"],
  );

  const repeatedParent = [
    { id: "p1", group: "validity", name: "Nhóm thứ nhất", stt: "1" },
    { id: "p11", group: "validity", name: "Con nhóm thứ nhất", stt: "1.1" },
    { id: "p2", group: "validity", name: "Nhóm thứ hai", stt: "1" },
    { id: "p21", group: "validity", name: "Con nhóm thứ hai", stt: "1.1" },
  ];
  assert.deepEqual(
    adaptDetailedEvaluationCriteriaForBid(repeatedParent, { loaiNhaThau: "Liên danh" })
      .map((criterion) => criterion.stt),
    ["1", "1.1", "2", "2.1"],
  );
});
