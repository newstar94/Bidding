import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateTimelineStats,
  copyTimelineForNewVersion,
  createDefaultTimelineRows,
  isTimelineRowApplicable,
  mergeTimelineRows,
  timelineDisplayCode
} from "../../frontend/packages/packageTimelineRows.js";

test("timeline catalog contains five groups and 48 stable milestones", () => {
  const rows = createDefaultTimelineRows();
  assert.equal(rows.length, 48);
  assert.deepEqual([...new Set(rows.map((row) => row.maNhom))], ["I", "II", "III", "IV", "V"]);
  assert.equal(new Set(rows.map((row) => row.maMoc)).size, 48);
  assert.equal(rows.at(-1).maMoc, "5.13");
});

test("automatic fields refresh while manual overrides remain unchanged", () => {
  const pkg = {
    soToTrinhHsmt: "15/TTr-HSMT",
    ngayTrinhHsmt: "2026-07-18",
    timelineItems: [
      {
        ...createDefaultTimelineRows().find((row) => row.maMoc === "4.1"),
        sourceMode: "MANUAL",
        soVanBan: "Số nhập tay",
        ngayThucTe: "2026-07-17"
      }
    ]
  };
  const manual = mergeTimelineRows(pkg).find((row) => row.maMoc === "4.1");
  assert.equal(manual.soVanBan, "Số nhập tay");

  pkg.timelineItems[0].sourceMode = "AUTO";
  const automatic = mergeTimelineRows(pkg).find((row) => row.maMoc === "4.1");
  assert.equal(automatic.soVanBan, "15/TTr-HSMT");
  assert.equal(automatic.ngayThucTe, "2026-07-18");
  assert.equal(automatic.trangThai, "DONE");
});

test("statistics derive overdue without persisting an OVERDUE status", () => {
  const rows = createDefaultTimelineRows().slice(0, 4);
  rows[0].trangThai = "DONE";
  rows[1].trangThai = "NOT_APPLICABLE";
  rows[2].ngayDuKien = "2026-01-01";
  const stats = calculateTimelineStats(rows, new Date("2026-07-17T12:00:00"));
  assert.deepEqual(stats, { total: 3, done: 1, open: 2, overdue: 1 });
});

test("copying a version resets HSMT and result process milestones", () => {
  const previous = createDefaultTimelineRows().map((row) => ({
    ...row,
    id: `old-${row.maMoc}`,
    soVanBan: "OLD",
    ngayThucTe: "2026-07-01",
    trangThai: "DONE"
  }));
  const copied = copyTimelineForNewVersion(previous);
  assert.equal(copied.find((row) => row.maMoc === "1.4").soVanBan, "OLD");
  assert.equal(copied.find((row) => row.maMoc === "4.1").soVanBan, "");
  assert.equal(copied.find((row) => row.maMoc === "5.11").trangThai, "PENDING");
  assert.ok(copied.every((row) => row.id === ""));
});

test("timeline shows either separate or combined plan approval milestones", () => {
  const combinedRows = mergeTimelineRows({}, { pheDuyet: "Dự toán và kế hoạch" });
  const combinedCodes = new Set(combinedRows.filter((row) => row.isApplicable).map((row) => row.maMoc));
  assert.ok(["1.3", "1.4", "1.5", "1.6"].every((code) => !combinedCodes.has(code)));
  assert.ok(["1.7", "1.8"].every((code) => combinedCodes.has(code)));
  assert.equal(timelineDisplayCode(combinedRows.find((row) => row.maMoc === "1.7"), combinedRows), "1.3");
  assert.equal(timelineDisplayCode(combinedRows.find((row) => row.maMoc === "1.8"), combinedRows), "1.4");

  const separateRows = mergeTimelineRows({}, { pheDuyet: "Kế hoạch" });
  const separateCodes = new Set(separateRows.filter((row) => row.isApplicable).map((row) => row.maMoc));
  assert.ok(["1.3", "1.4", "1.5", "1.6"].every((code) => separateCodes.has(code)));
  assert.ok(["1.7", "1.8"].every((code) => !separateCodes.has(code)));
});

test("timeline removes appraisal and two-envelope milestones that do not apply", () => {
  const competitivePackage = {
    hinhThucLuaChon: "Chào hàng cạnh tranh",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    yeuCauThamDinhHsmt: "Không"
  };
  const applicableCodes = new Set(
    mergeTimelineRows(competitivePackage)
      .filter((row) => row.isApplicable)
      .map((row) => row.maMoc)
  );
  assert.ok([...applicableCodes].every((code) => !code.startsWith("3.")));
  assert.ok(["4.2", "5.3", "5.4", "5.5", "5.6", "5.10"].every((code) => !applicableCodes.has(code)));
  assert.ok(applicableCodes.has("4.1"));
  assert.ok(applicableCodes.has("5.2"));

  assert.equal(isTimelineRowApplicable(
    { maMoc: "4.2" },
    { hinhThucLuaChon: "Đấu thầu rộng rãi", yeuCauThamDinhHsmt: "Không" }
  ), false);
  assert.equal(isTimelineRowApplicable(
    { maMoc: "5.5" },
    { phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" }
  ), true);
});
