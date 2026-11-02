import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBulkAssignmentCommand, buildBulkContractStatusCommand, bulkWordExportRequest,
  runBusinessListBulkContractStatus, runBusinessListBulkWordExport,
} from "../../frontend/shared/BusinessListBulkActions.js";
import { WORD_PUBLICATION_DOCUMENTS, getAvailableWordPublicationTypes } from "../../frontend/documents/WordPublicationPolicy.js";
import { buildWordPublicationExportRequest } from "../../frontend/documents/WordPublicationState.js";
import { contractFilename } from "../../frontend/contracts/ContractWordExport.js";
import { appendExportSnapshotVersion } from "../../frontend/shared/exportSnapshot.js";
import { createStoredZip, uniqueZipEntryName } from "../../frontend/shared/zipStore.js";

const contract = (index, overrides = {}) => ({
  id: `hd-${index}`, rootId: `hd-${index}`, phienBan: "00", isLatest: 1, rowVersion: index + 1,
  soHopDong: `HD-${index}`, tenHopDong: `Hợp đồng ${index}`, trangThaiHopDong: "Đang thực hiện",
  goiThauIds: [`gt-${index}`], ...overrides,
});

test("assignment add mode only inserts missing employees on each current target", () => {
  let next = 0;
  const plan = buildBulkAssignmentCommand({
    type: "hopdong", records: [contract(1), contract(2)], syncVersion: 4, mode: "add",
    employeeIds: ["emp-a", "emp-b", "emp-a"],
    assignments: [
      { id: "as-1", empId: "emp-a", targetId: "hd-1", type: "hopdong", rowVersion: 2 },
      { id: "as-2", empId: "emp-z", targetId: "hd-1", type: "hopdong", rowVersion: 1 },
      { id: "as-3", empId: "emp-a", targetId: "hd-2", type: "goithau", rowVersion: 1 },
    ],
    createId: () => `new-${++next}`,
  });
  assert.equal(plan.changedTargets, 2);
  assert.deepEqual(plan.command.upserts.assignments, [
    { id: "new-1", empId: "emp-b", targetId: "hd-1", type: "hopdong" },
    { id: "new-2", empId: "emp-a", targetId: "hd-2", type: "hopdong" },
    { id: "new-3", empId: "emp-b", targetId: "hd-2", type: "hopdong" },
  ]);
  assert.deepEqual(plan.command.deletions, [], "add mode never removes current assignees");
  assert.equal(plan.command.expectedSyncVersion, "4");
});

test("assignment replace mode removes only other assignees of the same record type", () => {
  const plan = buildBulkAssignmentCommand({
    type: "hopdong", records: [contract(1)], syncVersion: 4, mode: "replace", employeeIds: ["emp-a"],
    assignments: [
      { id: "as-1", empId: "emp-a", targetId: "hd-1", type: "hopdong", rowVersion: 2 },
      { id: "as-2", empId: "emp-z", targetId: "hd-1", type: "hopdong", rowVersion: 7 },
      { id: "as-3", empId: "emp-y", targetId: "hd-1", type: "goithau", rowVersion: 1 },
    ],
  });
  assert.equal(plan.command.upserts, undefined);
  assert.deepEqual(plan.command.deletions, [{ table: "assignments", id: "as-2", expectedVersion: 7 }]);
  const unchanged = buildBulkAssignmentCommand({
    type: "hopdong", records: [contract(1)], syncVersion: 4, mode: "replace", employeeIds: ["emp-a"],
    assignments: [{ id: "as-1", empId: "emp-a", targetId: "hd-1", type: "hopdong" }],
  });
  assert.equal(unchanged.changedTargets, 0);
  assert.throws(() => buildBulkAssignmentCommand({ type: "hopdong", records: [], employeeIds: [], mode: "add", assignments: [] }),
    { code: "BULK_ACTION_INVALID_COMMAND" });
});

test("contract status keeps every canonical field, including package links, and skips unchanged rows", () => {
  const plan = buildBulkContractStatusCommand({
    records: [contract(1), contract(2, { trangThaiHopDong: "Hoàn thành" })], status: "Hoàn thành", syncVersion: 9,
    now: "2026-11-02 09:00:00",
  });
  assert.equal(plan.changedCount, 1);
  const [row] = plan.command.upserts.hopdong;
  assert.equal(row.id, "hd-1");
  assert.equal(row.trangThaiHopDong, "Hoàn thành");
  assert.deepEqual(row.goiThauIds, ["gt-1"]);
  assert.equal(row.expectedVersion, 2);
  assert.equal(row.tenHopDong, "Hợp đồng 1");
  assert.equal("allVersions" in row, false);
  assert.deepEqual(plan.command.projectedFields.hopdong, ["trangThaiHopDong", "updatedAt"]);
  assert.throws(() => buildBulkContractStatusCommand({ records: [contract(3, { goiThauIds: undefined })], status: "Hoàn thành", syncVersion: 9 }),
    { code: "BULK_ACTION_RECORD_CHANGED" });
  assert.equal(buildBulkContractStatusCommand({ records: [contract(4, { trangThaiHopDong: "X" })], status: "X", syncVersion: 1 }).command, null);
});

test("word export requests mirror the single-record endpoints", () => {
  const plan = WORD_PUBLICATION_DOCUMENTS.find((item) => item.id === "procurement_plan");
  const options = { buildRequest: buildWordPublicationExportRequest, contractFilename };
  const planRequest = bulkWordExportRequest("kehoach", { id: "kh-1", maKeHoach: "KH 01" }, {
    ...options, documentType: plan, templates: [{ filename: "a.docx" }, { filename: "b c.docx" }],
  });
  assert.equal(planRequest.createJobUrl, "/api/document-jobs/plan/kh-1?publicationType=procurement_plan&templateFilename=a.docx&templateFilename=b%20c.docx");
  assert.match(planRequest.filename, /\.zip$/u);
  const report = WORD_PUBLICATION_DOCUMENTS.find((item) => item.id === "contractor_selection_result");
  const packageRequest = bulkWordExportRequest("goithau", { id: "gt-1", maGoiThau: "GT1" }, {
    ...options, documentType: report, templates: [{ filename: "kq.docx" }],
  });
  assert.equal(packageRequest.createJobUrl, "/api/document-jobs/package-report/gt-1?type=result&publicationType=contractor_selection_result&templateFilename=kq.docx");
  assert.deepEqual(bulkWordExportRequest("hopdong", contract(5), options), {
    createJobUrl: "/api/document-jobs/package-report/gt-5?type=contract", filename: "Hop_dong_HD-5.docx",
  });
  assert.equal(bulkWordExportRequest("hopdong", contract(6, { goiThauIds: [] }), options), null);
});

function viewFixture({ select = null, confirm = true } = {}) {
  const calls = { alerts: [], confirms: [], toasts: [] };
  return {
    calls,
    view: {
      async customSelectConfirm() { return select; },
      async customConfirm(title, message) { calls.confirms.push({ title, message }); return confirm; },
      async customAlert(title, message) { calls.alerts.push({ title, message }); },
      showToast(...args) { calls.toasts.push(args); },
    },
  };
}

const loading = () => {
  const updates = [];
  return { updates, begin: async (options) => { updates.push(options); return { update: async (...args) => updates.push(args), close: async () => {} }; } };
};

test("bulk contract status runs one prepared update with the chosen status", async () => {
  const { view, calls } = viewFixture({ select: "Hoàn thành" });
  const model = { state: { customcontractstatuses: [{ name: "Đang thực hiện" }, { name: "Hoàn thành" }] } };
  const session = { assertCurrent() {}, close() { this.closed = true; } };
  let submitted;
  const result = await runBusinessListBulkContractStatus({ model, view }, { type: "hopdong", count: 2 }, {
    createSession: async (_controller, options) => { assert.equal(options.action, "update"); return session; },
    resolveTargets: async () => ({ type: "hopdong", records: [contract(1), contract(2, { trangThaiHopDong: "Hoàn thành" })], syncVersion: 3 }),
    submit: async (activeSession, command) => { assert.equal(activeSession, session); submitted = command; return { ok: true }; },
    beginLoading: loading().begin,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(submitted.upserts.hopdong.map((row) => [row.id, row.trangThaiHopDong]), [["hd-1", "Hoàn thành"]]);
  assert.match(calls.confirms[0].message, /Đổi 1\/2 hợp đồng/u);
  assert.equal(session.closed, true);
  assert.equal(calls.toasts[0][2], "success");
});

test("bulk Word export retries a moved snapshot, reports per-record failures and zips the rest", async () => {
  const { view, calls } = viewFixture();
  const model = { state: { activeuser: { wordExportEnabled: true } } };
  const records = [contract(1), contract(2), contract(3, { goiThauIds: [] }), contract(4)];
  const created = [];
  let snapshot = 20;
  const session = {
    assertCurrent() {}, close() {},
    async readSyncVersion() { return String(snapshot); },
    async requestJson() { throw new Error("not used by the fake job runner"); },
    async readBlob(url) { return new Blob([`doc:${url}`]); },
  };
  const modules = {
    WORD_PUBLICATION_DOCUMENTS, getAvailableWordPublicationTypes, buildWordPublicationExportRequest,
    contractFilename, appendExportSnapshotVersion, createStoredZip, uniqueZipEntryName,
    async runWordPublicationExportJob({ createJobUrl, filename }, { download }) {
      created.push(createJobUrl);
      if (createJobUrl.includes("gt-1") && createJobUrl.endsWith("snapshotVersion=20")) {
        snapshot = 21;
        throw Object.assign(new Error("stale"), { code: "EXPORT_SNAPSHOT_STALE" });
      }
      if (createJobUrl.includes("gt-2")) throw Object.assign(new Error("Thiếu tổ chuyên gia"), { code: "DOCUMENT_EXPORT_TEAMS_REQUIRED" });
      await download(`/api/document-jobs/${filename}/download`, filename);
    },
  };
  let saved;
  const progress = loading();
  const result = await runBusinessListBulkWordExport({ model, view }, { type: "hopdong", count: 4 }, {
    createSession: async (_controller, options) => { assert.equal(options.action, "export"); return session; },
    resolveTargets: async () => ({ type: "hopdong", records, syncVersion: 20 }),
    beginLoading: progress.begin, modules, save: (blob, filename) => { saved = { blob, filename }; },
    now: () => new Date(2026, 10, 2, 10, 5),
  });
  assert.equal(result.ok, true);
  assert.equal(result.exported, 2);
  assert.deepEqual(result.skipped, ["HD-3 – Hợp đồng 3"]);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(created, [
    "/api/document-jobs/package-report/gt-1?type=contract&snapshotVersion=20",
    "/api/document-jobs/package-report/gt-1?type=contract&snapshotVersion=21",
    "/api/document-jobs/package-report/gt-2?type=contract&snapshotVersion=21",
    "/api/document-jobs/package-report/gt-4?type=contract&snapshotVersion=21",
  ]);
  assert.equal(saved.filename, "Xuat_Word_Hop_dong_20261102_1005.zip");
  const text = new TextDecoder().decode(new Uint8Array(await saved.blob.arrayBuffer()));
  assert.match(text, /Hop_dong_HD-1\.docx/u);
  assert.match(text, /Ket_qua_xuat_Word\.txt/u);
  assert.match(text, /Thiếu tổ chuyên gia/u);
  assert.equal(calls.toasts[0][2], "warning");
  assert.equal(typeof progress.updates.find((item) => item?.task === "business-list-bulk-word-export")?.onCancel, "function");
});

test("bulk Word export is blocked without the workspace entitlement and stops on request", async () => {
  const blocked = viewFixture();
  const denied = await runBusinessListBulkWordExport({ model: { state: { activeuser: {} } }, view: blocked.view }, { type: "kehoach", count: 1 });
  assert.equal(denied.blocked, true);
  assert.match(blocked.calls.alerts[0].title, /quyền xuất Word/u);

  const { view } = viewFixture();
  let cancel;
  let jobs = 0;
  const result = await runBusinessListBulkWordExport({ model: { state: { activeuser: { wordExportEnabled: true } } }, view }, { type: "hopdong", count: 3 }, {
    createSession: async () => ({ assertCurrent() {}, close() {}, async readSyncVersion() { return "1"; }, async readBlob() { return new Blob(["x"]); } }),
    resolveTargets: async () => ({ type: "hopdong", records: [contract(1), contract(2), contract(3)], syncVersion: 1 }),
    beginLoading: async (options) => { cancel = options.onCancel; return { update: async () => {}, close: async () => {} }; },
    modules: {
      WORD_PUBLICATION_DOCUMENTS, getAvailableWordPublicationTypes, buildWordPublicationExportRequest,
      contractFilename, appendExportSnapshotVersion, createStoredZip, uniqueZipEntryName,
      async runWordPublicationExportJob(_request, { download }) { jobs += 1; await download("/x"); cancel?.(); },
    },
    save: () => {},
  });
  assert.equal(jobs, 1, "the batch stops after the document being created");
  assert.equal(result.exported, 1);
  assert.equal(result.stopped, true);
});
