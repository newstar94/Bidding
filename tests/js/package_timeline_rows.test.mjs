import assert from "node:assert/strict";
import test from "node:test";

import { mergeTimelineRows } from "../../frontend/packages/packageTimelineRows.js";


test("plan submission number, date and approval decision flow into separate-plan timeline rows", () => {
  const rows = mergeTimelineRows(
    {},
    {
      pheDuyet: "Kế hoạch",
      soToTrinhKeHoach: "123/TTr-KH",
      ngayTrinhKeHoach: "2026-07-20",
      quyetDinhPheDuyet: "456/QĐ-KH",
      ngayPheDuyet: "2026-07-21",
    }
  );

  const submission = rows.find((row) => row.maMoc === "1.5");
  const approval = rows.find((row) => row.maMoc === "1.6");

  assert.equal(submission.isApplicable, true);
  assert.equal(submission.soVanBan, "123/TTr-KH");
  assert.equal(submission.ngayThucTe, "2026-07-20");
  assert.equal(approval.isApplicable, true);
  assert.equal(approval.soVanBan, "456/QĐ-KH");
  assert.equal(approval.ngayThucTe, "2026-07-21");
});


test("budget and combined plan submission numbers flow into their applicable timeline rows", () => {
  const separateRows = mergeTimelineRows(
    {},
    {
      pheDuyet: "Kế hoạch",
      soToTrinhDuToan: "101/TTr-DT",
      ngayTrinhDuToan: "2026-07-18",
    }
  );
  const combinedRows = mergeTimelineRows(
    {},
    {
      pheDuyet: "Dự toán và kế hoạch",
      soToTrinhDuToanKeHoach: "202/TTr-DTKH",
      ngayTrinhKeHoach: "2026-07-19",
    }
  );

  const budgetSubmission = separateRows.find((row) => row.maMoc === "1.3");
  const combinedSubmission = combinedRows.find((row) => row.maMoc === "1.7");

  assert.equal(budgetSubmission.isApplicable, true);
  assert.equal(budgetSubmission.soVanBan, "101/TTr-DT");
  assert.equal(budgetSubmission.ngayThucTe, "2026-07-18");
  assert.equal(combinedSubmission.isApplicable, true);
  assert.equal(combinedSubmission.soVanBan, "202/TTr-DTKH");
  assert.equal(combinedSubmission.ngayThucTe, "2026-07-19");
});
