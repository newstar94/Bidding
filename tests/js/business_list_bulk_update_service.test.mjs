import assert from "node:assert/strict";
import test from "node:test";
import {
  createBusinessListBulkDeleteSession, createBusinessListBulkSession,
  submitBusinessListBulkDelete, submitBusinessListBulkUpdate,
} from "../../frontend/shared/BusinessListBulkDeleteService.js";

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

function fixture() {
  const writes = [];
  const contracts = [
    { id: "h-1", rowVersion: 3, trangThaiHopDong: "Đang thực hiện", giaTri: 10 },
    { id: "h-2", rowVersion: 5, trangThaiHopDong: "Đang thực hiện", giaTri: 20 },
  ];
  const model = {
    state: {
      activerole: "manager", activeuser: { id: "user-1" }, hopdong: contracts,
      assignments: [{ id: "as-old", empId: "emp-old", targetId: "h-1", type: "hopdong" }],
    },
    workspaceScope: { key: "user-1:org-a", organizationId: "org-a" },
    getWorkspaceToken() { return this.workspaceScope.key; },
    hasPendingMutationOutboxChanges: () => false,
    db: { async applySyncChanges(changes) { writes.push(structuredClone(changes)); } },
    entityIndexes: { invalidate() {} },
    replaceTableState(type, rows) { this.state[type] = rows; return rows; },
  };
  const controller = { model, view: {}, async awaitAuthoritativeMutationBoundary() {}, async forceSyncData() { return { ok: true }; } };
  return { model, controller, writes };
}

const statusCommand = () => ({
  expectedSyncVersion: "7",
  upserts: { hopdong: [
    { id: "h-1", trangThaiHopDong: "Hoàn thành", giaTri: "10", expectedVersion: 3 },
    { id: "h-2", trangThaiHopDong: "Hoàn thành", giaTri: "20", expectedVersion: 5 },
  ] },
  projectedFields: { hopdong: ["trangThaiHopDong"] },
  deletions: [],
});

test("bulk contract update is one atomic sync and projects only the changed fields after the ACK", async () => {
  const { model, controller, writes } = fixture();
  const bodies = [];
  const session = await createBusinessListBulkSession(controller, { action: "update", fetchImpl: async (url, options) => {
    assert.equal(url, "/api/sync");
    assert.equal(options.headers.get("X-Active-Org"), "org-a");
    bodies.push(JSON.parse(options.body));
    return response({ status: "success", syncVersion: "8", rowVersions: [
      { table: "hop_dong", id: "h-1", rowVersion: 4 }, { table: "hop_dong", id: "h-2", rowVersion: 6 },
    ] });
  } });
  const result = await submitBusinessListBulkUpdate(session, statusCommand());
  session.close();
  assert.equal(result.ok, true);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].expectedSyncVersion, "7");
  assert.deepEqual(bodies[0].hopdong.map((row) => row.expectedVersion), [3, 5]);
  assert.equal("projectedFields" in bodies[0], false, "local projection hints never reach the server");
  assert.deepEqual(bodies[0].deletions, []);
  assert.deepEqual(model.state.hopdong.map((row) => [row.trangThaiHopDong, row.rowVersion, row.giaTri]),
    [["Hoàn thành", 4, 10], ["Hoàn thành", 6, 20]], "untouched local fields keep their local shape");
  assert.equal(writes.length, 1);
});

test("assignment delta adds and removes rows in the same transaction", async () => {
  const { model, controller, writes } = fixture();
  let body;
  const session = await createBusinessListBulkSession(controller, { action: "update", fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return response({ status: "success", rowVersions: [{ table: "phan_cong_nhan_su", id: "as-new", rowVersion: 1 }] });
  } });
  const result = await submitBusinessListBulkUpdate(session, {
    expectedSyncVersion: "9",
    upserts: { assignments: [{ id: "as-new", empId: "emp-1", targetId: "h-1", type: "hopdong" }] },
    deletions: [{ table: "assignments", id: "as-old", expectedVersion: 2 }],
  });
  session.close();
  assert.equal(result.ok, true);
  assert.deepEqual(body.assignments, [{ id: "as-new", empId: "emp-1", targetId: "h-1", type: "hopdong" }]);
  assert.deepEqual(body.deletions, [{ table: "assignments", id: "as-old", expectedVersion: 2 }]);
  assert.deepEqual(model.state.assignments.map((row) => [row.id, row.rowVersion]), [["as-new", 1]]);
  assert.deepEqual(writes[0].deletions, { assignments: ["as-old"] });
});

test("a rejected batch changes nothing locally and a retry resends the identical body", async () => {
  const { model, controller, writes } = fixture();
  const bodies = [];
  let attempt = 0;
  const session = await createBusinessListBulkSession(controller, { action: "update", fetchImpl: async (_url, options) => {
    bodies.push(options.body);
    attempt += 1;
    // apiFetch retries one transient failure itself; both attempts fail here.
    if (attempt <= 2) return response({ message: "Gateway error" }, 502);
    return response({ status: "error", code: "SYNC_SNAPSHOT_CHANGED", message: "Dữ liệu đã thay đổi kể từ khi xác nhận." }, 409);
  } });
  const unknown = await submitBusinessListBulkUpdate(session, statusCommand());
  assert.equal(unknown.unknown, true);
  const rejected = await submitBusinessListBulkUpdate(session, statusCommand());
  session.close();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.unknown, false);
  assert.match(rejected.message, /đã thay đổi/u);
  assert.equal(new Set(bodies).size, 1);
  assert.equal(model.state.hopdong[0].trangThaiHopDong, "Đang thực hiện");
  assert.equal(writes.length, 0);
});

test("invalid update commands and mismatched sessions are refused before any request", async () => {
  const { controller } = fixture();
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return response({ status: "success" }); };
  const session = await createBusinessListBulkSession(controller, { action: "update", fetchImpl });
  const missingVersion = statusCommand();
  delete missingVersion.upserts.hopdong[0].expectedVersion;
  await assert.rejects(submitBusinessListBulkUpdate(session, missingVersion), { code: "BULK_ACTION_INVALID_COMMAND" });
  await assert.rejects(submitBusinessListBulkUpdate(session, { ...statusCommand(), upserts: { kehoach: [{ id: "k", expectedVersion: 1 }] } }),
    { code: "BULK_ACTION_INVALID_COMMAND" });
  await assert.rejects(submitBusinessListBulkUpdate(session, { ...statusCommand(), deletions: [{ table: "hopdong", id: "h-1" }] }),
    { code: "BULK_ACTION_INVALID_COMMAND" });
  await assert.rejects(submitBusinessListBulkDelete(session, { expectedSyncVersion: "7", deletions: [{ table: "hopdong", id: "h-1", expectedVersion: 3 }] }),
    { code: "BULK_DELETE_INVALID_SESSION" });
  session.close();
  const deleteSession = await createBusinessListBulkDeleteSession(controller, { fetchImpl });
  await assert.rejects(submitBusinessListBulkUpdate(deleteSession, statusCommand()), { code: "BULK_ACTION_INVALID_SESSION" });
  deleteSession.close();
  assert.equal(requests, 0);
});

test("update sessions use their own codes for pending local changes", async () => {
  const { model, controller } = fixture();
  model.hasPendingMutationOutboxChanges = () => true;
  await assert.rejects(createBusinessListBulkSession(controller, { action: "update" }), { code: "BULK_ACTION_PENDING_CHANGES" });
  await assert.rejects(createBusinessListBulkSession(controller, { action: "export" }), { code: "BULK_EXPORT_PENDING_CHANGES" });
  await assert.rejects(createBusinessListBulkDeleteSession(controller), { code: "BULK_DELETE_PENDING_CHANGES" });
});
