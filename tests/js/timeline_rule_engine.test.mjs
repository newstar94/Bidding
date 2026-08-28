import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildEffectiveTimeline,
  mergeSavedTimelineEntries,
  resolveLatestBidClosingTime
} from "../../frontend/packages/timelineRuleEngine.js";
import { ensureVersionEhsmtAdjustment } from "../../frontend/shared/VersionedEntityService.js";
import {
  findTimelineContracts,
  buildTimelineLineagePresentation,
  selectableTimelinePlans,
  timelineInitialPackageReference,
  timelinePackageFamily,
  timelinePackageRepresentatives,
} from "../../frontend/packages/PackageTimelineView.js";

test("timeline plan selector shows one representative for each version lineage", () => {
  const historical = {
    id: "plan-v00",
    rootId: "plan-root",
    maKeHoach: "PL2600150284",
    tenKeHoach: "Kế hoạch thử nghiệm",
    phienBan: "00",
    isLatest: 1,
  };
  const current = {
    ...historical,
    id: "plan-v01",
    phienBan: "01",
  };
  const view = { model: { state: {
    kehoach: [historical, current],
    goithau: [
      { id: "package-v00", keHoachId: historical.id, trangThai: "Đang mời thầu", isLatest: 1 },
      { id: "package-v01", keHoachId: current.id, trangThai: "Đang mời thầu", isLatest: 1 },
    ],
  } } };

  assert.deepEqual(
    selectableTimelinePlans(view).map((plan) => plan.id),
    [current.id],
  );
});

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

test("timeline toolbar exports an editable Excel workbook", () => {
  const source = fs.readFileSync("frontend/packages/PackageTimelineView.js", "utf8");
  const markup = fs.readFileSync("views/tabs/tab_goithau_timeline.html", "utf8");

  assert.match(markup, /id="timeline-export-excel"/);
  assert.match(markup, />\s*Xuất Excel\s*</);
  assert.doesNotMatch(markup, /id="timeline-export-word"|Xuất Word/);
  assert.match(source, /Timeline_goi_thau_\$\{code\}\.xlsx/);
  assert.match(source, /\/api\/export-timeline\//);
  assert.doesNotMatch(source, /Timeline_goi_thau_\$\{code\}\.docx/);
});

test("timeline renders every filtered milestone without pagination", () => {
  const source = fs.readFileSync("frontend/packages/PackageTimelineView.js", "utf8");
  const markup = fs.readFileSync("views/tabs/tab_goithau_timeline.html", "utf8");

  assert.match(source, /const rows = filteredRows\(state\);[\s\S]*?rows\.forEach\(\(row\) => \{/);
  assert.doesNotMatch(source, /paginateTableItems|renderTablePagination|timeline-pagination/);
  assert.doesNotMatch(markup, /timeline-pagination|Phân trang timeline/);
  assert.match(source, /void renderPromise\.catch\(/u);
});

test("timeline sticky header stays above row controls while scrolling", () => {
  const css = fs.readFileSync("views/css/views.css", "utf8");
  const headerRule = css.match(/\.timeline-table thead th\s*\{([^}]*)\}/u)?.[1] || "";
  const headerZIndex = Number(headerRule.match(/z-index:\s*(\d+)/u)?.[1] || 0);

  assert.ok(headerZIndex > 5, "timeline header must layer above timeline controls");
});

test("timeline contract projection resolves package lineage", () => {
  const historical = { id: "package-v1", rootId: "package-root" };
  const current = { id: "package-v2", rootId: "package-root" };
  const unrelated = { id: "package-other", rootId: "other-root" };
  const exact = { id: "contract-exact", goiThauIds: [current.id] };
  const inherited = { id: "contract-lineage", goiThauIds: [historical.id] };
  const foreign = { id: "contract-other", goiThauIds: [unrelated.id] };
  const view = { model: { state: {
    goithau: [historical, current, unrelated],
    hopdong: [exact, inherited, foreign],
  } } };

  assert.deepEqual(
    findTimelineContracts(view, current).map((contract) => contract.id),
    [exact.id, inherited.id],
  );
});

test("timeline package picker shows one package family without exposing revisions", () => {
  const package00 = {
    id: "package-00", rootId: "package-root", phienBan: "00",
    maGoiThau: "IB2600212155", tenGoiThau: "Mua sắm thuốc Generic",
  };
  const package01 = {
    ...package00,
    id: "package-01", phienBan: "01", isLatest: 1,
    allVersions: [
      { id: "package-00", phienBan: "00" },
      { id: "package-01", phienBan: "01" },
    ],
  };

  const representatives = timelinePackageRepresentatives([package00, package01]);

  assert.deepEqual(
    representatives.map((pkg) => ({ id: pkg.id, rootId: pkg.rootId })),
    [{ id: "package-01", rootId: "package-root" }],
  );
  assert.equal(
    timelineInitialPackageReference([package01], package01).id,
    package00.id,
  );
  assert.deepEqual(
    timelinePackageFamily([package00, package01], package01).map((pkg) => pkg.id),
    [package00.id, package01.id],
  );
});

test("timeline aggregates every dated milestone from the package lineage without version labels", () => {
  const currentRows = [{
    id: "approval-current",
    milestoneKey: "E_HSMT_APPROVAL",
    sectionKey: "E_HSMT",
    sortOrder: 30,
    ngayThucTe: "2026-06-15",
  }];
  const presentation = buildTimelineLineagePresentation(currentRows, [
    {
      packageId: "package-00",
      rows: [
        {
          id: "approval-original",
          milestoneKey: "E_HSMT_APPROVAL",
          sectionKey: "E_HSMT",
          sortOrder: 30,
          ngayDuKien: "2026-06-01",
          ngayThucTe: "2026-06-03",
        },
        {
          id: "opening-original",
          milestoneKey: "BID_OPENING_MINUTES",
          sectionKey: "SELECTION_RESULT",
          sortOrder: 50,
          ngayThucTe: "2026-06-05",
        },
      ],
    },
    { packageId: "package-01", rows: currentRows },
  ]);

  assert.equal(presentation.rows.length, 2);
  assert.equal(presentation.rows[0].id, "approval-current");
  assert.equal(presentation.rows[1].isHistorical, true);
  assert.deepEqual(presentation.dateHistoryByMilestone.E_HSMT_APPROVAL, [
    { field: "ngayDuKien", value: "2026-06-01" },
    { field: "ngayThucTe", value: "2026-06-03" },
    { field: "ngayThucTe", value: "2026-06-15" },
  ]);
  assert.deepEqual(presentation.dateHistoryByMilestone.BID_OPENING_MINUTES, [
    { field: "ngayThucTe", value: "2026-06-05" },
  ]);

  const source = fs.readFileSync("frontend/packages/PackageTimelineView.js", "utf8");
  const markup = fs.readFileSync("views/tabs/tab_goithau_timeline.html", "utf8");
  assert.doesNotMatch(source, /timeline-version-select/);
  assert.doesNotMatch(markup, /timeline-version-select/);
});

test("timeline keeps the original E-HSMT approval and maps revision 01 as adjustment 1", () => {
  const original = {
    ...base,
    id: "package-00", rootId: "package-root", phienBan: "00",
    soQuyetDinh: "124/QĐ-TTYT", ngayQuyetDinh: "2026-05-19",
  };
  const revision01 = {
    ...original,
    id: "package-01", phienBan: "01",
    soQuyetDinh: "125/QĐ-TTYT", ngayQuyetDinh: "2026-05-20",
  };

  const rows = buildEffectiveTimeline(revision01, {
    plan: { pheDuyet: "Kế hoạch" },
    initialPackage: original,
  }, []);
  const approval = rows.find((row) => row.milestoneKey === "E_HSMT_APPROVAL");
  const adjustment = rows.find((row) => row.milestoneKey === "E_HSMT_ADJUSTMENT_APPROVAL");

  assert.equal(approval.soVanBan, "124/QĐ-TTYT");
  assert.equal(approval.ngayThucTe, "2026-05-19");
  assert.equal(adjustment.title, "QĐ phê duyệt điều chỉnh E-HSMT lần 1");
  assert.equal(adjustment.soVanBan, "125/QĐ-TTYT");
  assert.equal(adjustment.ngayThucTe, "2026-05-20");
});

test("timeline falls back to the full package when initial-version metadata has no E-HSMT approval", () => {
  const current = {
    ...base,
    id: "package-00",
    phienBan: "00",
    soQuyetDinh: "1871/QĐ-BVQY",
    ngayQuyetDinh: "2026-08-14",
  };

  const rows = buildEffectiveTimeline(current, {
    plan: { pheDuyet: "Kế hoạch" },
    initialPackage: { id: current.id, phienBan: current.phienBan },
  }, []);
  const approval = rows.find((row) => row.milestoneKey === "E_HSMT_APPROVAL");

  assert.equal(approval.sourceMode, "AUTO");
  assert.equal(approval.soVanBan, "1871/QĐ-BVQY");
  assert.equal(approval.ngayThucTe, "2026-08-14");
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

test("legacy package versions infer the adjustment", () => {
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

test("hidden saved entries are retained", () => {
  const active = buildEffectiveTimeline(base, { plan: { pheDuyet: "Kế hoạch" } }, []);
  const hidden = { id: "hidden", milestoneKey: "FINANCIAL_OPENING_MINUTES", instanceKey: "", soVanBan: "old" };
  const merged = mergeSavedTimelineEntries([hidden], active);
  assert.equal(merged.some((row) => row.id === "hidden"), true);
});
