import assert from "node:assert/strict";
import test from "node:test";

import { executeDetailedEvaluationSave } from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";
import { detailedEvaluationAutosaveFor } from "../../frontend/packages/DetailedEvaluationDraftAutosave.js";
import { resolveDetailedEvaluationState } from "../../frontend/packages/DetailedEvaluationState.js";
import { importDetailedEvaluationExcel } from "../../frontend/packages/DetailedEvaluationWorkflow.js";
import { excelParseWorkerClient } from "../../frontend/documents/ExcelParseWorkerClient.js";

for (const failDraftRemoval of [false, true]) {
  test(`row conflict renders canonical report, criteria and method when draft removal ${failDraftRemoval ? "fails" : "succeeds"}`, async () => {
    const stored = new Map();
    let failWrites = false;
    const storage = {
      getItem: (key) => stored.get(key) || null,
      setItem(key, value) {
        if (failWrites) throw new Error("Local draft storage unavailable");
        stored.set(key, value);
      },
    };
    const localCriterion = {
      id: "criterion-conflict", stt: "1", group: "technical",
      name: "Rejected criterion", resultType: "score", maxScore: 100,
      source: "custom", required: false,
    };
    const canonicalCriterion = { ...localCriterion, name: "Server criterion", resultType: "pass_fail" };
    const localReport = {
      id: "report-conflict", loaiVong: "single", trangThai: "draft",
      chiTietList: [{ id: "row-conflict", tieuChiDanhGiaId: localCriterion.id, ketQua: "pass", diem: 75, nhanXet: "Rejected note" }],
      extension: { technicalEvaluationMethod: "score" },
    };
    const canonicalReport = {
      ...structuredClone(localReport),
      chiTietList: [{ ...localReport.chiTietList[0], diem: null, nhanXet: "Server note" }],
      extension: { technicalEvaluationMethod: "pass_fail" },
    };
    const pkg = { id: "package-conflict", rowVersion: 1, danhGiaHsdtMetadata: "{}" };
    const bid = { id: "bid-conflict", rowVersion: 1, goiThauId: pkg.id, baoCaoDanhGiaChiTietList: [localReport] };
    const draftKey = `${pkg.id}:${bid.id}:single`;
    const criteriaKey = `${pkg.id}:single`;
    const toasts = [];
    const alerts = [];
    let rendered;
    const controller = {
      model: {
        workspaceStorage: storage,
        getWorkspaceToken: () => "workspace-a",
        isWorkspaceCurrent: (token) => token === "workspace-a",
        state: { goithau: [pkg], thongtinmothau: [bid], hanghoaduthaunhathau: [] },
        assertStorageTablesWritable() {},
        commitLocalMutation() {},
      },
      view: {
        getActiveElement: (id) => id === "danhgiahsdt-goithau-select" ? { value: pkg.id } : null,
        customAlert: async (...args) => { alerts.push(args); },
        showToast: (...args) => { toasts.push(args); },
      },
      _detailedEvaluationCriteriaOverrides: new Map([[criteriaKey, [localCriterion]], ["other:single", [localCriterion]]]),
      _technicalEvaluationMethodDrafts: new Map([[criteriaKey, "score"], ["other:single", "score"]]),
      _detailedEvaluationDrafts: new Map([[draftKey, localReport], ["other:bid:single", localReport]]),
      _editingDetailedEvaluationKey: draftKey,
      _detailedEvaluationDirty: true,
      renderDetailedEvaluation: async () => { rendered = resolveDetailedEvaluationState(controller); },
    };
    const recovery = detailedEvaluationAutosaveFor(controller);
    assert.equal(recovery.save(draftKey, localReport), true);
    const result = await executeDetailedEvaluationSave({
      appController: controller,
      state: {
        pkg, bid, report: localReport, draftKey, criteriaKey, roundType: "single",
        criteria: [localCriterion], baseCriteria: [localCriterion],
        context: { visibleGroups: ["technical"], editableGroups: ["technical"], configuredGroups: ["technical"], technicalEvaluationMethod: "score" },
      },
      root: { querySelectorAll: () => [], querySelector: () => null },
      activeGroup: "technical",
      commit: async () => {
        controller.model.state.goithau = [{ ...pkg, rowVersion: 2, danhGiaHsdtMetadata: JSON.stringify({ criteria: [canonicalCriterion], technicalEvaluationMethod: "pass_fail" }) }];
        controller.model.state.thongtinmothau = [{ ...bid, rowVersion: 2, baoCaoDanhGiaChiTietList: [canonicalReport] }];
        failWrites = failDraftRemoval;
        return { ok: false, conflict: true, serverReloaded: true, data: { errors: [{ code: "ROW_VERSION_CONFLICT" }] } };
      },
    });
    assert.equal(result, false);
    assert.equal(rendered.report.chiTietList[0].nhanXet, "Server note");
    assert.equal(rendered.criteria[0].name, "Server criterion");
    assert.equal(rendered.context.technicalEvaluationMethod, "pass_fail");
    assert.equal(recovery.restore(draftKey), null);
    assert.equal(controller._detailedEvaluationCriteriaOverrides.has(criteriaKey), false);
    assert.equal(controller._technicalEvaluationMethodDrafts.has(criteriaKey), false);
    assert.equal(controller._detailedEvaluationCriteriaOverrides.has("other:single"), true);
    assert.equal(controller._technicalEvaluationMethodDrafts.has("other:single"), true);
    assert.equal(controller._detailedEvaluationDrafts.has("other:bid:single"), true);
    assert.equal(Boolean(controller._detailedEvaluationDirty), false);
    assert.equal(alerts.length, 0);
    assert.equal(toasts.length, failDraftRemoval ? 1 : 0);
    if (failDraftRemoval) assert.equal(toasts[0][2], "warning");
  });
}

test("financial evaluation can complete the contractor report directly", async () => {
  const storage = new Map();
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: "{}",
  };
  const criterion = {
    id: "financial-1",
    stt: "1",
    name: "Giá dự thầu",
    group: "financial",
    required: true,
    resultType: "pass_fail",
  };
  const report = {
    id: "report-1",
    loaiVong: "financial",
    trangThai: "draft",
    chiTietList: [{
      id: "row-1",
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pass",
      noiDungHsdt: "1000000",
    }],
    extension: {},
  };
  const bid = {
    id: "bid-1",
    goiThauId: pkg.id,
    baoCaoDanhGiaChiTietList: [report],
  };
  const model = {
    workspaceStorage: storage,
    state: {
      goithau: [pkg],
      thongtinmothau: [bid],
      hanghoaduthaunhathau: [],
    },
    assertStorageTablesWritable() {},
    commitLocalMutation(table, { records }) {
      const current = this.state[table] || [];
      records.forEach((record) => {
        const index = current.findIndex((item) => String(item.id) === String(record.id));
        if (index >= 0) current[index] = record;
        else current.push(record);
      });
      this.state[table] = current;
    },
  };
  const controller = {
    model,
    view: { customAlert: async () => {} },
    _detailedEvaluationCriteriaOverrides: new Map(),
    _detailedEvaluationDrafts: new Map([[
      "package-1:bid-1:financial",
      report,
    ]]),
    _editingDetailedEvaluationKey: "package-1:bid-1:financial",
    _detailedEvaluationDirty: true,
    renderDetailedEvaluation: async () => {},
  };
  let committedChanges;

  const result = await executeDetailedEvaluationSave({
    appController: controller,
    state: {
      pkg,
      bid,
      report,
      draftKey: "package-1:bid-1:financial",
      criteriaKey: "package-1:financial",
      roundType: "financial",
      criteria: [criterion],
      baseCriteria: [criterion],
      context: {
        visibleGroups: ["financial"],
        editableGroups: ["financial"],
        configuredGroups: ["financial"],
      },
    },
    root: { querySelectorAll: () => [], querySelector: () => null },
    activeGroup: "financial",
    completeReport: true,
    commit: async (_controller, _tables, options) => {
      committedChanges = options.changes.upserts;
      return { ok: true };
    },
  });

  assert.equal(result, true);
  assert.equal(committedChanges.thongtinmothau[0].baoCaoDanhGiaChiTietList.at(-1).trangThai, "completed");
  assert.equal(committedChanges.thongtinmothau[0].danhGiaTaiChinh, "Đạt");
});

test("combined technical group completion projects a numeric technical score", async () => {
  const pkg = {
    id: "package-combined",
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    danhGiaHsdtMetadata: "{}",
  };
  const criterion = {
    id: "technical-1",
    stt: "1",
    name: "Điểm kỹ thuật",
    group: "technical",
    required: true,
    resultType: "score",
    minScore: 0,
    maxScore: 100,
  };
  const report = {
    id: "report-technical-1",
    loaiVong: "technical",
    trangThai: "draft",
    chiTietList: [{
      id: "row-technical-1",
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pass",
      diem: 85,
    }],
    extension: {},
  };
  const bid = {
    id: "bid-combined-1",
    goiThauId: pkg.id,
    danhGiaKyThuat: "Đạt",
    baoCaoDanhGiaChiTietList: [report],
  };
  const model = {
    state: {
      goithau: [pkg],
      thongtinmothau: [bid],
      hanghoaduthaunhathau: [],
    },
    assertStorageTablesWritable() {},
    commitLocalMutation() {},
  };
  const controller = {
    model,
    view: { customAlert: async () => {} },
    _detailedEvaluationCriteriaOverrides: new Map(),
    _detailedEvaluationDrafts: new Map([["package-combined:bid-combined-1:technical", report]]),
    _editingDetailedEvaluationKey: "package-combined:bid-combined-1:technical",
    _detailedEvaluationDirty: true,
    renderDetailedEvaluation: async () => {},
  };
  let committedChanges;
  const result = await executeDetailedEvaluationSave({
    appController: controller,
    state: {
      pkg,
      bid,
      report,
      draftKey: "package-combined:bid-combined-1:technical",
      criteriaKey: "package-combined:technical",
      roundType: "technical",
      criteria: [criterion],
      baseCriteria: [criterion],
      context: {
        visibleGroups: ["technical", "financial"],
        editableGroups: ["technical", "financial"],
        configuredGroups: ["technical", "financial"],
        technicalEvaluationMethod: "score",
      },
    },
    root: { querySelectorAll: () => [], querySelector: () => null },
    activeGroup: "technical",
    completeGroup: true,
    commit: async (_controller, _tables, options) => {
      committedChanges = options.changes.upserts;
      return { ok: true };
    },
  });

  assert.equal(result, true);
  assert.equal(committedChanges.thongtinmothau[0].danhGiaKyThuat, "85");
});

test("combined technical draft omits a legacy categorical technical result", async () => {
  const pkg = {
    id: "package-combined-draft",
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    danhGiaHsdtMetadata: "{}",
  };
  const criterion = {
    id: "technical-draft-1",
    stt: "1",
    name: "Điểm kỹ thuật",
    group: "technical",
    required: true,
    resultType: "score",
    minScore: 0,
    maxScore: 100,
  };
  const report = {
    id: "report-technical-draft-1",
    loaiVong: "technical",
    trangThai: "draft",
    chiTietList: [{
      id: "row-technical-draft-1",
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pass",
      diem: 80,
    }],
    extension: {},
  };
  const bid = {
    id: "bid-combined-draft-1",
    goiThauId: pkg.id,
    danhGiaKyThuat: "Đạt",
    baoCaoDanhGiaChiTietList: [report],
  };
  const model = {
    state: {
      goithau: [pkg],
      thongtinmothau: [bid],
      hanghoaduthaunhathau: [],
    },
    assertStorageTablesWritable() {},
    commitLocalMutation() {},
  };
  const controller = {
    model,
    view: { customAlert: async () => {} },
    _detailedEvaluationCriteriaOverrides: new Map(),
    _detailedEvaluationDrafts: new Map(),
    renderDetailedEvaluation: async () => {},
  };
  let committedBid;
  const result = await executeDetailedEvaluationSave({
    appController: controller,
    state: {
      pkg,
      bid,
      report,
      draftKey: "package-combined-draft:bid-combined-draft-1:technical",
      criteriaKey: "package-combined-draft:technical",
      roundType: "technical",
      criteria: [criterion],
      baseCriteria: [criterion],
      context: {
        visibleGroups: ["technical"],
        editableGroups: ["technical"],
        configuredGroups: ["technical"],
        technicalEvaluationMethod: "score",
      },
    },
    root: { querySelectorAll: () => [], querySelector: () => null },
    activeGroup: "technical",
    commit: async (_controller, _tables, options) => {
      committedBid = options.changes.upserts.thongtinmothau[0];
      return { ok: true };
    },
  });

  assert.equal(result, true);
  assert.equal(Object.prototype.hasOwnProperty.call(committedBid, "danhGiaKyThuat"), false);
});

test("stale Excel import cancels after switching contractor before the parser returns", async () => {
  const criterion = {
    id: "validity",
    stt: "1",
    name: "Tính hợp lệ",
    group: "validity",
    resultType: "pass_fail",
    required: true,
    source: "custom",
  };
  const pkg = {
    id: "pkg-stale-import",
    linhVuc: "Phi tư vấn",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: JSON.stringify({
      criteria: [criterion],
      technicalEvaluationMethod: "pass_fail",
    }),
  };
  const makeReport = (id, note) => ({
    id,
    loaiVong: "single",
    trangThai: "draft",
    chiTietList: [{
      id: `row-${id}`,
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pass",
      nhanXet: note,
      diem: null,
    }],
    extension: {
      completedGroups: ["validity", "capacity", "technical"],
      groupResults: { validity: "Đạt", capacity: "Đạt", technical: "Đạt" },
    },
  });
  const bidA = {
    id: "bid-a-stale-import",
    goiThauId: pkg.id,
    tenNhaThau: "Nhà thầu A",
    baoCaoDanhGiaChiTietList: [makeReport("report-a-stale-import", "Existing A")],
  };
  const bidB = {
    id: "bid-b-stale-import",
    goiThauId: pkg.id,
    tenNhaThau: "Nhà thầu B",
    baoCaoDanhGiaChiTietList: [makeReport("report-b-stale-import", "Existing B")],
  };
  const storage = new Map();
  const persisted = [];
  const alerts = [];
  const renders = [];
  const root = { querySelector: () => null, querySelectorAll: () => [] };
  const controller = {
    selectedEvaluationBidId: bidA.id,
    selectedDetailedEvaluationTab: "validity",
    view: {
      getActiveElement(id) {
        if (id === "danhgiahsdt-goithau-select") return { value: pkg.id };
        if (id === "danhgiahsdt-detail-view") return root;
        return null;
      },
      customAlert: async (...args) => alerts.push(args),
    },
    model: {
      workspaceStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      state: {
        goithau: [pkg],
        thongtinmothau: [bidA, bidB],
        hanghoaduthaunhathau: [],
      },
      hasPermission: () => true,
      getWorkspaceToken: () => "workspace-stale-import",
      isWorkspaceCurrent: () => true,
      assertStorageTablesWritable() {},
      commitLocalMutation() {},
      async persistChanges(table, changes) {
        persisted.push({ table, ...structuredClone(changes) });
      },
      async autoSync() {
        return { ok: true };
      },
    },
    async renderDetailedEvaluation() {
      renders.push(this.selectedEvaluationBidId);
    },
  };
  resolveDetailedEvaluationState(controller);

  let resolveParser;
  let parserEntered;
  const parserReady = new Promise((resolve) => {
    parserEntered = resolve;
  });
  const originalParse = excelParseWorkerClient.parse;
  excelParseWorkerClient.parse = async () => {
    parserEntered();
    return new Promise((resolve) => {
      resolveParser = resolve;
    });
  };
  const file = {
    name: "stale-import.xls",
    size: 8,
    async arrayBuffer() {
      return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer;
    },
  };
  try {
    const importing = importDetailedEvaluationExcel.call(controller, file);
    await parserReady;
    controller.selectedEvaluationBidId = bidB.id;
    resolveDetailedEvaluationState(controller);
    resolveParser([
      {
        name: "Sheet1",
        rows: [["STT", "Kết quả", "Nhận xét"], ["1", "Đạt", "Imported A"]],
      },
    ]);

    assert.equal(await importing, false);
    assert.equal(persisted.length, 0);
    assert.equal(
      controller._detailedEvaluationDrafts.get(`${pkg.id}:${bidA.id}:single`)
        ?.chiTietList?.[0]?.nhanXet,
      "Existing A",
    );
    assert.equal(
      controller._detailedEvaluationDrafts.get(`${pkg.id}:${bidB.id}:single`)
        ?.chiTietList?.[0]?.nhanXet,
      "Existing B",
    );
    assert.notEqual(controller._detailedEvaluationDirty, true);
    assert.deepEqual(renders, []);
    assert.deepEqual(alerts, []);
  } finally {
    excelParseWorkerClient.parse = originalParse;
  }
});
