import {
  CANONICAL_SAVE_STATUS,
  classifyCanonicalSyncResult,
  persistAndSync,
  stageLocalRecords,
} from "../shared/MutationService.js";
import {
  captureWorkspaceLease,
  isWorkspaceLeaseCurrent,
  workspaceChangedError,
} from "../app/workspaceLease.js";
import { parseBidDateTime } from "../shared/dateParseUtils.js";

function invitationSaveError(code, syncResult) {
  const error = new Error("Máy chủ chưa xác nhận thông tin mời thầu.");
  error.code = code;
  error.syncResult = syncResult;
  return error;
}

function restorePreviousIntent(outbox, checkpoint, id) {
  const queue = checkpoint?.queue;
  const base = queue?.baseSnapshots?.goithau?.[id];
  for (const [operation, kind] of [["upserts", "upsert"], ["patches", "patch"]]) {
    const record = queue?.[operation]?.goithau?.[id];
    if (record) {
      outbox.enqueue({ kind, table: "goithau", records: [record], baseRecords: base ? [base] : [] });
    }
  }
  const deletion = queue?.deletes?.find((row) => row.table === "goithau" && String(row.id) === id);
  if (deletion) {
    outbox.enqueue({
      kind: "delete", table: "goithau",
      records: [{ id: deletion.id, rowVersion: deletion.expectedVersion }],
    });
  }
}

async function rollbackInvitationAttempt({ outbox, receipt, previousIntent, original, database, model, isCurrent }, error) {
  const rollbackErrors = [];
  let restoredReceipt;
  try {
    outbox.ack(receipt);
    const currentReceipt = outbox.captureReceiptForRecords({ goithau: [original] });
    // A later same-record mutation owns its own generation and durable row.
    if (outbox.checkpointForReceipt(currentReceipt)) return;
    restorePreviousIntent(outbox, previousIntent, String(original.id));
    restoredReceipt = outbox.captureReceiptForRecords({ goithau: [original] });
    await outbox.flush();
  } catch (rollbackError) {
    rollbackErrors.push(rollbackError);
  }
  const latestReceipt = outbox.captureReceiptForRecords({ goithau: [original] });
  if (restoredReceipt && JSON.stringify(latestReceipt) !== JSON.stringify(restoredReceipt)) {
    if (rollbackErrors.length) error.rollbackErrors = rollbackErrors;
    return;
  }
  try {
    if (typeof database?.putRecord === "function") {
      await database.putRecord("goithau", original);
    } else if (isCurrent() && typeof model.persistChanges === "function") {
      await model.persistChanges("goithau", { upserts: [original] }, {
        trackMutation: false, throwOnError: true,
      });
    } else {
      throw invitationSaveError("INVITATION_ROLLBACK_UNAVAILABLE");
    }
  } catch (rollbackError) {
    rollbackErrors.push(rollbackError);
  }
  if (rollbackErrors.length) error.rollbackErrors = rollbackErrors;
}

export async function savePackageInvitationInfo(controller, pkg, {
  extensions = [],
  clarificationRequests = [],
  clarificationResponses = [],
  preserveCurrentClosingForHistory = false,
  convertDateTime
} = {}) {
  const model = controller.model;
  const lease = captureWorkspaceLease(model);
  const isCurrent = () => controller.model === model && isWorkspaceLeaseCurrent(model, lease);
  const assertCurrent = () => { if (!isCurrent()) throw workspaceChangedError(); };
  await controller.awaitAuthoritativeMutationBoundary?.();
  assertCurrent();
  const original = structuredClone(
    model.state.goithau?.find((record) => String(record.id) === String(pkg.id)) || pkg,
  );
  if (String(original.rowVersion ?? "") !== String(pkg.rowVersion ?? "")
    || String(original.rootId || original.id) !== String(pkg.rootId || pkg.id)) {
    throw invitationSaveError("ROW_VERSION_CONFLICT", { ok: false, conflict: true });
  }
  if (typeof controller.autoSync !== "function" || typeof controller.fetchRecordByLookup !== "function") {
    throw invitationSaveError("INVITATION_SAVE_UNAVAILABLE");
  }
  const candidate = {
    ...structuredClone(original),
    giaHanList: structuredClone(extensions),
    yeuCauLamRoList: structuredClone(clarificationRequests),
    traLoiLamRoList: structuredClone(clarificationResponses),
  };
  const lastExtension = candidate.giaHanList.at(-1);
  if (lastExtension?.thoiGianDongThau) {
    const closingTime = convertDateTime(lastExtension.thoiGianDongThau);
    const currentClosing = parseBidDateTime(original.thoiGianDongThau);
    const extensionClosing = parseBidDateTime(closingTime);
    const savedSourceRow = /^gh-[a-f0-9]{64}$/.test(String(lastExtension.id || ""))
      && original.giaHanList?.find((row) => row.id === lastExtension.id);
    const savedSourceClosing = parseBidDateTime(savedSourceRow?.thoiGianDongThau);
    const isUnchangedSourceHistory = savedSourceClosing && extensionClosing
      && savedSourceClosing.getTime() === extensionClosing.getTime();
    if (!(preserveCurrentClosingForHistory || isUnchangedSourceHistory) || !currentClosing
      || (extensionClosing && extensionClosing > currentClosing)) {
      candidate.thoiGianDongThau = closingTime;
      candidate.thoiGianMoThau = closingTime;
    }
  }
  const mutation = model.beginWorkspaceMutation?.();
  const outbox = mutation?.outbox;
  let receipt = null;
  let previousIntent = null;
  let syncResult;
  let canonicalCommitted = false;
  try {
    if (!outbox?.captureReceiptForRecords || !outbox?.checkpointForReceipt || !outbox?.ack) {
      throw invitationSaveError("INVITATION_ROLLBACK_UNAVAILABLE");
    }
    if (outbox.snapshot().dirtyTables?.goithau) {
      throw invitationSaveError("INVITATION_PENDING_TABLE_MUTATION");
    }
    previousIntent = outbox.checkpointForReceipt(outbox.captureReceiptForRecords({ goithau: [original] }));
    stageLocalRecords(model, "goithau", candidate, mutation, [original]);
    receipt = outbox.captureReceiptForRecords({ goithau: [candidate] });
    syncResult = await persistAndSync(controller, "goithau", {
      authoritativeBoundaryChecked: true,
      workspaceMutation: mutation,
      releaseBeforeRemoteSync: true,
      changes: { upserts: { goithau: [candidate] } },
    });
    const canonicalStatus = classifyCanonicalSyncResult(syncResult);
    canonicalCommitted = canonicalStatus === CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED;
    if (!canonicalCommitted) {
      throw invitationSaveError(syncResult?.code || syncResult?.data?.code || canonicalStatus, syncResult);
    }
    assertCurrent();
    const savedPackage = await controller.fetchRecordByLookup?.("goithau", original.id, {
      requireCanonicalOutcome: true,
    });
    assertCurrent();
    if (!savedPackage) throw invitationSaveError("INVITATION_RELOAD_UNCONFIRMED", syncResult);
    return savedPackage;
  } catch (error) {
    if (canonicalCommitted) {
      error.canonicalCommitted = true;
      error.syncResult ||= syncResult;
    }
    if (!canonicalCommitted && receipt) {
      await rollbackInvitationAttempt({
        outbox, receipt, previousIntent, original, database: lease.db, model, isCurrent,
      }, error);
    }
    if (!isCurrent() && error.code !== "WORKSPACE_CHANGED") {
      const staleError = workspaceChangedError();
      staleError.syncResult = syncResult;
      staleError.rollbackErrors = error.rollbackErrors;
      if (canonicalCommitted) staleError.canonicalCommitted = true;
      throw staleError;
    }
    throw error;
  } finally {
    model.finishWorkspaceMutation?.(mutation);
  }
}
