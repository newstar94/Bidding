import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { persistPackageFormChanges } from "../../frontend/packages/GoiThauWorkflow.js";
import { deleteGoiThau } from "../../frontend/packages/packageLifecycleWorkflow.js";
import {
  backToPlanDraft,
  renderBreakdownPackagesList,
  savePlanBreakdown,
} from "../../frontend/plans/KeHoachWorkflow.js";
import {
  applyDraftAssignmentSelection,
  capturePlanBreakdownDraft,
  collectPlanBreakdownDraftChanges,
  restorePlanBreakdownDraft,
} from "../../frontend/plans/planBreakdownDraft.js";

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

test("cancelling plan breakdown restores the complete aggregate and drops memory-only rows", () => {
  const state = {
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  };
  const draft = capturePlanBreakdownDraft(state, { action: "create" });
  state.kehoach.push({ id: "plan-draft" });
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
    kehoach: [],
    goithau: [],
    goithauhanghoa: [],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [],
  });
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

test("plan breakdown package row exposes both edit and delete actions", () => {
  const previousDocument = globalThis.document;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  const tbody = { innerHTML: "" };
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
  }

  assert.match(String(tbody.innerHTML), /data-bf-action="edit-package"/);
  assert.match(String(tbody.innerHTML), /data-bf-action="delete-package"/);
  assert.match(String(tbody.innerHTML), />Xóa</);
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
