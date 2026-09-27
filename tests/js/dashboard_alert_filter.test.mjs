import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardActionRows,
  dashboardAlertMatches,
} from "../../frontend/app/DashboardView.js";

const at = new Date("2026-09-27T08:00:00+07:00");

test("dashboard alert filter uses the same local alert classification as the card", () => {
  const packageRecord = {
    id: "package-1",
    trangThai: "Đang mời thầu",
    thoiGianDongThau: "27/09/2026 15:00",
  };

  assert.equal(dashboardAlertMatches(packageRecord, "closingToday", at), true);
  assert.equal(dashboardAlertMatches(packageRecord, "overdueOpening", at), false);
});

test("dashboard alert filter does not match unrelated alert categories", () => {
  const packageRecord = {
    id: "package-2",
    trangThai: "Đã mở thầu",
    thoiGianMoThau: "10/09/2026 15:00",
  };

  assert.equal(dashboardAlertMatches(packageRecord, "closingSoon", at), false);
  assert.equal(dashboardAlertMatches(packageRecord, "delayedEvaluation", at), true);
});

test("dashboard action rows identify the record, reason, deadline source, and next step", () => {
  const markup = buildDashboardActionRows({
    items: [{
      id: "package-3",
      alertKey: "closingSoon",
      targetType: "package",
      maGoiThau: "GT-03",
      tenGoiThau: "Mua sắm <thiết bị>",
      alertDetail: "Trong 7 ngày tới",
      deadline: "2026-09-30T15:00:00+07:00",
    }],
  });

  assert.match(markup, /GT-03/);
  assert.match(markup, /Mua sắm &lt;thiết bị&gt;/);
  assert.match(markup, /Sắp đóng thầu/);
  assert.match(markup, /Mốc lấy từ: Thời gian đóng thầu/);
  assert.match(markup, /Rà soát hồ sơ trước mốc đóng thầu/);
  assert.match(markup, /data-bf-action="show-package"/g);
  assert.match(markup, /data-id="package-3"/g);
});
