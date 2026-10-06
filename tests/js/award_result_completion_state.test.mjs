import assert from "node:assert/strict";
import test from "node:test";
import { createAwardResultApprovalWorkflow } from "../../frontend/packages/detail/AwardResultApprovalWorkflow.js";
import { packageWorkspaceFor } from "../../frontend/packages/detail/PackageWorkspaceState.js";

function scopedContext() {
  const batch = { id: "batch", status: "IN_PROGRESS", sequenceNo: 1, lotIds: ["lot"], lotCodes: ["PP01"] };
  const pkg = { id: "pkg", rootId: "pkg", isLatest: 1, rowVersion: 3, phanLo: "Có",
    phanLoList: [{ id: "lot", maPhanLo: "PP01" }],
    danhGiaHsdtMetadata: JSON.stringify({ technical: { activeLotBatchId: "batch", lotBatches: { batch } },
      financial: { activeLotBatchId: "batch", lotBatches: { batch } } }) };
  const model = { state: { goithau: [pkg], thongtinmothau: [{ id: "bid", goiThauId: pkg.id, nhaThauId: "contractor" }] },
    async applyCommittedRowVersions() {} };
  const renders = [], alerts = [];
  const view = { model, _currentWorkflowPackageId: pkg.id, _currentWorkflowTab: "result",
    async renderGoiThauTable() {}, async customAlert(...args) { alerts.push(args); },
    async showPackageDetails(id) { renders.push({ id, dirty: packageWorkspaceFor(view).isDirty() }); } };
  const workspace = packageWorkspaceFor(view);
  workspace.load({ packageId: pkg.id, workflowTab: "result" });
  workspace.transition({ type: "SET_DIRTY", dirty: true });
  const winner = { bidId: "bid", contractorId: "contractor", lotCode: "PP01", isWinner: true,
    awardPrice: 100, packageDuration: "27 tháng", contractDuration: "27 tháng" };
  return { pkg, view, workspace, renders, alerts, command: {
    ok: true, rows: [winner], winnerRows: [winner], decision: { number: "1041/QĐ", date: "2026-10-06" },
  }, viewModel: { isTwoEnvelope: true, isEditingOfficialResult: false, officialLotState: {},
    activeScopedEvaluation: { batch, batchId: "batch", lotIds: ["lot"], lotCodes: ["PP01"] } } };
}

for (const packageStatus of ["COMPLETED", "PARTIAL"]) {
  test(`lot approval clears dirty state only after lifecycle confirmation: ${packageStatus}`, async () => {
    const context = scopedContext();
    let finishLifecycle;
    let entered;
    const started = new Promise((done) => { entered = done; });
    const lifecycle = new Promise((done) => { finishLifecycle = done; });
    const workflow = createAwardResultApprovalWorkflow({
      commitDecision: async () => ({ ok: true }), commitDependencies: async () => ({ ok: true }),
      async finalizeLotBatch() { entered(); return lifecycle; },
    });
    const pending = workflow.execute(context);
    await started;
    assert.equal(context.workspace.isDirty(), true);
    assert.deepEqual(context.renders, []);
    finishLifecycle({ packageStatus, packageRowVersion: 4, counts: { pendingLots: 1 } });
    const result = await pending;
    assert.equal(result.kind, "scoped_awarded");
    assert.equal(context.workspace.isDirty(), false);
    assert.deepEqual(context.renders, [{ id: "pkg", dirty: false }]);
    assert.equal(context.pkg.trangThai, packageStatus === "COMPLETED" ? "Đã có kết quả" : "Đã có kết quả một phần");
  });
}

test("failed lot finalization retains the dirty approval draft", async () => {
  const context = scopedContext();
  const workflow = createAwardResultApprovalWorkflow({
    commitDecision: async () => ({ ok: true }), commitDependencies: async () => ({ ok: true }),
    async finalizeLotBatch() { throw new Error("upstream failed"); },
  });
  const result = await workflow.execute(context);
  assert.equal(result.kind, "lifecycle_failed");
  assert.equal(context.workspace.isDirty(), true);
  assert.deepEqual(context.renders, []);
});

test("pending dependency sync never finalizes a lot or clears the approval draft", async () => {
  const context = scopedContext();
  const workflow = createAwardResultApprovalWorkflow({
    commitDecision: async () => ({ ok: true }),
    commitDependencies: async () => ({ ok: true, localMutationsPending: true }),
    async finalizeLotBatch() { throw new Error("must not finalize before dependency confirmation"); },
  });
  const result = await workflow.execute(context);
  assert.equal(result.kind, "sync_failed");
  assert.equal(context.workspace.isDirty(), true);
  assert.deepEqual(context.renders, []);
});
