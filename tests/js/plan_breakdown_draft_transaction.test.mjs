import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { serializeOutboundRecord } from "../../frontend/app/outboundSerializer.js";
import { persistPackageFormChanges } from "../../frontend/packages/GoiThauWorkflow.js";
import { deleteGoiThau } from "../../frontend/packages/packageLifecycleWorkflow.js";
import {
  backToPlanDraft,
  handleKeHoachSubmit,
  openPlanBreakdownModal,
  renderBreakdownPackagesList,
  savePlanBreakdown,
} from "../../frontend/plans/KeHoachWorkflow.js";
import {
  applyDraftAssignmentSelection,
  capturePlanBreakdownDraft,
  boundProcurementRevisionChanges,
  collectPlanBreakdownDraftChanges,
  restorePlanBreakdownDraft,
} from "../../frontend/plans/planBreakdownDraft.js";
import {
  fillPackageFormFromProcurementDraft,
  fillPlanFormFromProcurementDraft,
  materializeProcurementRevisionDraft,
  materializeProcurementRevisionFromPrevious,
} from "../../frontend/procurement/ProcurementDraftWorkflow.js";
import { closeModal } from "../../frontend/app/BiddingControllerUI.js";
import {
  completeProcurementPlanImportRevision,
  startProcurementPlanImport,
} from "../../frontend/procurement/PlanImportWizard.js";
import { SequentialRevisionController } from "../../frontend/procurement/SequentialRevisionController.js";

test("package procurement draft fills lifecycle and tender milestone controls", () => {
  const controls = new Map([
    "gt-ma", "gt-ten", "gt-gia", "gt-thoigian", "gt-linhvuc",
    "gt-hinhthuc", "gt-phuongthuc", "gt-phuongphapdanhgia", "gt-nguonvon",
    "gt-loaihopdong", "gt-thoigiantochuc", "gt-thoigianbatdautochuc",
    "gt-quatmang", "gt-trongnuocquocte", "gt-tuychonmuathem", "gt-phanlo",
    "gt-giatribaomothau", "gt-soquyetdinh", "gt-ngayquyetdinh",
    "gt-thoigiandangtai", "gt-thoigiandongthau", "gt-thoigianmothau",
    "gt-thoigianmoehsdxtc", "gt-trangthai",
  ].map((id) => [id, { id, value: "", disabled: false, dispatchEvent() {} }]));
  const document = { getElementById: (id) => controls.get(id) || null };
  fillPackageFormFromProcurementDraft(document, {
    maGoiThau: "IB2600374868",
    trangThai: "Đang chấm thầu",
    giaTriBaoDamDuThau: 52_183_040,
    soQuyetDinh: "123/QĐ-E-HSMT",
    ngayQuyetDinh: "2026-07-15T00:00:00",
    thoiGianDangTai: "2026-07-16T09:00:00",
    thoiGianDongThau: "2026-08-03T13:00:00",
    thoiGianMoThau: "2026-08-03T13:08:42",
    thoiGianMoEhsdxtc: "2026-08-03T16:20:00",
  }, {
    model: {
      formatVND: (value) => String(value),
      formatForDateInput: (value) => `DATE:${value}`,
      formatForDatetimeLocal: (value) => `DATETIME:${value}`,
    },
  });

  assert.equal(controls.get("gt-trangthai").value, "Đang chấm thầu");
  assert.equal(controls.get("gt-giatribaomothau").value, "52183040");
  assert.equal(controls.get("gt-soquyetdinh").value, "123/QĐ-E-HSMT");
  assert.equal(controls.get("gt-ngayquyetdinh").value, "DATE:2026-07-15T00:00:00");
  assert.equal(controls.get("gt-thoigiandangtai").value, "DATETIME:2026-07-16T09:00:00");
  assert.equal(controls.get("gt-thoigianmothau").value, "DATETIME:2026-08-03T13:08:42");
  assert.equal(controls.get("gt-thoigianmoehsdxtc").value, "DATETIME:2026-08-03T16:20:00");
});

test("prepared plan revision materializes source packages into one memory-only breakdown draft", () => {
  const state = {
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const result = materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: {
      maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 00",
      loaiHinhMuaSam: "Dự án", phienBan: "00",
      sourceRevision: { revisionId: "rev-00", revisionNumber: "00" },
    },
    packageDrafts: [{
      maGoiThau: "IB2600000001", tenGoiThau: "Gói A", giaGoiThau: 100,
      trangThai: "PREPARING",
      phanLo: true, danhSachPhanLo: [{ lotNo: "01", lotName: "Lô 1", lotPrice: 100 }],
      sourceRevision: { revisionId: "rev-00", revisionNumber: "00", packageObservationId: "detail-a" },
    }],
  }, {
    createId: (kind) => `${kind}-draft`,
    timestamp: "2026-08-13 10:00:00",
  });

  assert.equal(state.kehoach.length, 1);
  assert.equal(state.goithau.length, 1);
  assert.equal(state.goithau[0].keHoachId, state.kehoach[0].id);
  assert.equal(state.goithau[0].phanLo, "Có");
  assert.equal(state.goithau[0].trangThai, "Chuẩn bị");
  assert.equal(state.goithau[0].phanLoList[0].maPhanLo, "01");
  assert.equal(state.goithau[0].phienBan, "00");
  assert.equal(state.goithau[0].sourceRevision.packageObservationId, "detail-a");
  assert.equal(state.kehoach[0]._procurementImportCurrent, true);
  assert.equal(state.goithau[0]._procurementImportCurrent, true);
  assert.equal(result.draft.active, true);
  assert.deepEqual(result.draft.snapshot.goithau, []);
});

test("revision 01 keeps procurement purchase-option flags sync-safe for inherited and new packages", () => {
  let sequence = 0;
  const state = {
    chudautu: [], kehoach: [], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const revision00 = materializeProcurementRevisionDraft(state, {
    revisionNumber: "00",
    planDraft: { maKeHoach: "PL2600225773", phienBan: "00" },
    packageDrafts: [{
      tenGoiThau: "Goi ke thua",
      tuyChonMuaThem: false,
      sourceRevision: { stablePackageId: "stable-inherited", revisionNumber: "00" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 10:00:00",
  });

  assert.equal(revision00.packages[0].tuyChonMuaThem, "Không");

  const revision01 = materializeProcurementRevisionFromPrevious(
    state,
    revision00.plan.id,
    {
      revisionNumber: "01",
      planDraft: { maKeHoach: "PL2600225773", phienBan: "01" },
      packageDrafts: [
        {
          tenGoiThau: "Goi ke thua 01",
          tuyChonMuaThem: true,
          sourceRevision: { stablePackageId: "stable-inherited", revisionNumber: "01" },
        },
        {
          tenGoiThau: "Goi moi 01",
          tuyChonMuaThem: false,
          sourceRevision: { stablePackageId: "stable-new", revisionNumber: "01" },
        },
      ],
    },
    {
      createId: (kind) => `${kind}-${++sequence}`,
      timestamp: "2026-08-13 11:00:00",
    },
  );

  assert.deepEqual(
    revision01.packages.map((row) => row.tuyChonMuaThem),
    ["Có", "Không"],
  );
  assert.ok(revision01.packages.every((row) => typeof row.tuyChonMuaThem === "string"));
  assert.deepEqual(
    revision01.packages.map(
      (row) => serializeOutboundRecord(row, "goithau").tuyChonMuaThem,
    ),
    ["Có", "Không"],
  );
});

test("revision 01 inherits local-only aggregate state and applies source-owned package fields", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-00", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600000001", ghiChuNoiBo: "Giữ local",
    }],
    goithau: [{
      id: "pkg-00", rootId: "pkg-00", phienBan: "01", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Tên 00", giaGoiThau: 100,
      ghiChuNoiBo: "Ghi chú local",
      sourceRevision: { stablePackageId: "stable-a" },
    }],
    goithauhanghoa: [{ id: "goods-00", goiThauId: "pkg-00" }],
    thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [{ id: "assign-00", targetId: "pkg-00", type: "goithau", empId: "user-1" }],
  };
  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01", phienBan: "01" },
    packageDrafts: [{
      tenGoiThau: "Tên 01", giaGoiThau: 200,
      sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 11:00:00",
  });

  assert.equal(result.plan.phienBan, "01");
  assert.equal(state.kehoach.find((row) => row.id === "plan-00")._procurementImportCurrent, false);
  assert.equal(result.plan._procurementImportCurrent, true);
  assert.equal(state.goithau.find((row) => row.id === "pkg-00")._procurementImportCurrent, false);
  assert.equal(result.packages[0]._procurementImportCurrent, true);
  assert.equal(result.plan.rootId, "plan-00");
  assert.equal(result.plan.ghiChuNoiBo, "Giữ local");
  assert.equal(result.packages[0].tenGoiThau, "Tên 01");
  assert.equal(result.packages[0].giaGoiThau, 200);
  assert.equal(
    result.packages[0].phienBan,
    "00",
    "a plan revision must not become a package revision",
  );
  assert.equal(result.packages[0].ghiChuNoiBo, "Ghi chú local");
  assert.equal(result.packages[0].keHoachId, result.plan.id);
  assert.equal(state.assignments.at(-1).targetId, result.packages[0].id);
  assert.equal(result.draft.active, true);
});

test("linked notice version independently advances the package version", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600225773",
    }],
    goithau: [{
      id: "pkg-00", rootId: "pkg-root", phienBan: "00", isLatest: 1,
      keHoachId: "plan-00", tenGoiThau: "Gói A 00",
      noticeLink: { state: "LINKED", noticeNo: "IB2600000001", noticeVersion: "00" },
      sourceRevision: { stablePackageId: "stable-a" },
    }],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600225773", phienBan: "01" },
    packageDrafts: [{
      tenGoiThau: "Gói A thông báo 01",
      noticeLink: { state: "LINKED", noticeNo: "IB2600000001", noticeVersion: "01" },
      sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 12:00:00",
  });

  assert.equal(result.plan.phienBan, "01");
  assert.equal(result.packages[0].phienBan, "01");
});

test("next plan revision matches changed detail ids by package symbol and drops removed packages", () => {
  let sequence = 0;
  const state = {
    chudautu: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
      maKeHoach: "PL2600000001",
    }],
    goithau: [
      {
        id: "pkg-a-00", rootId: "pkg-a-root", phienBan: "00", isLatest: 1,
        keHoachId: "plan-00", soHieuGoiThau: "A", tenGoiThau: "A 00",
        sourceRevision: { packageObservationId: "detail-a-00" },
      },
      {
        id: "pkg-b-00", rootId: "pkg-b-root", phienBan: "00", isLatest: 1,
        keHoachId: "plan-00", soHieuGoiThau: "B", tenGoiThau: "B 00",
        sourceRevision: { packageObservationId: "detail-b-00" },
      },
    ],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };

  const result = materializeProcurementRevisionFromPrevious(state, "plan-00", {
    revisionNumber: "01",
    planDraft: { maKeHoach: "PL2600000001", phienBan: "01" },
    packageDrafts: [{
      soHieuGoiThau: "A", tenGoiThau: "A 01",
      sourceRevision: { packageObservationId: "detail-a-01", revisionNumber: "01" },
    }],
  }, {
    createId: (kind) => `${kind}-${++sequence}`,
    timestamp: "2026-08-13 12:00:00",
  });

  assert.deepEqual(result.packages.map((row) => row.tenGoiThau), ["A 01"]);
  assert.equal(result.packages[0].rootId, "pkg-a-root");
  assert.equal(
    state.goithau.filter((row) => row.keHoachId === result.plan.id).length,
    1,
  );
  assert.equal(state.goithau.find((row) => row.id === "pkg-b-00").isLatest, 1);
});

test("saving a package inside plan breakdown remains a memory-only draft", async () => {
  const calls = [];
  const controller = {
    model: {
      commitLocalMutation: () => calls.push("commitLocalMutation"),
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
    },
    autoSync: async () => {
      calls.push("autoSync");
      return { ok: true };
    },
  };

  const result = await persistPackageFormChanges(controller, {
    goithau: [{ id: "pkg-draft", keHoachId: "plan-draft" }],
    kehoach: [{ id: "plan-draft" }],
  }, { draft: true });

  assert.deepEqual(result, { ok: true, draft: true });
  assert.deepEqual(calls, [], "a child modal must not make the draft durable or sync it");
});

test("draft assignments are changed in memory without calling model persistence methods", () => {
  const state = {
    assignments: [
      { id: "a-old", targetId: "pkg-1", type: "goithau", empId: "employee-old" },
    ],
  };
  const model = {
    state,
    addRecord: () => assert.fail("draft assignment must not call addRecord"),
    deleteRecord: () => assert.fail("draft assignment must not call deleteRecord"),
  };

  applyDraftAssignmentSelection(model, {
    targetId: "pkg-1",
    type: "goithau",
    selectedIds: ["employee-new"],
    createId: () => "a-new",
  });

  assert.deepEqual(state.assignments, [
    { id: "a-new", targetId: "pkg-1", type: "goithau", empId: "employee-new" },
  ]);
});

test("committing plan breakdown includes its draft packages, children, assignments and removals", () => {
  const snapshot = {
    assignments: [
      { id: "a-removed", targetId: "pkg-1", type: "goithau", empId: "employee-old" },
    ],
  };
  const state = {
    kehoach: [{ id: "plan-1", rootId: "plan-1" }],
    goithau: [{ id: "pkg-1", keHoachId: "plan-1" }],
    goithauhanghoa: [{ id: "goods-1", goiThauId: "pkg-1" }],
    thongtinmothau: [{ id: "opening-1", goiThauId: "pkg-1" }],
    hanghoaduthaunhathau: [{ id: "bid-goods-1", goiThauId: "pkg-1" }],
    assignments: [
      { id: "a-new", targetId: "pkg-1", type: "goithau", empId: "employee-new" },
    ],
  };

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-1",
    snapshot,
  });

  assert.deepEqual(changes.upserts.goithau.map((row) => row.id), ["pkg-1"]);
  assert.deepEqual(changes.upserts.goithauhanghoa.map((row) => row.id), ["goods-1"]);
  assert.deepEqual(changes.upserts.thongtinmothau.map((row) => row.id), ["opening-1"]);
  assert.deepEqual(changes.upserts.hanghoaduthaunhathau.map((row) => row.id), ["bid-goods-1"]);
  assert.deepEqual(changes.upserts.assignments.map((row) => row.id), ["a-new"]);
  assert.deepEqual(changes.deletions.assignments, ["a-removed"]);
});

test("imported revision commit excludes immutable predecessor plan and package rows", () => {
  const state = {
    kehoach: [
      { id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 0 },
      { id: "plan-01", rootId: "plan-root", phienBan: "01", isLatest: 1 },
    ],
    goithau: [
      { id: "pkg-00", rootId: "pkg-root", keHoachId: "plan-00", isLatest: 0 },
      { id: "pkg-01", rootId: "pkg-root", keHoachId: "plan-01", isLatest: 1 },
    ],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [], chudautu: [],
  };
  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01",
    snapshot: {
      kehoach: [{ id: "plan-00", rootId: "plan-root" }],
      goithau: [{ id: "pkg-00", rootId: "pkg-root", keHoachId: "plan-00" }],
      assignments: [], chudautu: [], goithauhanghoa: [], thongtinmothau: [],
      hanghoaduthaunhathau: [],
    },
  });

  assert.ok(changes.upserts.kehoach.some((row) => row.id === "plan-00"));
  assert.ok(changes.upserts.goithau.some((row) => row.id === "pkg-00"));
  const bounded = boundProcurementRevisionChanges(changes, "plan-01");
  assert.deepEqual(bounded.upserts.kehoach.map((row) => row.id), ["plan-01"]);
  assert.deepEqual(bounded.upserts.goithau.map((row) => row.id), ["pkg-01"]);
});

test("cancelling plan breakdown restores the complete aggregate and drops memory-only rows", () => {
  const state = {
    chudautu: [],
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const draft = capturePlanBreakdownDraft(state, { action: "create" });
  state.kehoach.push({ id: "plan-draft" });
  state.chudautu.push({ id: "investor-draft", maChuDauTu: "INV-1" });
  state.goithau.push({ id: "pkg-draft", keHoachId: "plan-draft" });
  state.goithauhanghoa.push({ id: "goods-draft", goiThauId: "pkg-draft" });
  state.assignments.push({
    id: "assignment-draft",
    targetId: "pkg-draft",
    type: "goithau",
    empId: "employee-1",
  });

  restorePlanBreakdownDraft({ state }, draft);

  assert.deepEqual(state, {
    chudautu: [],
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  });
});

test("cancelling plan revision 01 keeps committed 00 and removes only draft 01", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const committedPlan = {
    id: "plan-00", rootId: "plan-root", phienBan: "00", isLatest: 1,
    maKeHoach: "PL2600000001",
  };
  const committedPackage = {
    id: "package-00", rootId: "package-root", phienBan: "00", isLatest: 1,
    keHoachId: "plan-00", tenGoiThau: "Gói A 00",
    sourceRevision: { stablePackageId: "stable-a" },
  };
  const state = {
    chudautu: [], kehoach: [committedPlan], goithau: [committedPackage],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [],
    assignments: [],
  };
  const revision01 = materializeProcurementRevisionFromPrevious(
    state,
    "plan-00",
    {
      revisionNumber: "01",
      planDraft: { maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01" },
      packageDrafts: [{
        tenGoiThau: "Gói A 01", giaGoiThau: 200,
        sourceRevision: { stablePackageId: "stable-a", revisionNumber: "01" },
      }],
    },
    { createId: (kind) => `${kind}-01`, timestamp: "2026-08-13 12:00:00" },
  );
  revision01.packages[0].giaGoiThau = 250;
  const cancellations = [];
  const controller = {
    model: {
      state,
      replaceTableState(table, rows) { this.state[table] = rows; },
    },
    planBreakdownDraft: revision01.draft,
    backupKeHoachState: null,
    backupGoiThauState: null,
    tempPlanData: { id: revision01.plan.id },
    tempPlanAction: "create",
    procurementPlanImport: { controller: { cancel() {} } },
    cancelActiveProcurementImportSession: async () => cancellations.push("cancel"),
    view: {
      closeModal: () => undefined,
      renderKeHoachTable: () => undefined,
      renderGoiThauTable: () => undefined,
    },
    switchTab: () => undefined,
  };

  try {
    await closeModal.call(controller, "modal-plan-breakdown");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(state.kehoach.map((row) => row.id), ["plan-00"]);
  assert.deepEqual(state.goithau.map((row) => row.id), ["package-00"]);
  assert.equal(state.kehoach[0].isLatest, 1);
  assert.equal(state.goithau[0].isLatest, 1);
  assert.equal(state.goithau[0].tenGoiThau, "Gói A 00");
  assert.deepEqual(cancellations, ["cancel"]);
});

test("saving plan breakdown commits the new plan and package aggregate in one sync", async () => {
  const previousDocument = globalThis.document;
  const emptyBody = { querySelectorAll: () => [] };
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      if (id.startsWith("tbody-breakdown-")) return emptyBody;
      return null;
    },
  };
  const persisted = [];
  let syncCount = 0;
  const state = {
    chudautu: [{ id: "investor-draft", rootId: "investor-draft", phienBan: "00", isLatest: 1 }],
    kehoach: [{
      id: "plan-draft",
      rootId: "plan-draft",
      phienBan: "00",
      isLatest: 1,
      isTongMucTuDong: false,
    }],
    goithau: [{ id: "pkg-draft", rootId: "pkg-draft", keHoachId: "plan-draft" }],
    goithauhanghoa: [{ id: "goods-draft", goiThauId: "pkg-draft" }],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [{
      id: "assignment-draft",
      targetId: "pkg-draft",
      type: "goithau",
      empId: "employee-1",
    }],
  };
  const controller = {
    tempPlanAction: "create",
    tempPlanData: { id: "plan-draft" },
    backupKeHoachState: [],
    backupGoiThauState: [],
    planBreakdownDraft: {
      active: true,
      action: "create",
      planId: "plan-draft",
      snapshot: {
        chudautu: [],
        kehoach: [],
        goithau: [],
        goithauhanghoa: [],
        thongtinmothau: [],
        hanghoaduthaunhathau: [],
        assignments: [],
      },
    },
    model: {
      state,
      parseVND: Number,
      commitLocalMutation() {},
      async persistChanges(table, changes) {
        persisted.push({ table, changes });
      },
      async flushMutationOutbox() {},
    },
    autoSync: async () => {
      syncCount += 1;
      return { ok: true };
    },
    updateBreakdownTotal() {},
    closeModal() {},
    view: {
      renderKeHoachTable: async () => {},
      renderGoiThauTable: async () => {},
      customAlert: async () => {},
    },
  };

  try {
    await savePlanBreakdown.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(syncCount, 1);
  assert.deepEqual(
    persisted.map(({ table }) => table).sort(),
    [
      "assignments",
      "chudautu",
      "goithau",
      "goithauhanghoa",
      "hanghoaduthaunhathau",
      "kehoach",
      "thongtinmothau",
    ],
  );
  const packageWrite = persisted.find(({ table }) => table === "goithau");
  assert.deepEqual(packageWrite.changes.upserts.map((row) => row.id), ["pkg-draft"]);
  assert.equal(controller.planBreakdownDraft, null);
});

test("inline Plan import runs 00 then 01 through the existing forms and breakdown draft", async () => {
  const previousDocument = globalThis.document;
  const previousEvent = globalThis.Event;
  const previousElement = globalThis.Element;
  const previousLucide = globalThis.lucide;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  class FakeEvent {
    constructor(type) { this.type = type; }
  }
  const control = (value = "") => ({
    value, dataset: {}, innerHTML: "", hidden: false, disabled: false,
    classList: { add() {}, remove() {}, contains: () => true },
    setAttribute(name, next) { this[name] = String(next); },
    getAttribute(name) { return this[name] ?? null; },
    removeAttribute(name) { delete this[name]; },
    dispatchEvent() {}, focus() {}, click() { this.onclick?.(); },
    querySelectorAll: () => [],
  });
  const controls = new Map();
  [
    "form-kehoach", "form-kehoach-id", "kh-ma", "kh-ten", "kh-loaihinh",
    "kh-duan", "kh-chudautuid", "kh-donvitrinhcdt",
    "kh-tenviettatdonvitrinh", "kh-tongmuc", "kh-ngaypheduyet",
    "kh-quyetdinh", "kh-thoigiandang", "kh-nguonvon", "kh-thoigian-duan",
    "kh-maduan", "kh-soqdpheduyetduan", "kh-ngayqdpheduyetduan",
    "kh-coquanpheduyetduan", "kh-diadiem-quymo", "kh-thongtinkhac",
    "kh-pheduyet", "kh-ngaytrinhkehoach", "kh-sototrinhkehoach",
    "kh-sototrinhdutoankehoach", "kh-ngaytrinhdutoan",
    "kh-sototrinhdutoan", "kh-ngaypheduyetdutoan",
    "kh-quyetdinhpheduyetdutoan", "modal-plan-breakdown",
    "breakdown-plan-id", "breakdown-modal-subtitle", "btn-breakdown-add-package",
    "btn-save-plan-breakdown", "btn-back-plan-breakdown", "gt-kehoachid",
    "tbody-breakdown-dathuchien", "tbody-breakdown-khongapdung",
    "tbody-breakdown-chuadudieuKien", "tbody-breakdown-goithau",
    "pane-dathuchien",
  ].forEach((id) => controls.set(id, control()));
  controls.get("kh-tongmuc").getAttribute = (name) => (
    name === "data-initial-val" ? "" : name === "data-was-auto" ? "false" : null
  );
  for (const id of [
    "tbody-breakdown-dathuchien", "tbody-breakdown-khongapdung",
    "tbody-breakdown-chuadudieuKien",
  ]) controls.get(id).querySelectorAll = () => [];
  const tab = control();
  tab.getAttribute = () => "dathuchien";
  const pane = controls.get("pane-dathuchien");
  globalThis.document = {
    getElementById: (id) => controls.get(id) || null,
    querySelectorAll(selector) {
      if (selector === ".breakdown-tab-btn") return [tab];
      if (selector === ".breakdown-pane") return [pane];
      return [];
    },
  };
  globalThis.Event = FakeEvent;
  globalThis.Element = class FakeElement {};
  globalThis.lucide = { createIcons() {} };

  const revisionDrafts = {
    "00": {
      familyNo: "PL2600000001", revisionNumber: "00",
      planDraft: {
        maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 00",
        loaiHinhMuaSam: "Dự toán mua sắm", tenDuAnDuToan: "Dự toán A",
        tongMucDauTu: 300, ngayPheDuyet: "2026-01-01",
        quyetDinhPheDuyet: "01/QĐ", pheDuyet: "Dự toán và kế hoạch",
        investorSource: { code: "vn123456789" },
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
        },
      },
      packageDrafts: [{
        soHieuGoiThau: "A", tenGoiThau: "Gói A 00", giaGoiThau: 100,
        thoiGianThucHien: "30 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý I/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
          stablePackageId: "stable-a", packageObservationId: "detail-a-00",
        },
      }, {
        soHieuGoiThau: "B", tenGoiThau: "Gói B 00", giaGoiThau: 200,
        thoiGianThucHien: "60 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý II/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-00",
          revisionNumber: "00", revisionDigest: "sha256:00",
          stablePackageId: "stable-b", packageObservationId: "detail-b-00",
        },
      }],
    },
    "01": {
      familyNo: "PL2600000001", revisionNumber: "01",
      planDraft: {
        maKeHoach: "PL2600000001", tenKeHoach: "Kế hoạch 01",
        loaiHinhMuaSam: "Dự toán mua sắm", tenDuAnDuToan: "Dự toán A",
        tongMucDauTu: 350, ngayPheDuyet: "2026-02-01",
        quyetDinhPheDuyet: "02/QĐ", pheDuyet: "Dự toán và kế hoạch",
        investorSource: { code: "vn123456789" },
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
        },
      },
      packageDrafts: [{
        soHieuGoiThau: "A", tenGoiThau: "Gói A 01", giaGoiThau: 150,
        thoiGianThucHien: "45 ngày", nguonVon: "Nguồn điều chỉnh",
        thoiGianToChuc: "45 ngày", thoiGianBatDauToChuc: "Quý III/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
          stablePackageId: "stable-a", packageObservationId: "detail-a-01",
        },
      }, {
        soHieuGoiThau: "B", tenGoiThau: "Gói B 01", giaGoiThau: 200,
        thoiGianThucHien: "60 ngày", nguonVon: "Ngân sách",
        thoiGianToChuc: "30 ngày", thoiGianBatDauToChuc: "Quý II/2026",
        sourceRevision: {
          sessionId: "session-plan", provider: "MUASAMCONG",
          familyNo: "PL2600000001", revisionId: "plan-01",
          revisionNumber: "01", revisionDigest: "sha256:01",
          stablePackageId: "stable-b", packageObservationId: "detail-b-01",
        },
      }],
    },
  };
  const loaded = [];
  const sequential = new SequentialRevisionController({
    revisions: [{ revisionNumber: "01" }, { revisionNumber: "00" }],
    loadRevision: async (revision) => {
      loaded.push(revision.revisionNumber);
      return structuredClone(revisionDrafts[revision.revisionNumber]);
    },
    saveRevision: async () => ({ ok: true }),
  });
  const firstDraft = await sequential.loadCurrent();
  const persistedRevisions = [];
  const packageModalEdits = [];
  const state = {
    chudautu: [{
      id: "investor-1", rootId: "investor-1", maChuDauTu: "vn123456789",
      phienBan: "00", isLatest: 1,
    }],
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const model = {
    state, workspaceStorage: null, getWorkspaceToken: () => "org-1",
    getLatestChuDauTu: () => state.chudautu.filter((row) => row.isLatest == 1),
    getCurrentDateTimeString: () => "2026-08-13 10:00:00",
    getLatestPackagesForPlan: (planId) => state.goithau.filter(
      (row) => String(row.keHoachId) === String(planId) && row.isLatest == 1,
    ),
    getPlanBaseCode: (value) => value,
    getPackageBaseCode: (value) => value,
    getVersionLabel: (value) => `Phiên bản ${value}`,
    formatCurrency: (value) => String(value), formatVND: (value) => String(value),
    formatForDateInput: (value) => value,
    formatForDatetimeLocal: (value) => value,
    convertDMYToYMD: (value) => value,
    convertDMYHMSToYMDHMS: (value) => value,
    parseVND: Number,
    commitLocalMutation() {}, markDeleted() {},
    async persistChanges() {}, async flushMutationOutbox() {},
  };
  const controller = {
    model,
    view: {
      validateForm: () => true, focusInvalidControl() {},
      closeModal() {}, openModal() {}, getStatusBadge: (value) => value,
      renderKeHoachTable: async () => {}, renderGoiThauTable: async () => {},
      customConfirm: async () => true, customAlert: async () => {},
    },
    plans: {
      edit: async (id) => {
        const plan = state.kehoach.find((row) => row.id === id);
        controls.get("form-kehoach-id").value = id;
        fillPlanFormFromProcurementDraft(globalThis.document, plan, model);
        controls.get("kh-chudautuid").value = plan.chuDauTuId || "investor-1";
      },
    },
    packages: { edit: async (id) => packageModalEdits.push(id) },
    addBreakdownRow() {}, updateBreakdownTotal() {}, recalculatePlanTotal() {},
    loadBreakdownPackageDetails: async () => {},
    renderBreakdownPackagesList,
    openPlanBreakdownModal,
    closeModal: async () => {},
    autoSync: async () => {
      const current = state.kehoach.find((row) => row._procurementImportCurrent);
      persistedRevisions.push({
        revision: current.phienBan,
        packages: state.goithau.filter((row) => row.keHoachId === current.id)
          .map((row) => ({
            name: row.tenGoiThau,
            price: row.giaGoiThau,
            version: row.phienBan,
          })),
      });
      return { ok: true };
    },
  };
  controller.startProcurementPlanImport = startProcurementPlanImport.bind(controller);
  controller.completeProcurementPlanImportRevision = (
    completeProcurementPlanImportRevision.bind(controller)
  );
  controller.handleKeHoachSubmit = handleKeHoachSubmit.bind(controller);
  controller.savePlanBreakdown = savePlanBreakdown.bind(controller);

  try {
    await controller.startProcurementPlanImport({
      session: {
        sessionId: "session-plan", kind: "PLAN", familyNo: "PL2600000001",
        revisions: [{ revisionNumber: "00" }, { revisionNumber: "01" }],
      },
      controller: sequential, currentDraft: firstDraft,
      client: { cancelImportSession: async () => {} },
    });
    await controller.handleKeHoachSubmit({ preventDefault() {} });
    const plan00 = state.kehoach.find((row) => row.phienBan === "00");
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói A 00/);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói B 00/);

    const packageA00 = state.goithau.find(
      (row) => row.keHoachId === plan00.id && row.tenGoiThau === "Gói A 00",
    );
    await controller.packages.edit(packageA00.id);
    packageA00.giaGoiThau = 125;
    await persistPackageFormChanges(controller, { goithau: [packageA00] }, { draft: true });
    controller.renderBreakdownPackagesList(plan00.id);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, />125</);
    assert.deepEqual(persistedRevisions, [], "package modal save remains memory-only");

    await controller.savePlanBreakdown();
    assert.equal(persistedRevisions[0].revision, "00");
    assert.ok(persistedRevisions[0].packages.some((row) => row.price === 125));
    assert.deepEqual(loaded, ["00", "01"]);
    assert.equal(controls.get("form-kehoach-id").value, controller.procurementPlanImport.currentPlanId);

    await controller.handleKeHoachSubmit({ preventDefault() {} });
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói A 01/);
    assert.match(controls.get("tbody-breakdown-goithau").innerHTML, /Gói B 01/);
    await controller.savePlanBreakdown();

    assert.deepEqual(persistedRevisions.map((row) => row.revision), ["00", "01"]);
    assert.ok(persistedRevisions[1].packages.some(
      (row) => row.name === "Gói A 01" && row.price === 150,
    ));
    assert.ok(
      persistedRevisions[1].packages.every((row) => row.version === "00"),
      "plan version 01 must not create package version 01",
    );
    assert.deepEqual(packageModalEdits, [packageA00.id]);
    assert.equal(controller.procurementPlanImport, null);
  } finally {
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousIsSupported;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousEvent === undefined) delete globalThis.Event;
    else globalThis.Event = previousEvent;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    if (previousLucide === undefined) delete globalThis.lucide;
    else globalThis.lucide = previousLucide;
  }
});

test("pending imported investor is part of plan breakdown commit and rollback boundary", () => {
  const snapshot = {
    chudautu: [], kehoach: [], goithau: [], goithauhanghoa: [],
    thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.chudautu.push({
    id: "investor-draft", rootId: "investor-draft", phienBan: "00",
    isLatest: 1, maChuDauTu: "INV-1", tenChuDauTu: "Chủ đầu tư A",
  });
  state.kehoach.push({ id: "plan-draft", chuDauTuId: "investor-draft" });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-draft", snapshot,
  });
  assert.deepEqual(changes.upserts.chudautu.map((row) => row.id), ["investor-draft"]);
  restorePlanBreakdownDraft({ state }, { snapshot });
  assert.deepEqual(state.chudautu, []);
});

test("next plan revision reuses its investor without deleting the master record", () => {
  const investor = {
    id: "investor-existing", rootId: "investor-existing", phienBan: "00",
    isLatest: 1, rowVersion: 1, maChuDauTu: "INV-1",
  };
  const snapshot = {
    chudautu: [structuredClone(investor)],
    kehoach: [{ id: "plan-00", rootId: "plan-root", chuDauTuId: investor.id }],
    goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.kehoach.push({
    id: "plan-01", rootId: "plan-root", phienBan: "01",
    chuDauTuId: investor.id,
  });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01", snapshot,
  });

  assert.deepEqual(changes.upserts.chudautu, []);
  assert.equal(changes.deletions.chudautu, undefined);
});

test("an unsynced investor already present in the draft snapshot remains an upsert", () => {
  const investor = {
    id: "investor-pending", rootId: "investor-pending", phienBan: "00",
    isLatest: 1, maChuDauTu: "INV-PENDING",
  };
  const snapshot = {
    chudautu: [structuredClone(investor)],
    kehoach: [], goithau: [], goithauhanghoa: [], thongtinmothau: [],
    hanghoaduthaunhathau: [], assignments: [],
  };
  const state = structuredClone(snapshot);
  state.kehoach.push({ id: "plan-01", rootId: "plan-root", chuDauTuId: investor.id });

  const changes = collectPlanBreakdownDraftChanges(state, {
    planId: "plan-01", snapshot,
  });

  assert.deepEqual(changes.upserts.chudautu.map((row) => row.id), [investor.id]);
  assert.equal(changes.deletions.chudautu, undefined);
});

test("plan breakdown package row exposes accessible icon-only actions", () => {
  const previousDocument = globalThis.document;
  const previousLucide = globalThis.lucide;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  const tbody = { innerHTML: "" };
  const iconRoots = [];
  globalThis.lucide = {
    createIcons(options) {
      iconRoots.push(options?.root);
    },
  };
  globalThis.document = {
    getElementById: (id) => id === "tbody-breakdown-goithau" ? tbody : null,
  };
  const pkg = {
    id: "pkg-draft",
    maGoiThau: "IB-DRAFT",
    tenGoiThau: "Gói thầu bản nháp",
    giaGoiThau: 100,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    trangThai: "Chuẩn bị",
  };
  const controller = {
    model: {
      getLatestPackagesForPlan: () => [pkg],
      getPackageBaseCode: (value) => value,
      formatCurrency: (value) => String(value),
    },
    view: { getStatusBadge: (value) => value },
  };

  try {
    renderBreakdownPackagesList.call(controller, "plan-draft");
  } finally {
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousIsSupported;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLucide === undefined) delete globalThis.lucide;
    else globalThis.lucide = previousLucide;
  }

  assert.match(String(tbody.innerHTML), /data-bf-action="edit-package"/);
  assert.match(String(tbody.innerHTML), /data-bf-action="delete-package"/);
  assert.match(String(tbody.innerHTML), /aria-label="Sửa gói thầu"/);
  assert.match(String(tbody.innerHTML), /title="Xóa gói thầu"/);
  assert.doesNotMatch(String(tbody.innerHTML), />\s*Sửa\s*</);
  assert.doesNotMatch(String(tbody.innerHTML), />\s*Xóa\s*</);
  assert.deepEqual(iconRoots, [tbody]);
});

test("plan breakdown tabs use one active-state color contract", () => {
  const modal = fs.readFileSync("views/modals/modal_plan_breakdown.html", "utf8");
  const css = fs.readFileSync("views/css/components.css", "utf8");
  const tabClasses = [...modal.matchAll(/class="([^"]*breakdown-tab-btn[^"]*)"/g)]
    .map((match) => match[1].replace(/\s+active\b/g, "").trim());

  assert.equal(tabClasses.length, 4);
  assert.equal(new Set(tabClasses).size, 1);
  assert.match(css, /#modal-plan-breakdown \.breakdown-tab-btn\.active\s*\{[^}]*color:\s*var\(--primary\)/s);
  assert.doesNotMatch(modal, /breakdown-tab-btn[^\n]*!important/);
});

test("deleting a draft package from breakdown removes its aggregate without persistence", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      if (id === "modal-plan-breakdown") return { classList: { contains: () => true } };
      return null;
    },
  };
  const calls = [];
  const controller = {
    planBreakdownDraft: {
      active: true,
      action: "create",
      planId: "plan-draft",
    },
    model: {
      state: {
        goithau: [{
          id: "pkg-draft",
          rootId: "pkg-draft",
          keHoachId: "plan-draft",
          tenGoiThau: "Gói thầu bản nháp",
        }],
        goithauhanghoa: [{ id: "goods-1", goiThauId: "pkg-draft" }],
        thongtinmothau: [{ id: "opening-1", goiThauId: "pkg-draft" }],
        hanghoaduthaunhathau: [{ id: "bid-goods-1", goiThauId: "pkg-draft" }],
        assignments: [{ id: "assignment-1", targetId: "pkg-draft", type: "goithau" }],
        selectedPackageVersion: { "pkg-draft": "pkg-draft" },
      },
      persistChanges: async () => calls.push("persistChanges"),
      flushMutationOutbox: async () => calls.push("flushMutationOutbox"),
      markDeleted: () => calls.push("markDeleted"),
    },
    autoSync: async () => calls.push("autoSync"),
    view: { customConfirm: async () => true },
    recalculatePlanTotal() {},
    renderBreakdownPackagesList() {},
    updateBreakdownTotal() {},
  };

  try {
    await deleteGoiThau.call(controller, "pkg-draft");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(controller.model.state.goithau, []);
  assert.deepEqual(controller.model.state.goithauhanghoa, []);
  assert.deepEqual(controller.model.state.thongtinmothau, []);
  assert.deepEqual(controller.model.state.hanghoaduthaunhathau, []);
  assert.deepEqual(controller.model.state.assignments, []);
  assert.deepEqual(controller.model.state.selectedPackageVersion, {});
  assert.deepEqual(calls, []);
});

test("back from breakdown reopens the same plan draft and keeps breakdown rows in memory", async () => {
  const previousDocument = globalThis.document;
  const row = {
    querySelector(selector) {
      return {
        ".breakdown-name": { value: "Công việc nháp" },
        ".breakdown-value": { value: "250" },
        ".breakdown-unit": { value: "Đơn vị A" },
        ".breakdown-doc": { value: "QĐ 01" },
      }[selector] || null;
    },
  };
  const bodies = {
    "tbody-breakdown-dathuchien": { querySelectorAll: () => [row] },
    "tbody-breakdown-khongapdung": { querySelectorAll: () => [] },
    "tbody-breakdown-chuadudieuKien": { querySelectorAll: () => [] },
  };
  globalThis.document = {
    getElementById(id) {
      if (id === "breakdown-plan-id") return { value: "plan-draft" };
      return bodies[id] || null;
    },
  };
  const events = [];
  const plan = { id: "plan-draft" };
  const controller = {
    planBreakdownDraft: { active: true, action: "create", planId: "plan-draft" },
    tempPlanAction: "create",
    tempPlanData: { id: "plan-draft" },
    model: {
      state: { kehoach: [plan] },
      parseVND: Number,
    },
    view: {
      closeModal: (id) => events.push(["close", id]),
      openModal: (id) => events.push(["open", id]),
    },
    plans: {
      edit: async (id) => events.push(["edit", id]),
    },
  };

  try {
    await backToPlanDraft.call(controller);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.deepEqual(plan.cvDaThucHienList, [{
    tenCongViec: "Công việc nháp",
    giaTri: 250,
    donViThucHien: "Đơn vị A",
    vanBanPheDuyet: "QĐ 01",
  }]);
  assert.deepEqual(events, [
    ["close", "modal-plan-breakdown"],
    ["edit", "plan-draft"],
  ]);
  assert.equal(controller.planBreakdownDraft.active, true);
});

test("plan breakdown footer uses the requested back and save labels", async () => {
  const markup = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../../views/modals/modal_plan_breakdown.html", import.meta.url), "utf8")
  ));
  assert.match(markup, /id="btn-back-plan-breakdown"[^>]*>Quay lại</);
  assert.match(markup, /id="btn-save-plan-breakdown"[\s\S]*?Lưu kế hoạch/);
  assert.doesNotMatch(markup, />Bỏ qua</);
  assert.doesNotMatch(markup, /Lưu phân chia công việc/);
});
