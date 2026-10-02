import assert from "node:assert/strict";
import test from "node:test";
import { configureApiClient } from "../../frontend/shared/apiClient.js";
import {
  createBusinessListBulkDeleteSession, submitBusinessListBulkDelete,
} from "../../frontend/shared/BusinessListBulkDeleteService.js";
import {
  setBusinessListPage, toggleBusinessListRow, getBusinessListSelection,
} from "../../frontend/shared/BusinessListSelection.js";

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const command = () => ({ expectedSyncVersion: "7", deletions: [
  { table: "hopdong", id: "h-1", expectedVersion: 3 },
  { table: "hopdong", id: "h-2", expectedVersion: 5 },
] });

function fixture() {
  const writes = [];
  const rows = [{ id: "h-1", rowVersion: 3 }, { id: "h-2", rowVersion: 5 }];
  const model = {
    state: { activerole: "manager", activeuser: { id: "user-1" }, hopdong: rows },
    workspaceScope: { key: "user-1:org-a", organizationId: "org-a" },
    getWorkspaceToken() { return this.workspaceScope.key; },
    hasPendingMutationOutboxChanges: () => false,
    db: { async applySyncChanges(changes) { writes.push(structuredClone(changes)); } },
    currentPage: { hopdong: 3 },
    entityIndexes: { invalidate() {} },
  };
  setBusinessListPage(model, "hopdong", { items: rows, totalItems: 2 });
  rows.forEach((row) => toggleBusinessListRow(model, "hopdong", row, true));
  const controller = {
    model, view: {}, async awaitAuthoritativeMutationBoundary() {},
    async forceSyncData() { return { ok: true }; },
  };
  return { model, controller, writes };
}

test("bulk delete only projects confirmed deletions after the entire server batch commits", async (t) => {
  const { model, controller, writes } = fixture();
  const original = structuredClone(model.state.hopdong);
  let finish;
  let sent;
  const sentPromise = new Promise((done) => { sent = done; });
  configureApiClient({ activeOrganization: () => "wrong-global-org" });
  t.after(() => configureApiClient({ activeOrganization: null }));
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async (url, options) => {
    assert.equal(url, "/api/sync");
    assert.equal(options.headers.get("X-Active-Org"), "org-a");
    const body = JSON.parse(options.body);
    assert.equal(body.expectedSyncVersion, "7");
    assert.deepEqual(body.deletions, command().deletions);
    assert.equal(body.clientMutationId, options.headers.get("Idempotency-Key"));
    sent();
    return new Promise((done) => { finish = done; });
  } });
  t.after(() => session.close());
  const pending = submitBusinessListBulkDelete(session, command());
  await sentPromise;
  assert.deepEqual(model.state.hopdong, original);
  assert.equal(writes.length, 0);
  assert.equal(getBusinessListSelection(model, "hopdong").count, 2);
  finish(response({ status: "success", syncVersion: 8,
    deleteImpacts: [{ table: "hopdong", id: "h-1", action: "archived" }, { table: "hopdong", id: "h-2", action: "deleted" }] }));
  assert.equal((await pending).ok, true);
  assert.deepEqual(model.state.hopdong, []);
  assert.deepEqual(writes, [{ deletions: { hopdong: ["h-1", "h-2"] } }]);
  assert.equal(getBusinessListSelection(model, "hopdong").count, 0);
  assert.equal(model.currentPage.hopdong, 1);
});

test("one rejected row keeps every selected row and performs no local write", async (t) => {
  const { model, controller, writes } = fixture();
  const before = structuredClone(model.state.hopdong);
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => response({
    status: "error", errors: [{ code: "ROW_VERSION_CONFLICT", message: "Dữ liệu đã thay đổi." }],
  }, 400) });
  t.after(() => session.close());
  const result = await submitBusinessListBulkDelete(session, command());
  assert.equal(result.ok, false);
  assert.equal(result.unknown, false);
  assert.match(result.message, /đã thay đổi/);
  assert.deepEqual(model.state.hopdong, before);
  assert.deepEqual(writes, []);
  assert.equal(getBusinessListSelection(model, "hopdong").count, 2);
});

test("manual retry after an ambiguous response reuses the same immutable batch identity", async (t) => {
  const { controller, writes } = fixture();
  const calls = [];
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async (_url, options) => {
    calls.push({ body: options.body, id: options.headers.get("Idempotency-Key") });
    return calls.length === 1 ? response({ message: "Gateway error" }, 500)
      : response({ status: "success", syncVersion: 8 });
  } });
  t.after(() => session.close());
  const first = await submitBusinessListBulkDelete(session, command());
  assert.equal(first.unknown, true);
  assert.equal(writes.length, 0);
  const changed = command();
  changed.deletions.pop();
  await assert.rejects(submitBusinessListBulkDelete(session, changed), { code: "BULK_DELETE_COMMAND_CHANGED" });
  assert.equal((await submitBusinessListBulkDelete(session, command())).ok, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal((await submitBusinessListBulkDelete(session, command())).ok, true);
  assert.equal(calls.length, 2);
});

test("a workspace switch before a transport retry cannot send the deletion to the new organization", async (t) => {
  const { model, controller, writes } = fixture();
  let calls = 0;
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => {
    calls += 1;
    model.workspaceScope = { key: "user-1:org-b", organizationId: "org-b" };
    throw new Error("response lost");
  } });
  t.after(() => session.close());
  const result = await submitBusinessListBulkDelete(session, command());
  assert.equal(result.ok, false);
  assert.equal(result.workspaceChanged, true);
  assert.equal(calls, 1);
  assert.deepEqual(writes, []);
});

test("permission changes invalidate a prepared command without posting", async (t) => {
  const { model, controller } = fixture();
  let calls = 0;
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => { calls += 1; } });
  t.after(() => session.close());
  model.permissionRevision = 2;
  await assert.rejects(submitBusinessListBulkDelete(session, command()), { code: "PAGINATION_AUTHORIZATION_SCOPE_CHANGED" });
  assert.equal(calls, 0);
});

test("the existing employee deletion restriction and unsynced local edits block preparation", async () => {
  const { model, controller } = fixture();
  model.state.activerole = "employee";
  await assert.rejects(createBusinessListBulkDeleteSession(controller), { code: "BULK_DELETE_ROLE" });
  model.state.activerole = "manager";
  model.hasPendingMutationOutboxChanges = () => true;
  await assert.rejects(createBusinessListBulkDeleteSession(controller), { code: "BULK_DELETE_PENDING_CHANGES" });
  assert.equal(model._workspaceRequestControllers.size, 0);
});

test("preparation reads fresh records without changing the local projection and rejects ID fallback", async (t) => {
  const { model, controller, writes } = fixture();
  const urls = [];
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async (url, options) => {
    assert.equal(options.cache, "no-store");
    urls.push(url);
    if (url.startsWith("/api/paginate")) return response({ items: [{ id: "h-1", rowVersion: 9 }], totalItems: 1 });
    if (url.startsWith("/api/record")) return response({ item: { id: "another-version" } });
    return response({ syncVersion: 12 });
  } });
  t.after(() => session.close());
  const filters = [{ field: "trangThaiHopDong", operator: "in", value: ["Đã ký"] }];
  await session.readPage("hopdong", { filters });
  assert.deepEqual(JSON.parse(new URL(urls[0], "http://localhost").searchParams.get("filters")), filters);
  assert.equal(model.state.hopdong[0].rowVersion, 3);
  await assert.rejects(session.readRecord("hopdong", "h-1"), { code: "BULK_DELETE_RECORD_CHANGED" });
  assert.equal(await session.readSyncVersion(), "12");
  assert.deepEqual(writes, []);
});

test("local cache failure after server success is refresh pending, never a false rollback", async (t) => {
  const { model, controller } = fixture();
  model.db.applySyncChanges = async () => { throw new Error("disk full"); };
  controller.forceSyncData = async () => ({ ok: false });
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => response({ status: "success" }) });
  t.after(() => session.close());
  const result = await submitBusinessListBulkDelete(session, command());
  assert.equal(result.ok, true);
  assert.equal(result.refreshPending, true);
  assert.deepEqual(model.state.hopdong, []);
});

test("pending edits created while confirmation is open prevent the server request", async (t) => {
  const { model, controller } = fixture();
  let calls = 0;
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => { calls += 1; } });
  t.after(() => session.close());
  model.hasPendingMutationOutboxChanges = () => true;
  await assert.rejects(submitBusinessListBulkDelete(session, command()), { code: "BULK_DELETE_PENDING_CHANGES" });
  assert.equal(calls, 0);
});

test("an ambiguous command can reconcile after its server change advances the visibility revision", async (t) => {
  const { model, controller } = fixture();
  const bodies = [];
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async (_url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) {
      model.visibilityRevision = 4;
      return response({ message: "Gateway error" }, 500);
    }
    return response({ status: "success", syncVersion: 8 });
  } });
  t.after(() => session.close());
  assert.equal((await submitBusinessListBulkDelete(session, command())).unknown, true);
  assert.equal((await submitBusinessListBulkDelete(session, command())).ok, true);
  assert.equal(bodies[0], bodies[1]);
});

test("an auth or throttle response cannot resolve an earlier ambiguous commit as rejected", async (t) => {
  const { controller } = fixture();
  const statuses = [500, 403, 429, 200];
  const bodies = [];
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async (_url, options) => {
    bodies.push(options.body);
    const status = statuses.shift();
    return response(status === 200 ? { status: "success" } : { error: "Try later" }, status);
  } });
  t.after(() => session.close());
  assert.equal((await submitBusinessListBulkDelete(session, command())).unknown, true);
  assert.equal((await submitBusinessListBulkDelete(session, command())).unknown, true);
  // 429 can be retried by the shared transport, ending with the prior receipt.
  assert.equal((await submitBusinessListBulkDelete(session, command())).ok, true);
  assert.equal(new Set(bodies).size, 1);
});

test("an in-place organization identity switch after ACK never updates the new workspace", async (t) => {
  const { model, controller, writes } = fixture();
  const session = await createBusinessListBulkDeleteSession(controller, { fetchImpl: async () => {
    model.workspaceScope.organizationId = "org-b";
    return response({ status: "success" });
  } });
  t.after(() => session.close());
  const result = await submitBusinessListBulkDelete(session, command());
  assert.equal(result.ok, true);
  assert.equal(result.workspaceChanged, true);
  assert.equal(writes.length, 0);
  assert.equal(model.state.hopdong.length, 2);
});
