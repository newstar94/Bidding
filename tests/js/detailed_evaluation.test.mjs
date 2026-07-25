import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { resolveDetailedEvaluationContext } from "../../frontend/packages/detailedEvaluationRules.js";
import {
  getDetailedEvaluationBidLabel,
  getDetailedEvaluationProgress,
  getDetailedReportForRound,
  getCriteriaForGroup,
  getEligibleFinancialEvaluationBids,
  getEvaluationRoundType,
  getPackageEvaluationBids,
  isDetailedEvaluationSummaryOwned,
} from "../../frontend/packages/detailedEvaluationSelectors.js";
import {
  createDefaultDetailedEvaluationCriteria,
  resolveDetailedEvaluationTemplate,
} from "../../frontend/packages/detailedEvaluationTemplates.js";
import {
  validateDetailedEvaluationGroup,
  validateDetailedEvaluationRow,
} from "../../frontend/packages/detailedEvaluationValidation.js";
import {
  aggregateDetailedEvaluation,
  aggregateDetailedEvaluationReport,
} from "../../frontend/packages/detailedEvaluationAggregation.js";
import {
  applyDetailedEvaluationProjection,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
  closeDetailedEvaluation,
  openDetailedEvaluation,
  renderDetailedEvaluation,
  saveDetailedEvaluation,
} from "../../frontend/packages/DetailedEvaluationWorkflow.js";
import { renderDetailedEvaluationPanel } from "../../frontend/packages/detail/DetailedEvaluationPanel.js";
import { renderEvaluationPanel } from "../../frontend/packages/detail/EvaluationPanel.js";
import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";


test("detailed evaluation context exposes the correct groups for every envelope round", () => {
  const oneEnvelope = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  }, "single");
  assert.deepEqual(oneEnvelope.visibleGroups, [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  assert.deepEqual(oneEnvelope.editableGroups, oneEnvelope.visibleGroups);

  const technical = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  }, "technical");
  assert.deepEqual(technical.visibleGroups, [
    "validity",
    "capacity",
    "technical",
  ]);
  assert.deepEqual(technical.editableGroups, technical.visibleGroups);

  const financial = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  }, "financial");
  assert.deepEqual(financial.visibleGroups, ["financial"]);
  assert.deepEqual(financial.editableGroups, ["financial"]);
  assert.equal(financial.contractorFilter, "technical-qualified");
});

test("detailed evaluation resolves the supplied 14A-14D templates", () => {
  const process1 = { linhVuc: "Hàng hóa", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", quyTrinhDanhGia: "quytrinh1" };
  const process2 = { linhVuc: "Xây lắp", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", quyTrinhDanhGia: "quytrinh2" };
  const twoEnvelope = { linhVuc: "Hỗn hợp", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" };
  const consulting = { linhVuc: "Tư vấn", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ" };

  assert.equal(resolveDetailedEvaluationTemplate(process1).source, "14A");
  assert.equal(resolveDetailedEvaluationTemplate(process2).source, "14B");
  assert.equal(resolveDetailedEvaluationTemplate(twoEnvelope).source, "14C");
  assert.equal(resolveDetailedEvaluationTemplate(consulting).source, "14D");
  assert.deepEqual(
    resolveDetailedEvaluationContext(process2, "single").visibleGroups,
    ["validity", "capacity", "technical"],
  );
  assert.deepEqual(
    resolveDetailedEvaluationContext(consulting, "single").visibleGroups,
    ["validity", "technical", "financial"],
  );
  assert.equal(
    createDefaultDetailedEvaluationCriteria("single", { pkg: consulting })
      .find((criterion) => criterion.group === "technical").resultType,
    "score",
  );
  assert.ok(getCriteriaForGroup(process1, "single", "validity").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "capacity").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "technical").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "financial").length > 1);
});


test("detailed evaluation selects opening bids by round, lot and qualification", () => {
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  };
  const bids = [
    {
      id: "opening-pl01",
      goiThauId: "package-1",
      nhaThauId: "contractor-1",
      maPhanLo: "PL01",
      tenPhanLo: "Lô 01",
      tenNhaThau: "Công ty ABC",
      danhGiaKetLuan: "Đạt",
    },
    {
      id: "opening-pl02",
      goiThauId: "package-1",
      nhaThauId: "contractor-1",
      maPhanLo: "PL02",
      tenPhanLo: "Lô 02",
      tenNhaThau: "Công ty ABC",
      danhGiaKetLuan: "Không đạt",
    },
    {
      id: "opening-jv",
      goiThauId: "package-1",
      nhaThauId: "joint-venture-1",
      loaiNhaThau: "Liên danh",
      tenNhaThau: "Liên danh A – B",
      danhGiaKetLuan: "Đạt",
    },
    { id: "other", goiThauId: "package-2" },
  ];
  const model = { state: { thongtinmothau: bids, nhathau: [] } };

  assert.equal(getEvaluationRoundType(pkg, "eval_tech"), "technical");
  assert.equal(getEvaluationRoundType(pkg, "eval_fin"), "financial");
  assert.deepEqual(
    getPackageEvaluationBids(model, pkg).map((bid) => bid.id),
    ["opening-pl01", "opening-pl02", "opening-jv"],
  );
  assert.deepEqual(
    getEligibleFinancialEvaluationBids(model, pkg).map((bid) => bid.id),
    ["opening-pl01", "opening-jv"],
  );
  assert.match(getDetailedEvaluationBidLabel(model, bids[0]), /^\[PL01\].*Công ty ABC.*Lô 01/);
  assert.match(getDetailedEvaluationBidLabel(model, bids[1]), /^\[PL02\].*Công ty ABC.*Lô 02/);
  assert.match(getDetailedEvaluationBidLabel(model, bids[2]), /Liên danh A – B/);
});


test("detailed evaluation criteria and reports are selected without persisting defaults", () => {
  const defaults = createDefaultDetailedEvaluationCriteria("single");
  assert.deepEqual(defaults.map((criterion) => criterion.group), [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  assert.ok(defaults.every((criterion) => criterion.required));
  assert.ok(defaults.every((criterion) => criterion.resultType === "pass_fail"));

  const pkg = {
    id: "package-1",
    danhGiaHsdtMetadata: JSON.stringify({
      criteria: [{
        id: "criterion-validity",
        code: "VALIDITY-1",
        name: "Tính hợp lệ",
        group: "validity",
        resultType: "pass_fail",
        required: true,
      }],
    }),
  };
  assert.deepEqual(
    getCriteriaForGroup(pkg, "single", "validity").map((criterion) => criterion.id),
    ["criterion-validity"],
  );

  const bid = {
    baoCaoDanhGiaChiTietList: [{
      id: "report-single",
      loaiVong: "single",
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-validity",
        ketQua: "pass",
      }],
    }],
  };
  const report = getDetailedReportForRound(bid, "single");
  assert.equal(report.id, "report-single");
  assert.deepEqual(
    getDetailedEvaluationProgress(report, [
      { id: "criterion-validity", required: true },
      { id: "criterion-capacity", required: true },
    ]),
    { completed: 1, total: 2, requiredCompleted: 1, requiredTotal: 2 },
  );
});


test("detailed evaluation validation enforces failure reasons, required results and score bounds", () => {
  const requiredPassFail = {
    id: "criterion-validity",
    resultType: "pass_fail",
    required: true,
  };
  assert.deepEqual(
    validateDetailedEvaluationRow({
      tieuChiDanhGiaId: "criterion-validity",
      ketQua: "fail",
      lyDoKhongDat: "",
    }, requiredPassFail).errors,
    [{
      criterionId: "criterion-validity",
      field: "lyDoKhongDat",
      message: "Vui lòng nhập lý do không đạt.",
    }],
  );

  const scoreCriterion = {
    id: "criterion-score",
    resultType: "score",
    required: true,
    maxScore: 100,
  };
  assert.equal(validateDetailedEvaluationRow({
    tieuChiDanhGiaId: "criterion-score",
    ketQua: "pass",
    diem: 101,
  }, scoreCriterion).errors[0].field, "diem");

  const group = validateDetailedEvaluationGroup([
    { tieuChiDanhGiaId: "criterion-validity", ketQua: "pending" },
  ], [requiredPassFail], { completing: true });
  assert.equal(group.valid, false);
  assert.equal(group.errors[0].field, "ketQua");
});


test("detailed evaluation aggregation projects group and overall conclusions", () => {
  const criteria = [
    { id: "required-1", group: "technical", required: true },
    { id: "optional-1", group: "technical", required: false },
  ];
  const passed = aggregateDetailedEvaluation({
    report: {
      chiTietList: [
        { tieuChiDanhGiaId: "required-1", ketQua: "pass", diem: 80 },
        { tieuChiDanhGiaId: "optional-1", ketQua: "not_applicable", diem: null },
      ],
    },
    criteria,
    group: "technical",
  });
  assert.deepEqual(passed, {
    status: "Đạt",
    score: 80,
    failureReason: "",
    clarification: "",
  });

  const failedReport = {
    chiTietList: [{
      tieuChiDanhGiaId: "required-1",
      ketQua: "fail",
      lyDoKhongDat: "Không đáp ứng thông số kỹ thuật",
      yeuCauLamRo: "Yêu cầu làm rõ catalogue",
    }],
  };
  assert.deepEqual(
    aggregateDetailedEvaluation({ report: failedReport, criteria, group: "technical" }),
    {
      status: "Không đạt",
      score: null,
      failureReason: "Không đáp ứng thông số kỹ thuật",
      clarification: "Yêu cầu làm rõ catalogue",
    },
  );
  assert.equal(
    aggregateDetailedEvaluationReport({
      report: failedReport,
      criteria,
      groups: ["technical"],
    }).overall.status,
    "Không đạt",
  );
});


test("draft reports do not overwrite the legacy projection and completed reports do", () => {
  const pkg = { id: "package-1" };
  const bid = {
    id: "opening-1",
    danhGiaHopLe: "Kết quả cũ",
    danhGiaKetLuan: "Kết luận cũ",
  };
  const criteria = [
    { id: "validity-1", group: "validity", required: true },
    { id: "technical-1", group: "technical", required: true },
  ];
  const draft = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria,
  });
  assert.equal(draft.vongDanhGiaId, "evaluation-round:package-1:single");
  assert.deepEqual(draft.chiTietList.map((row) => row.ketQua), ["pending", "pending"]);
  assert.equal(bid.baoCaoDanhGiaChiTietList, undefined);

  assert.deepEqual(
    applyDetailedEvaluationProjection(bid, draft, criteria, ["validity", "technical"]),
    bid,
  );

  const completed = {
    ...draft,
    trangThai: "completed",
    chiTietList: [
      { tieuChiDanhGiaId: "validity-1", ketQua: "pass" },
      {
        tieuChiDanhGiaId: "technical-1",
        ketQua: "fail",
        lyDoKhongDat: "Không đáp ứng kỹ thuật",
      },
    ],
  };
  const projection = applyDetailedEvaluationProjection(
    bid,
    completed,
    criteria,
    ["validity", "technical"],
  );
  assert.equal(projection.danhGiaHopLe, "Đạt");
  assert.equal(projection.danhGiaKyThuat, "Không đạt");
  assert.equal(projection.danhGiaKetLuan, "Không đạt");
  assert.equal(projection.lyDoTruot, "Không đáp ứng kỹ thuật");
  assert.equal(bid.danhGiaHopLe, "Kết quả cũ");
});


test("reopened reports retain ownership of the stale legacy projection", () => {
  const completed = {
    id: "report-1",
    trangThai: "completed",
    extension: { completedGroups: ["validity"] },
  };
  assert.equal(isDetailedEvaluationSummaryOwned(completed), true);

  const reopened = buildReopenedDetailedEvaluationReport(completed);
  assert.equal(reopened.trangThai, "draft");
  assert.equal(reopened.extension.projectionPending, true);
  assert.equal(isDetailedEvaluationSummaryOwned(reopened), true);
  assert.equal(completed.extension.projectionPending, undefined);
});


test("evaluation summary opens a child detailed-report page keyed by opening bid", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
  const summaryContainer = { innerHTML: "" };
  renderEvaluationPanel(summaryContainer, {
    id: "package-1",
    tenGoiThau: "Gói thầu 01",
  });
  assert.match(summaryContainer.innerHTML, /id="btn-danhgiahsdt-detail"/);
  assert.match(summaryContainer.innerHTML, /id="danhgiahsdt-summary-view"/);
  assert.match(summaryContainer.innerHTML, /id="danhgiahsdt-detail-view"/);

  const detailContainer = { innerHTML: "" };
  renderDetailedEvaluationPanel(detailContainer, {
    pkg: {
      id: "package-1",
      tenGoiThau: "Gói thầu 01",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      linhVuc: "Hàng hóa",
    },
    bids: [
      { id: "opening-pl01", label: "[PL01] Công ty ABC – Lô 01" },
      { id: "opening-pl02", label: "[PL02] Công ty ABC – Lô 02" },
    ],
    selectedBidId: "opening-pl01",
    context: resolveDetailedEvaluationContext({}, "single"),
    activeGroup: "validity",
    criteria: [{
      id: "criterion-validity",
      code: "VALIDITY_SUMMARY",
      name: "Tính hợp lệ",
      resultType: "pass_fail",
      required: true,
      maxScore: null,
    }],
    report: {
      trangThai: "draft",
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-validity",
        ketQua: "pass",
      }],
    },
    progress: { completed: 1, total: 1 },
    readOnly: false,
  });
  assert.match(detailContainer.innerHTML, /value="opening-pl01" selected/);
  assert.match(detailContainer.innerHTML, /value="opening-pl02"/);
  assert.match(detailContainer.innerHTML, /data-detailed-evaluation-group="validity"/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-tabs" role="tablist"/);
  assert.match(
    detailContainer.innerHTML,
    /class="btn package-workflow-tab active"[^>]*data-no-icon/,
  );
  assert.match(detailContainer.innerHTML, /data-no-sort="true"/);
  assert.match(detailContainer.innerHTML, /<th rowspan="2">STT<\/th>/);
  assert.doesNotMatch(detailContainer.innerHTML, /<th>Mã<\/th>/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-stt">1<\/strong>/);
  assert.doesNotMatch(detailContainer.innerHTML, /\$\{index \+ 1\}/);
  assert.match(detailContainer.innerHTML, /detailed-evaluation-header-group/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-field-stack"/);
  assert.match(detailContainer.innerHTML, /id="btn-detailed-evaluation-save-draft"/);
  assert.match(detailContainer.innerHTML, /id="btn-detailed-evaluation-complete-report"/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("detailed evaluation remains a child page and does not add a package tab", () => {
  const tabs = buildPackageTabs({
    id: "package-1",
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  }, [{ id: "opening-1", danhGiaKetLuan: "" }]).tabs;
  assert.equal(tabs.some((tab) => String(tab.id).includes("detailed")), false);
  assert.equal(tabs.some((tab) => tab.id === "eval_tech"), true);
});


test("opening detailed evaluation selects the active opening-bid identity", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const classList = { add: () => {}, remove: () => {} };
  const summary = { classList };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const packageSelect = { value: "package-1" };
  const controller = {
    model: {
      state: {
        goithau: [{
          id: "package-1",
          tenGoiThau: "Gói thầu 01",
          phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
          trangThai: "Đang chấm thầu",
        }],
        thongtinmothau: [{
          id: "opening-1",
          goiThauId: "package-1",
          nhaThauId: "contractor-1",
          tenNhaThau: "Công ty ABC",
        }],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": packageSelect,
        "danhgiahsdt-summary-view": summary,
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      createIconsScoped: () => {},
    },
    currentDanhGiaTab: "unified",
  };
  controller.renderDetailedEvaluation = () => renderDetailedEvaluation.call(controller);

  try {
    await openDetailedEvaluation.call(controller);

    assert.equal(controller.selectedEvaluationBidId, "opening-1");
    assert.match(detail.innerHTML, /value="opening-1" selected/);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("locked completed reports do not offer a reopen action", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const container = { innerHTML: "" };

  try {
    renderDetailedEvaluationPanel(container, {
      pkg: { tenGoiThau: "Gói thầu đã có kết quả" },
      bids: [{ id: "opening-1", label: "Công ty ABC" }],
      selectedBidId: "opening-1",
      context: resolveDetailedEvaluationContext({}, "single"),
      activeGroup: "validity",
      criteria: [{
        id: "criterion-validity",
        code: "VALIDITY",
        name: "Tính hợp lệ",
        group: "validity",
        resultType: "pass_fail",
        required: true,
      }],
      report: {
        trangThai: "completed",
        chiTietList: [{
          tieuChiDanhGiaId: "criterion-validity",
          ketQua: "pass",
        }],
      },
      readOnly: true,
      canReopen: false,
    });

    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-reopen/);
    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-save-draft/);
    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-previous/);
    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-next/);
    assert.match(container.innerHTML, /data-detailed-field="ketQua"[^>]*disabled/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("saving a lot-scoped draft persists by opening bid and survives reload", async () => {
  const packageRecord = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const pl01 = {
    id: "opening-pl01",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    maPhanLo: "PL01",
  };
  const pl02 = {
    id: "opening-pl02",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    maPhanLo: "PL02",
  };
  const criterionId = "evaluation-criterion:evaluation-round:package-1:single:VALIDITY_SUMMARY";
  const fields = {
    ketQua: "pass",
    diem: "",
    noiDungHsdt: "Giấy đăng ký kinh doanh",
    nhanXet: "Đáp ứng",
    lyDoKhongDat: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "Mục I",
  };
  const criterionElement = {
    getAttribute: () => criterionId,
    querySelector: (selector) => {
      const field = selector.match(/data-detailed-field="([^"]+)"/)?.[1];
      return field ? { value: fields[field] ?? "" } : null;
    },
  };
  const detail = {
    querySelectorAll: (selector) => (
      selector === "[data-detailed-criterion-id]" ? [criterionElement] : []
    ),
    querySelector: () => null,
  };
  const persisted = [];
  let syncCount = 0;
  const controller = {
    model: {
      state: {
        goithau: [packageRecord],
        thongtinmothau: [pl01, pl02],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
      persistData: async (key) => { persisted.push(key); },
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customAlert: async () => true,
    },
    autoSync: async () => {
      syncCount += 1;
      return { ok: true };
    },
    renderDetailedEvaluation: () => {},
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-pl01",
  };

  assert.equal(await saveDetailedEvaluation.call(controller), true);
  assert.deepEqual(persisted, ["goithau", "thongtinmothau"]);
  assert.equal(syncCount, 1);
  assert.equal(pl02.baoCaoDanhGiaChiTietList, undefined);
  const savedReport = getDetailedReportForRound(pl01, "single");
  assert.equal(savedReport.trangThai, "draft");
  assert.equal(
    savedReport.chiTietList.find(
      (row) => row.tieuChiDanhGiaId === criterionId,
    ).noiDungHsdt,
    "Giấy đăng ký kinh doanh",
  );

  const reloadedBid = JSON.parse(JSON.stringify(pl01));
  assert.equal(
    getDetailedReportForRound(reloadedBid, "single").chiTietList.find(
      (row) => row.tieuChiDanhGiaId === criterionId,
    ).ketQua,
    "pass",
  );
});


test("completing a detailed report updates the legacy summary projection", async () => {
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const criteria = createDefaultDetailedEvaluationCriteria("single", {
    roundId: "evaluation-round:package-1:single",
    pkg,
  });
  const bid = {
    id: "opening-1",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    danhGiaKetLuan: "Kết luận cũ",
  };
  const draft = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria,
  });
  draft.chiTietList = draft.chiTietList.map((row) => ({
    ...row,
    ketQua: "pass",
  }));
  draft.extension = { projectionPending: true };
  bid.baoCaoDanhGiaChiTietList = [draft];
  const validityId = criteria.find((criterion) => criterion.group === "validity").id;
  const fields = {
    ketQua: "pass",
    diem: "",
    noiDungHsdt: "Đầy đủ",
    nhanXet: "Đạt",
    lyDoKhongDat: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "",
  };
  const criterionElement = {
    getAttribute: () => validityId,
    querySelector: (selector) => {
      const field = selector.match(/data-detailed-field="([^"]+)"/)?.[1];
      return field ? { value: fields[field] ?? "" } : null;
    },
  };
  const detail = {
    querySelectorAll: (selector) => (
      selector === "[data-detailed-criterion-id]" ? [criterionElement] : []
    ),
    querySelector: () => null,
  };
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [bid],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
      persistData: async () => {},
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customAlert: async () => true,
    },
    autoSync: async () => ({ ok: true }),
    renderDetailedEvaluation: () => {},
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-1",
  };

  assert.equal(
    await saveDetailedEvaluation.call(controller, { completeReport: true }),
    true,
  );
  const completed = getDetailedReportForRound(bid, "single");
  assert.equal(completed.trangThai, "completed");
  assert.equal(completed.ketLuan, "Đạt");
  assert.ok(completed.hoanThanhLuc);
  assert.equal(completed.extension.projectionPending, undefined);
  assert.equal(bid.danhGiaHopLe, "Đạt");
  assert.equal(bid.danhGiaNangLuc, "Đạt");
  assert.equal(bid.danhGiaKyThuat, "Đạt");
  assert.equal(bid.danhGiaTaiChinh, "Đạt");
  assert.equal(bid.danhGiaKetLuan, "Đạt");
});


test("MVP workflows complete 1G1T and 1G2T reports across every round", async () => {
  const createController = (pkg, bids, currentTab) => {
    const controller = {
      model: {
        state: {
          goithau: [pkg],
          thongtinmothau: bids,
          nhathau: [],
          activeuser: { id: "reviewer-1" },
        },
        hasPermission: () => true,
        persistData: async () => {},
      },
      view: {
        getActiveElement: (id) => ({
          "danhgiahsdt-goithau-select": { value: pkg.id },
          "danhgiahsdt-detail-view": detail,
        })[id] || null,
        customAlert: async () => true,
      },
      autoSync: async () => ({ ok: true }),
      renderDetailedEvaluation: () => {},
      currentDanhGiaTab: currentTab,
      selectedDetailedEvaluationTab: "validity",
      selectedEvaluationBidId: bids[0]?.id,
    };
    const detail = {
      querySelectorAll: (selector) => {
        if (selector !== "[data-detailed-criterion-id]") return [];
        const roundType = getEvaluationRoundType(pkg, controller.currentDanhGiaTab);
        const criteria = getCriteriaForGroup(
          pkg,
          roundType,
          controller.selectedDetailedEvaluationTab,
        );
        return criteria.map((criterion) => ({
          getAttribute: () => criterion.id,
          querySelector: (fieldSelector) => {
            const field = fieldSelector.match(/data-detailed-field="([^"]+)"/)?.[1];
            return { value: field === "ketQua" ? "pass" : "" };
          },
        }));
      },
      querySelector: () => null,
    };
    return controller;
  };
  const completeGroups = async (controller, groups) => {
    for (const [index, group] of groups.entries()) {
      controller.selectedDetailedEvaluationTab = group;
      const completeReport = index === groups.length - 1;
      assert.equal(await saveDetailedEvaluation.call(
        controller,
        completeReport ? { completeReport: true } : { completeGroup: true },
      ), true);
    }
  };

  const singlePackage = {
    id: "package-single-e2e",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const singleBid = {
    id: "opening-single-e2e",
    goiThauId: singlePackage.id,
    nhaThauId: "contractor-single-e2e",
  };
  const singleController = createController(singlePackage, [singleBid], "unified");
  await completeGroups(singleController, [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  const singleReport = getDetailedReportForRound(singleBid, "single");
  assert.equal(singleReport.trangThai, "completed");
  assert.equal(singleReport.ketLuan, "Đạt");
  assert.equal(singleBid.danhGiaKetLuan, "Đạt");
  assert.equal(
    getDetailedReportForRound(JSON.parse(JSON.stringify(singleBid)), "single").trangThai,
    "completed",
  );

  const twoEnvelopePackage = {
    id: "package-two-envelope-e2e",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {},
      financial: {},
    }),
  };
  const qualifiedBid = {
    id: "opening-qualified-e2e",
    goiThauId: twoEnvelopePackage.id,
    nhaThauId: "contractor-qualified-e2e",
  };
  const rejectedBid = {
    id: "opening-rejected-e2e",
    goiThauId: twoEnvelopePackage.id,
    nhaThauId: "contractor-rejected-e2e",
    danhGiaKetLuan: "Không đạt",
  };
  const twoEnvelopeController = createController(
    twoEnvelopePackage,
    [qualifiedBid, rejectedBid],
    "technical",
  );
  await completeGroups(twoEnvelopeController, ["validity", "capacity", "technical"]);
  assert.equal(getDetailedReportForRound(qualifiedBid, "technical").ketLuan, "Đạt");

  const metadata = JSON.parse(twoEnvelopePackage.danhGiaHsdtMetadata);
  metadata.technical.saved = true;
  metadata.technical.qualifiedSaved = true;
  twoEnvelopePackage.danhGiaHsdtMetadata = JSON.stringify(metadata);
  assert.deepEqual(
    getEligibleFinancialEvaluationBids(twoEnvelopeController.model, twoEnvelopePackage)
      .map((bid) => bid.id),
    [qualifiedBid.id],
  );
  qualifiedBid.giaDuThau = 100;
  twoEnvelopeController.currentDanhGiaTab = "financial";
  twoEnvelopeController.selectedDetailedEvaluationTab = "financial";
  assert.equal(await saveDetailedEvaluation.call(
    twoEnvelopeController,
    { completeReport: true },
  ), true);

  assert.deepEqual(
    qualifiedBid.baoCaoDanhGiaChiTietList.map((report) => report.loaiVong),
    ["technical", "financial"],
  );
  assert.equal(getDetailedReportForRound(qualifiedBid, "financial").ketLuan, "Đạt");
  assert.equal(qualifiedBid.danhGiaKetLuan, "Đạt");
  assert.equal(rejectedBid.baoCaoDanhGiaChiTietList, undefined);
});


test("leaving a dirty detailed report requires explicit confirmation", async () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class Element {};
  const operations = [];
  const classList = {
    add: (value) => operations.push(["add", value]),
    remove: (value) => operations.push(["remove", value]),
  };
  let allowDiscard = false;
  const controller = {
    currentEvaluationView: "contractor-detail",
    _detailedEvaluationDirty: true,
    view: {
      customConfirm: async () => allowDiscard,
      getActiveElement: (id) => ({
        "danhgiahsdt-summary-view": { classList },
        "danhgiahsdt-detail-view": { classList },
      })[id] || null,
    },
  };

  try {
    assert.equal(await closeDetailedEvaluation.call(controller), false);
    assert.equal(controller.currentEvaluationView, "contractor-detail");
    assert.equal(controller._detailedEvaluationDirty, true);
    assert.deepEqual(operations, []);

    allowDiscard = true;
    assert.equal(await closeDetailedEvaluation.call(controller), true);
    assert.equal(controller.currentEvaluationView, "summary");
    assert.equal(controller._detailedEvaluationDirty, false);
    assert.deepEqual(operations, [
      ["remove", "is-hidden"],
      ["add", "is-hidden"],
    ]);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});


test("next-bid command navigates by opening-bid order", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const listeners = {};
  const button = (id) => ({
    addEventListener: (_event, handler) => { listeners[id] = handler; },
  });
  const elements = {
    "#btn-detailed-evaluation-back": button("back"),
    "#detailed-evaluation-bid-select": { value: "opening-1" },
    "#btn-detailed-evaluation-previous": button("previous"),
    "#btn-detailed-evaluation-next": button("next"),
    "#btn-detailed-evaluation-save-draft": button("save"),
    "#btn-detailed-evaluation-complete-group": button("complete-group"),
    "#btn-detailed-evaluation-complete-report": button("complete-report"),
  };
  const classList = { add: () => {}, remove: () => {} };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: (selector) => elements[selector] || null,
    querySelectorAll: () => [],
  };
  let renderCount = 0;
  const controller = {
    model: {
      state: {
        goithau: [{
          id: "package-1",
          phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
          trangThai: "Đang chấm thầu",
        }],
        thongtinmothau: [
          {
            id: "opening-pl01",
            goiThauId: "package-1",
            nhaThauId: "contractor-1",
            maPhanLo: "PL01",
          },
          {
            id: "opening-pl02",
            goiThauId: "package-1",
            nhaThauId: "contractor-1",
            maPhanLo: "PL02",
          },
        ],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-summary-view": { classList },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customConfirm: async () => true,
      createIconsScoped: () => {},
    },
    renderDetailedEvaluation: () => { renderCount += 1; },
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-pl01",
  };

  try {
    await renderDetailedEvaluation.call(controller);
    await listeners.next();

    assert.equal(controller.selectedEvaluationBidId, "opening-pl02");
    assert.equal(renderCount, 1);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("workflow locks view-only, qualified technical, and unopened financial rounds", async () => {
  const lockedSave = async ({ pkg, bid, currentTab, hasPermission = true }) => {
    let persistCount = 0;
    const controller = {
      model: {
        state: {
          goithau: [pkg],
          thongtinmothau: [bid],
          nhathau: [],
          activeuser: { id: "reviewer-1" },
        },
        hasPermission: () => hasPermission,
        persistData: async () => { persistCount += 1; },
      },
      view: {
        getActiveElement: (id) => ({
          "danhgiahsdt-goithau-select": { value: pkg.id },
          "danhgiahsdt-detail-view": {
            querySelectorAll: () => [],
            querySelector: () => null,
          },
        })[id] || null,
      },
      currentDanhGiaTab: currentTab,
      selectedDetailedEvaluationTab: "validity",
      selectedEvaluationBidId: bid.id,
    };
    const result = await saveDetailedEvaluation.call(controller);
    return { result, persistCount };
  };

  const oneEnvelopePackage = {
    id: "package-single",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const oneEnvelopeBid = {
    id: "opening-single",
    goiThauId: "package-single",
  };
  assert.deepEqual(await lockedSave({
    pkg: oneEnvelopePackage,
    bid: oneEnvelopeBid,
    currentTab: "unified",
    hasPermission: false,
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: { ...oneEnvelopePackage, trangThai: "Đã có kết quả" },
    bid: oneEnvelopeBid,
    currentTab: "unified",
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: {
      ...oneEnvelopePackage,
      danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
    },
    bid: oneEnvelopeBid,
    currentTab: "unified",
  }), { result: false, persistCount: 0 });

  const twoEnvelopePackage = {
    id: "package-two-envelope",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: false },
    }),
  };
  const qualifiedBid = {
    id: "opening-qualified",
    goiThauId: "package-two-envelope",
    danhGiaKetLuan: "Đạt",
  };
  assert.deepEqual(await lockedSave({
    pkg: twoEnvelopePackage,
    bid: qualifiedBid,
    currentTab: "technical",
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: twoEnvelopePackage,
    bid: qualifiedBid,
    currentTab: "financial",
  }), { result: false, persistCount: 0 });

  const completedFinancialPackage = {
    ...twoEnvelopePackage,
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: true },
    }),
  };
  assert.deepEqual(await lockedSave({
    pkg: completedFinancialPackage,
    bid: { ...qualifiedBid, giaDuThau: 100 },
    currentTab: "financial",
  }), { result: false, persistCount: 0 });
});
