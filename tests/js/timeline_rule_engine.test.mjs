import assert from "node:assert/strict";
import fs from "node:fs";
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

test("contract negotiation is limited to simplified appointment, 1G2T, or consulting packages", () => {
  const negotiation = (packageData) => buildEffectiveTimeline(
    { ...base, ...packageData },
    { plan: { pheDuyet: "Kế hoạch" } },
    [],
    { includeNotApplicable: true }
  ).find((row) => row.milestoneKey === "CONTRACT_NEGOTIATION");

  assert.equal(negotiation({}).applicability, "NOT_APPLICABLE");
  assert.equal(negotiation({ hinhThucLuaChon: "Chỉ định thầu" }).applicability, "NOT_APPLICABLE");
  assert.equal(negotiation({ hinhThucLuaChon: "Chỉ định thầu rút gọn" }).applicability, "CONDITIONAL");
  assert.equal(negotiation({ phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" }).applicability, "APPLICABLE");
  assert.equal(negotiation({ linhVuc: "Tư vấn" }).applicability, "CONDITIONAL");
});

test("consultant appointment rows follow the linked contract appointment decision", () => {
  const appointmentRows = (contract) => buildEffectiveTimeline(
    base,
    { plan: { pheDuyet: "Kế hoạch" }, contracts: [contract] },
    [],
    { includeNotApplicable: true }
  ).filter((row) => row.milestoneKey.includes("CONSULTANT_APPOINTMENT"));

  const preparationWithoutDecision = appointmentRows({ phanLoai: "Tư vấn", coQdChiDinh: 0 });
  assert.deepEqual(
    preparationWithoutDecision.filter((row) => row.milestoneKey.startsWith("PREPARATION_")).map((row) => row.applicability),
    ["NOT_APPLICABLE", "NOT_APPLICABLE"]
  );
  const preparationWithDecision = appointmentRows({
    phanLoai: "Tư vấn",
    coQdChiDinh: 1,
    soQdChiDinh: "01/QĐ-TVL",
    ngayQdChiDinh: "2026-07-01"
  });
  assert.deepEqual(
    preparationWithDecision.filter((row) => row.milestoneKey.startsWith("PREPARATION_")).map((row) => row.applicability),
    ["APPLICABLE", "APPLICABLE"]
  );
  assert.equal(
    preparationWithDecision.find((row) => row.milestoneKey === "PREPARATION_CONSULTANT_APPOINTMENT").soVanBan,
    "01/QĐ-TVL"
  );

  const appraisalWithoutDecision = appointmentRows({ phanLoai: "Thẩm định", coQdChiDinh: 0 });
  assert.deepEqual(
    appraisalWithoutDecision.filter((row) => row.milestoneKey.startsWith("APPRAISAL_")).map((row) => row.applicability),
    ["NOT_APPLICABLE", "NOT_APPLICABLE"]
  );
  const appraisalWithDecision = appointmentRows({
    phanLoai: "Thẩm định",
    coQdChiDinh: 1,
    soQdChiDinh: "02/QĐ-TVT",
    ngayQdChiDinh: "2026-07-02"
  });
  assert.deepEqual(
    appraisalWithDecision.filter((row) => row.milestoneKey.startsWith("APPRAISAL_")).map((row) => row.applicability),
    ["APPLICABLE", "APPLICABLE"]
  );
});

test("consultant preparation and appraisal processes remain visible before contracts exist", () => {
  const rows = buildEffectiveTimeline(
    base,
    {
      plan: { pheDuyet: "Kế hoạch" },
      expertTeam: [{ id: "expert-team-1" }],
      appraisalTeam: [{ id: "appraisal-team-1" }],
      contracts: []
    },
    [],
    { includeNotApplicable: true }
  );
  const consultantRows = rows.filter((row) => [
    "PREPARATION_CONSULTANT",
    "APPRAISAL_CONSULTANT"
  ].includes(row.sectionKey));

  assert.equal(consultantRows.length, 24);
  assert.ok(consultantRows.every((row) => row.applicability === "APPLICABLE"));

  const consultingPackageRows = buildEffectiveTimeline(
    { ...base, linhVuc: "Tư vấn" },
    { plan: { pheDuyet: "Kế hoạch" }, contracts: [] },
    [],
    { includeNotApplicable: true }
  ).filter((row) => ["PREPARATION_CONSULTANT", "APPRAISAL_CONSULTANT"].includes(row.sectionKey));
  assert.equal(consultingPackageRows.length, 24);
  assert.ok(consultingPackageRows.every((row) => row.applicability === "APPLICABLE"));
});

test("timeline does not label rows as optional with 'Nếu có'", () => {
  const source = fs.readFileSync("frontend/packages/PackageTimelineView.js", "utf8");
  assert.doesNotMatch(source, /timeline-optional|Nếu có/);
});

test("bid evaluation report title follows the package envelope method", () => {
  const oneEnvelope = buildEffectiveTimeline(base, { plan: { pheDuyet: "Kế hoạch" } }, [])
    .find((row) => row.milestoneKey === "BID_EVALUATION_REPORT");
  const twoEnvelopes = buildEffectiveTimeline(
    { ...base, phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" },
    { plan: { pheDuyet: "Kế hoạch" } },
    []
  ).find((row) => row.milestoneKey === "BID_EVALUATION_REPORT");

  assert.equal(oneEnvelope.title, "Báo cáo đánh giá E-HSDT");
  assert.equal(twoEnvelopes.title, "Báo cáo đánh giá E-HSĐXKT");
});

test("document reconciliation invitation title follows the package envelope method", () => {
  const oneEnvelope = buildEffectiveTimeline(base, { plan: { pheDuyet: "Kế hoạch" } }, [])
    .find((row) => row.milestoneKey === "DOCUMENT_RECONCILIATION_INVITATION");
  const twoEnvelopes = buildEffectiveTimeline(
    { ...base, phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" },
    { plan: { pheDuyet: "Kế hoạch" } },
    []
  ).find((row) => row.milestoneKey === "DOCUMENT_RECONCILIATION_INVITATION");

  assert.equal(oneEnvelope.title, "Thư mời đối chiếu tài liệu");
  assert.equal(twoEnvelopes.title, "Thư mời đối chiếu tài liệu/Thương thảo hợp đồng");
});

test("mandatory 1G2T milestones are applicable before source documents exist", () => {
  const rows = buildEffectiveTimeline(
    { ...base, phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" },
    { plan: { pheDuyet: "Kế hoạch" } },
    [],
    { includeNotApplicable: true }
  );
  const mandatoryKeys = [
    "DOCUMENT_RECONCILIATION_INVITATION",
    "DOCUMENT_RECONCILIATION_MINUTES",
    "CONTRACT_NEGOTIATION",
    "CONTRACTOR_SELECTION_RESULT_APPRAISAL",
    "TECHNICAL_RESULT_APPRAISAL"
  ];

  assert.deepEqual(
    mandatoryKeys.map((key) => rows.find((row) => row.milestoneKey === key)?.applicability),
    mandatoryKeys.map(() => "APPLICABLE")
  );
});

test("visible timeline sections and row codes are renumbered after TVT is removed", () => {
  const rows = buildEffectiveTimeline({
    ...base,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    yeuCauThamDinhHsmtCode: "NOT_REQUIRED"
  }, {
    plan: { pheDuyet: "Kế hoạch" },
    contracts: [{ phanLoai: "Tư vấn", coQdChiDinh: 0 }]
  }, []);
  const visibleSections = [...new Set(rows.map((row) => row.sectionKey))];
  assert.deepEqual(visibleSections, [
    "PLAN_AND_ESTIMATE",
    "PREPARATION_CONSULTANT",
    "E_HSMT",
    "SELECTION_RESULT"
  ]);
  const ehsmt = rows.find((row) => row.milestoneKey === "E_HSMT_SUBMISSION");
  const result = rows.find((row) => row.milestoneKey === "BID_OPENING_MINUTES");
  assert.equal(ehsmt.displayGroupCode, "III");
  assert.equal(ehsmt.displayCode, "3.1");
  assert.equal(result.displayGroupCode, "IV");
  assert.equal(result.displayCode, "4.1");
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
