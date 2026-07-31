import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEffectiveTimeline,
  mergeSavedTimelineEntries,
  resolveLatestBidClosingTime,
  timelineProgress
} from "../../frontend/packages/timelineRuleEngine.js";
import {
  ensureVersionEhsmtAdjustment,
  preparePackageSnapshot
} from "../../frontend/shared/VersionedEntityService.js";

const base = {
  hinhThucLuaChon: "Đấu thầu rộng rãi",
  phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  yeuCauThamDinhHsmtCode: "UNDETERMINED"
};

test("E-HSMT appraisal supports all three decision states", () => {
  const related = { plan: { pheDuyet: "Kế hoạch" } };
  const undetermined = buildEffectiveTimeline(base, related, []);
  assert.equal(undetermined.find((row) => row.milestoneKey === "E_HSMT_APPRAISAL_REPORT").applicability, "CONDITIONAL");
  const required = buildEffectiveTimeline({ ...base, yeuCauThamDinhHsmtCode: "REQUIRED" }, related, []);
  assert.equal(required.find((row) => row.milestoneKey === "E_HSMT_APPRAISAL_REPORT").applicability, "APPLICABLE");
  const notRequired = buildEffectiveTimeline({ ...base, yeuCauThamDinhHsmtCode: "NOT_REQUIRED" }, related, []);
  assert.equal(notRequired.some((row) => row.milestoneKey === "E_HSMT_APPRAISAL_REPORT"), false);
});

test("competitive offering removes every appraisal-tagged milestone", () => {
  const rows = buildEffectiveTimeline({
    ...base,
    hinhThucLuaChon: "Chào hàng cạnh tranh"
  }, { plan: { pheDuyet: "Kế hoạch" } }, []);
  assert.equal(rows.some((row) => row.tags.includes("APPRAISAL")), false);
});

test("plan approval and envelope rules are exclusive", () => {
  const combined = buildEffectiveTimeline({
    ...base,
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ"
  }, { plan: { pheDuyet: "Dự toán và kế hoạch" } }, []);
  assert.equal(combined.some((row) => row.milestoneKey === "COST_ESTIMATE_SUBMISSION"), false);
  assert.equal(combined.some((row) => row.milestoneKey === "COMBINED_COST_PLAN_SUBMISSION"), true);
  assert.equal(combined.some((row) => row.milestoneKey === "FINANCIAL_OPENING_MINUTES"), true);
  const oneEnvelope = buildEffectiveTimeline(base, { plan: { pheDuyet: "Kế hoạch" } }, []);
  assert.equal(oneEnvelope.some((row) => row.tags.includes("TWO_ENVELOPE_ONLY")), false);
});

test("repeatable adjustment instances are stable, ordered and idempotent", () => {
  const related = {
    plan: { pheDuyet: "Kế hoạch" },
    ehsmtAdjustments: [
      { id: "b", sequence: 2, approvalDecisionNumber: "02/QĐ", approvalDecisionDate: "2026-06-02" },
      { id: "a", sequence: 1, approvalDecisionNumber: "01/QĐ", approvalDecisionDate: "2026-05-01" },
      { id: "a", sequence: 1, approvalDecisionNumber: "01/QĐ", approvalDecisionDate: "2026-05-01" }
    ]
  };
  const rows = buildEffectiveTimeline({ ...base, yeuCauThamDinhHsmtCode: "REQUIRED" }, related, []);
  const adjustments = rows.filter((row) => row.milestoneKey === "E_HSMT_ADJUSTMENT_APPROVAL");
  assert.deepEqual(adjustments.map((row) => row.instanceKey), ["a", "b"]);
  assert.equal(adjustments[0].title, "QĐ phê duyệt điều chỉnh E-HSMT lần 1");
});

test("a package version automatically creates one stable E-HSMT adjustment", () => {
  const packageVersion = {
    ...base,
    id: "package-v02",
    phienBan: "02",
    soQuyetDinh: "02/QĐ-ĐC",
    ngayQuyetDinh: "2026-07-20"
  };
  ensureVersionEhsmtAdjustment(packageVersion);
  ensureVersionEhsmtAdjustment(packageVersion);
  assert.equal(packageVersion.ehsmtAdjustments.length, 1);
  assert.equal(packageVersion.ehsmtAdjustments[0].id, "package-version:package-v02");
  const rows = buildEffectiveTimeline(packageVersion, { plan: { pheDuyet: "Kế hoạch" } }, []);
  const adjustment = rows.find((row) => row.milestoneKey === "E_HSMT_ADJUSTMENT_APPROVAL");
  assert.equal(adjustment.instanceKey, "package-version:package-v02");
  assert.equal(adjustment.title, "QĐ phê duyệt điều chỉnh E-HSMT lần 2");
  assert.equal(adjustment.soVanBan, "02/QĐ-ĐC");
  assert.equal(adjustment.ngayThucTe, "2026-07-20");
});

test("legacy package versions infer the adjustment and new snapshots reset process children", () => {
  const packageVersion = {
    ...base,
    id: "legacy-v03",
    phienBan: "03",
    soQuyetDinh: "03/QĐ-ĐC",
    ngayQuyetDinh: "2026-07-21"
  };
  const rows = buildEffectiveTimeline(packageVersion, { plan: { pheDuyet: "Kế hoạch" } }, []);
  const adjustment = rows.find((row) => row.milestoneKey === "E_HSMT_ADJUSTMENT_APPROVAL");
  assert.equal(adjustment.instanceKey, "package-version:legacy-v03");
  const snapshot = preparePackageSnapshot({
    timelineItems: [{ id: "old-timeline" }],
    ehsmtAdjustments: [{ id: "old-adjustment" }]
  });
  assert.deepEqual(snapshot.timelineItems, []);
  assert.deepEqual(snapshot.ehsmtAdjustments, []);
});

test("effective bid closing time is the latest package or active extension time", () => {
  assert.equal(resolveLatestBidClosingTime(
    { thoiGianDongThau: "2026-07-15T10:00:00" },
    { extensions: [
      { thoiGianDongThau: "2026-07-12T10:00:00" },
      { thoiGianDongThau: "2026-07-20T10:00:00" },
      { thoiGianDongThau: "2026-07-30T10:00:00", archivedAt: "2026-07-01" }
    ] }
  ), "2026-07-20T10:00:00");
});

test("hidden saved entries are retained and conditional rows do not affect progress", () => {
  const active = buildEffectiveTimeline(base, { plan: { pheDuyet: "Kế hoạch" } }, []);
  const hidden = { id: "hidden", milestoneKey: "FINANCIAL_OPENING_MINUTES", instanceKey: "", soVanBan: "old" };
  const merged = mergeSavedTimelineEntries([hidden], active);
  assert.equal(merged.some((row) => row.id === "hidden"), true);
  const progress = timelineProgress(active);
  assert.equal(progress.total, active.filter((row) => row.applicability === "APPLICABLE").length);
});
