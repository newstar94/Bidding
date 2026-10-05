import assert from "node:assert/strict";
import test from "node:test";

import { executeDetailedEvaluationSave } from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";

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
