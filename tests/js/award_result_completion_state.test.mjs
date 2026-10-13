import assert from "node:assert/strict";
import test from "node:test";
import { createAwardResultApprovalWorkflow } from "../../frontend/packages/detail/AwardResultApprovalWorkflow.js";
import { packageWorkspaceFor } from "../../frontend/packages/detail/PackageWorkspaceState.js";
import { commitPackageAwardDependencies } from "../../frontend/packages/packageEvaluationProgress.js";

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

test("lot approval renders the committed result after dependency sync replaces the package projection", async () => {
  const context = scopedContext();
  context.pkg.trangThai = "Đang chấm thầu";
  const beforeApproval = structuredClone(context.pkg);
  const model = context.view.model;
  model.commitLocalMutation = () => {};
  model.persistChanges = async () => {};
  model.flushMutationOutbox = async () => {};
  model.applyCommittedRowVersions = async entries => {
    for (const entry of entries) model.state.goithau.find(item => item.id === entry.id).rowVersion = entry.rowVersion;
  };
  const controller = {
    model,
    async autoSync() {
      // A canonical dependency response can replace the package object while
      // the separate lot-finalize operation still owns the entered award.
      model.state.goithau = [structuredClone(beforeApproval)];
      model.state.goithau[0].tenGoiThau = "Canonical unrelated name";
      return { ok: true };
    },
  };
  let rendered;
  context.view.showPackageDetails = async () => { rendered = structuredClone(model.state.goithau[0]); };
  const workflow = createAwardResultApprovalWorkflow({
    commitDecision: async () => ({ ok: true }),
    commitDependencies: commitPackageAwardDependencies,
    finalizeLotBatch: async () => ({ packageStatus: "PARTIALLY_COMPLETED", packageRowVersion: 4, counts: { pendingLots: 1 } }),
  });
  const outcome = await workflow.execute({ ...context, appController: controller });
  assert.equal(outcome.kind, "scoped_awarded");
  assert.equal(rendered.rowVersion, 4);
  assert.equal(rendered.trangThai, "Đã có kết quả một phần");
  assert.equal(rendered.soQuyetDinhKetQua, context.command.decision.number);
  assert.equal(JSON.parse(rendered.danhGiaHsdtMetadata).technical.lotBatches.batch.status, "FINAL");
  assert.equal(rendered.tenGoiThau, "Canonical unrelated name");
});

test("a late lot-finalize response preserves a newer canonical package projection", async () => {
  const context = scopedContext();
  const newer = { ...structuredClone(context.pkg), rowVersion: 5,
    trangThai: "Đã có kết quả", soQuyetDinhKetQua: "Newer official decision" };
  const model = context.view.model;
  let versions;
  model.applyCommittedRowVersions = async entries => { versions = entries; };
  const workflow = createAwardResultApprovalWorkflow({
    commitDecision: async () => ({ ok: true }),
    async commitDependencies() { model.state.goithau = [newer]; return { ok: true }; },
    finalizeLotBatch: async () => ({ packageStatus: "PARTIALLY_COMPLETED", packageRowVersion: 4, counts: { pendingLots: 1 } }),
  });
  await workflow.execute(context);
  assert.equal(model.state.goithau[0].rowVersion, 5);
  assert.equal(model.state.goithau[0].trangThai, "Đã có kết quả");
  assert.equal(model.state.goithau[0].soQuyetDinhKetQua, "Newer official decision");
  assert.deepEqual(versions, [{ table: "goithau", id: context.pkg.id, rowVersion: 5 }]);
});
