import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_META,
  deriveBidValidityAlerts,
  selectDashboardActionItems,
  validityLastDay,
} from "../../frontend/app/dashboardAlertRules.js";

// ADR 0103 — browser copy of backend/sync/deadline_alerts.py.
const now = new Date(2026, 10, 14, 10, 0);

function evaluatingPackage(overrides = {}) {
  return {
    id: "pkg-1",
    maGoiThau: "TBMT-1",
    tenGoiThau: "Gói 1",
    trangThai: "Đang chấm thầu",
    thoiGianDongThau: "23/08/2026 09:00",
    hieuLucHsdt: 90,
    ...overrides,
  };
}

test("the closing day counts as the first validity day", () => {
  const last = validityLastDay(new Date(2026, 2, 1, 9, 0), 90);
  assert.equal(last.toDateString(), new Date(2026, 4, 29).toDateString());
  assert.equal(validityLastDay(new Date(2026, 2, 1), 0), null);
  assert.equal(validityLastDay(null, 90), null);
});

test("bids still under evaluation are flagged within the warning window", () => {
  const { counts, items } = deriveBidValidityAlerts([evaluatingPackage()], now);
  assert.equal(counts.bidValidityExpiring, 1);
  assert.deepEqual(items[0], {
    targetType: "package",
    id: "pkg-1",
    maGoiThau: "TBMT-1",
    tenGoiThau: "Gói 1",
    deadline: "2026-11-20",
    alertKey: "bidValidityExpiring",
    alertDetail: "Còn 6 ngày hiệu lực",
  });
});

test("packages outside evaluation or beyond the window are ignored", () => {
  const invited = evaluatingPackage({ trangThai: "Đang mời thầu" });
  const awarded = evaluatingPackage({ trangThai: "Đã có kết quả" });
  const later = evaluatingPackage({ thoiGianDongThau: "25/08/2026 09:00" });
  const noDays = evaluatingPackage({ hieuLucHsdt: 0 });
  assert.equal(deriveBidValidityAlerts([invited, awarded, later, noDays], now).items.length, 0);
});

test("the latest extension and the earlier security validity decide the deadline", () => {
  const pkg = evaluatingPackage({
    thoiGianDongThau: "01/08/2026 09:00",
    giaHanList: [{ thoiGianDongThau: "20/08/2026 09:00" }],
    hieuLucHsdt: 120,
    hieuLucDamBaoDuThau: 90,
  });
  const [item] = deriveBidValidityAlerts([pkg], now).items;
  assert.equal(item.deadline, "2026-11-17");
  assert.equal(item.alertDetail, "Còn 3 ngày hiệu lực");
});

test("expired validity is still reported while evaluation continues", () => {
  const [item] = deriveBidValidityAlerts([evaluatingPackage({ thoiGianDongThau: "01/08/2026 09:00" })], now).items;
  assert.equal(item.deadline, "2026-10-29");
  assert.equal(item.alertDetail, "Đã hết hiệu lực 16 ngày");
});

test("new alerts have presentation metadata and rank between existing alerts", () => {
  assert.equal(ALERT_META.bidValidityExpiring.label, "Hiệu lực HSDT sắp hết");
  assert.equal(ALERT_META.milestoneOverdue.label, "Mốc tiến độ quá hạn");
  const ordered = selectDashboardActionItems([
    { targetType: "package", id: "a", alertKey: "closingSoon", deadline: "2026-11-15" },
    { targetType: "package", id: "b", alertKey: "milestoneOverdue", deadline: "2026-11-01" },
    { targetType: "package", id: "c", alertKey: "bidValidityExpiring", deadline: "2026-11-20" },
    { targetType: "package", id: "d", alertKey: "overdueOpening", deadline: "2026-11-10" },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["d", "c", "b", "a"]);
});
