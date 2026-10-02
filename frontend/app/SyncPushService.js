import { apiFetch } from "../shared/apiClient.js";
import { invalidatePaginatedQueryCache } from "../shared/tableDataUtils.js";
import { clearDeletedBusinessListSelections } from "../shared/BusinessListSelection.js";
import { DraftRecoveryStore } from "../shared/DraftRecoveryStore.js";
import { applyRecordPatch } from "./mutationQueue.js";
import { CLIENT_TABLE_MAP } from "../documents/schemaRuntime.js";
import {
  reportOutboxFailure,
  reportSyncConflict,
} from "../shared/releaseDiagnostics.js";
import {
  getSyncValidationErrors,
  resolveRowVersionConflicts,
} from "./ConflictResolver.js";
import {
  applyDashboardSummaryAfterMutation,
  collectCommittedMutationKeys,
  deleteSuccessMessage,
  mutationAffectsDashboard,
  renderChangedState,
  selectPostCommitRenderKeys,
} from "./SyncRenderCoordinator.js";
import {
  captureWorkspace,
  currentWorkspaceStorage,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";
import {
  hideOfflineBanner,
  showSyncErrorReport,
} from "./SyncPresenter.js";


const VALIDATION_ERROR_CATEGORIES = Object.freeze([
  "required",
  "format",
  "business_logic",
  "duplicate",
  "authorization",
  "conflict",
  "not_found",
  "system",
]);

function conflictStorageFailure(controller, { status, data, recoveryDraft }) {
  const failure = recoveryDraft?.storageDegraded
    ? recoveryDraft : controller.model?.conflictQuarantineFailure;
  if (!failure?.storageDegraded) return null;
  const receiptRetired = failure.receiptRetired === true;
  controller._syncConflict = {
    serverSyncVersion: data.currentSyncVersion ?? null,
    message: data.message || data.error || "Server data changed before local sync.",
    reloadRequired: true,
    reloadUnsafe: true,
  };
  controller.updateSyncState({
    phase: "storageError",
    online: true,
    message: "Chưa thể hoàn tất lưu trữ xung đột · Giữ tab đang mở",
  });
  controller.view?.showToast?.(
    "Chưa thể hoàn tất lưu trữ xung đột",
    "Nội dung nhập vẫn đang được giữ trong tab này. Vui lòng giữ tab mở; chưa thể bảo đảm tải lại sẽ khôi phục đúng dữ liệu máy chủ.",
    "warning",
  );
  return {
    ok: false,
    status,
    data,
    conflictQuarantined: receiptRetired,
    storageDegraded: true,
    reloadUnsafe: true,
    receiptRetired,
    ...(recoveryDraft?.id ? { recoveryDraftId: recoveryDraft.id } : {}),
  };
}

function categoryFromCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return "";
  if (/(?:DUPLICATE|ALREADY_EXISTS|_EXISTS$)/.test(code)) return "duplicate";
  if (/(?:ACCESS_DENIED|AUTH_REQUIRED|FORBIDDEN|MANAGER_REQUIRED|PERMISSION_REQUIRED|OWNER_MISMATCH)/.test(code)) {
    return "authorization";
  }
  if (/(?:CONFLICT|STALE|FULL_SYNC_REQUIRED|VISIBILITY_RESET_REQUIRED|IDEMPOTENCY_KEY_REUSED)/.test(code)) {
    return "conflict";
  }
  if (/(?:NOT_FOUND|RECORD_DELETED)/.test(code)) return "not_found";
  if (/(?:REQUIRED|MISSING)/.test(code)) return "required";
  if (/(?:FAILED|UNAVAILABLE|WRITE_QUEUE|INTERNAL|SYSTEM)/.test(code)) return "system";
  if (/(?:IMMUTABLE|LOCKED|BLOCKED|INCOMPLETE|NOT_APPLICABLE|MISMATCH)/.test(code)) {
    return "business_logic";
  }
  if (/(?:INVALID|FORMAT)/.test(code)) return "format";
  return "";
}

export function categorizeValidationErrors(errors) {
  const categorized = Object.fromEntries(
    VALIDATION_ERROR_CATEGORIES.map((category) => [category, []]),
  );
  errors.forEach((error) => {
    const message = error.message || "";
    const codedCategory = categoryFromCode(error?.code);
    if (codedCategory) categorized[codedCategory].push(message);
    else if (message.includes("không được để trống")) categorized.required.push(message);
    else if (message.includes("định dạng") || message.includes("không đúng")) categorized.format.push(message);
    else if (["phải sau", "phải bằng", "phải nằm", "không được nhỏ"].some((term) => message.includes(term))) categorized.business_logic.push(message);
    else if (message.includes("đã tồn tại")) categorized.duplicate.push(message);
    else categorized.system.push(message);
  });
  return categorized;
}

function logValidationErrors(errors, requestId) {
  const categorized = categorizeValidationErrors(errors);
  const lines = ["⚠️ Phát hiện lỗi dữ liệu, không thể đồng bộ:\n"];
  const sections = [
    ["required", "❌ THIẾU THÔNG TIN BẮT BUỘC:"],
    ["format", "📋 SAI ĐỊNH DẠNG:"],
    ["business_logic", "⚡ SAI LOGIC NGHIỆP VỤ:"],
    ["duplicate", "🔁 DỮ LIỆU BỊ TRÙNG LẶP:"],
    ["authorization", "🔒 KHÔNG ĐỦ QUYỀN:"],
    ["conflict", "⚠️ XUNG ĐỘT DỮ LIỆU:"],
    ["not_found", "🔎 KHÔNG TÌM THẤY DỮ LIỆU:"],
    ["system", "🛠️ LỖI HỆ THỐNG:"],
  ];
  sections.forEach(([key, title]) => {
    if (!categorized[key].length) return;
    lines.push(title);
    categorized[key].forEach((message) => lines.push(`  • ${message}`));
    lines.push("");
  });
  console.error(`[Sync Error]\n${lines.join("\n")}`, {
    requestId: requestId || null,
    errors,
  });
}

function staleWorkspaceResult(extra = {}) {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
    ...extra,
  };
}

function mutationRequiresManagerPersona(payload) {
  if (Array.isArray(payload?.permissionmatrix) && payload.permissionmatrix.length > 0) {
    return true;
  }
  return (payload?.deletions || []).some((deletion) => (
    ["permissionmatrix", "ma_tran_phan_quyen"].includes(String(deletion?.table || ""))
  ));
}

function logRowVersionConflicts(data, snapshot, workspace) {
  for (const error of getSyncValidationErrors(data)) {
    if (error?.code !== "ROW_VERSION_CONFLICT") continue;
    console.warn("[Sync ROW_VERSION_CONFLICT]", {
      table: String(error.table || ""),
      id: String(error.id || ""),
      expectedVersion: Number.isInteger(error.expectedVersion) ? error.expectedVersion : null,
      currentVersion: Number.isInteger(error.currentVersion) ? error.currentVersion : null,
      mutationId: String(snapshot?.id || snapshot?.clientMutationId || ""),
      workspace: String(workspace?.workspaceKey || workspace?.organizationId || ""),
    });
  }
}

const REJECTED_DRAFT_STORAGE_KEY = "bf_rejected_mutation_drafts_v1";
const RECORD_LOOKUP_TABLES = new Set([
  "kehoach", "goithau", "hopdong", "chudautu", "nhathau", "chuyengia", "thongtinmothau",
]);

function rejectedDraftStore(controller, workspace) {
  const storage = workspace.storage || controller.model?.workspaceStorage;
  if (!workspace.workspaceKey || typeof storage?.getItem !== "function"
    || typeof storage?.setItem !== "function") return null;
  return new DraftRecoveryStore(storage, { storageKey: REJECTED_DRAFT_STORAGE_KEY });
}

function receiptHasRecoverableIntent(snapshot) {
  return ["upserts", "patches"].some((operation) => Object.values(
    snapshot?.recordSnapshots?.[operation] || {},
  ).some((records) => Object.keys(records || {}).length > 0))
    || Object.keys(snapshot?.deletes || {}).length > 0;
}

const RECOVERY_PHASE_ORDER = { prepared: 0, rejected: 1, restored: 2 };

function mergeRejectedArchives(...archives) {
  const merged = {};
  for (const archive of archives) {
    if (archive === null || archive === undefined) continue;
    if (typeof archive !== "object" || Array.isArray(archive)) throw new Error("Invalid rejected recovery archive");
    for (const [key, draft] of Object.entries(archive)) {
      const prior = merged[key];
      const phase = RECOVERY_PHASE_ORDER[draft?.payload?.phase] ?? -1;
      const priorPhase = RECOVERY_PHASE_ORDER[prior?.payload?.phase] ?? -1;
      if (!prior || phase > priorPhase || (phase === priorPhase && Number(draft?.savedAt || 0) >= Number(prior.savedAt || 0))) {
        merged[key] = draft;
      }
    }
  }
  return merged;
}

async function saveRejectedRecovery(recovery) {
  const localSaved = recovery.store?.save(
    recovery.key, recovery.payload, { pendingServerSync: false },
  ) === true;
  let databaseSaved = false;
  const database = recovery.database;
  if (typeof database?.set === "function") {
    const draft = {
      payload: structuredClone(recovery.payload), savedAt: Date.now(), pendingServerSync: false,
    };
    try {
      const merge = (current) => mergeRejectedArchives(current, { [recovery.key]: draft });
      if (typeof database.update === "function") await database.update(REJECTED_DRAFT_STORAGE_KEY, merge);
      else await database.set(REJECTED_DRAFT_STORAGE_KEY, merge(await database.get?.(REJECTED_DRAFT_STORAGE_KEY)));
      databaseSaved = true;
    } catch { /* Local storage may still preserve this receipt durably. */ }
  }
  return localSaved || databaseSaved || (!recovery.store && !database && !recovery.durabilityRequired);
}

function setPendingRejectedRecovery(controller, workspace, recovery) {
  controller._rejectedRecordRestoration = {
    ...recovery,
    workspaceToken: String(workspace.token || workspace.organizationId || ""),
  };
}

function restorationPendingResult(controller, { storageDegraded = false } = {}) {
  controller.updateSyncState?.({
    phase: storageDegraded ? "storageError" : "validationRejected",
    message: storageDegraded
      ? "Chưa thể giữ bản nháp phục hồi · Giữ tab mở và thử lại"
      : "Thay đổi bị từ chối · Đang chờ khôi phục dữ liệu máy chủ",
  });
  return { ok: false, validation: true, restorationPending: true, storageDegraded };
}

async function projectRejectedRecord(controller, rejected, serverRecord, workspace) {
  const records = controller.model.state[rejected.type];
  if (!Array.isArray(records)) return null;
  const restored = serverRecord && String(serverRecord.id) === String(rejected.id)
    ? rejectedRecordProjection(controller.model, rejected.type, serverRecord) : null;
  const index = records.findIndex((item) => String(item.id) === String(rejected.id));
  if (!restored) {
    if (index >= 0) records.splice(index, 1);
  } else if (index >= 0) records[index] = restored;
  else records.push(restored);
  controller.model.entityIndexes?.invalidate?.(rejected.type);
  if (restored) await controller.model.db?.putRecord?.(rejected.type, restored);
  else await controller.model.db?.deleteRecord?.(rejected.type, rejected.id);
  return workspaceIsCurrent(controller, workspace) ? null : staleWorkspaceResult();
}

async function restoreRejectedRecords(controller, rejectedRecords, workspace, snapshot = null) {
  const changedKeys = new Set();
  const pendingRecords = [];
  const existingRecords = rejectedRecords.filter((record) => record.newInsert !== true);
  const hasNewerPendingMutations = Boolean(controller.model.hasPendingMutationOutboxChanges?.());
  const needsFullReconciliation = existingRecords.length > 0 && (
    hasNewerPendingMutations
    || existingRecords.some((record) => !RECORD_LOOKUP_TABLES.has(record.type))
  );
  const activePush = controller._autoSyncOwner?.workspaceToken === String(
    workspace.token || workspace.organizationId || "",
  ) && controller._autoSyncOwner.promise;
  let fullSnapshot = null;
  if (needsFullReconciliation && !activePush) {
    // Full reconciliation re-applies active outbox intent. Individual lookups
    // cannot safely overwrite newer local edits or recover non-lookup tables.
    // A pull waits for its push owner, so recovery inside that owner must first
    // return pending rather than waiting recursively for the same push.
    try {
      const pulled = await controller.forceSyncData?.(false, true, false);
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
      if (pulled?.ok && pulled.data?.partial !== true) fullSnapshot = pulled.data || null;
    } catch (error) {
      console.error("Failed to reconcile rejected server records:", error);
    }
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
  }
  for (const rejected of rejectedRecords) {
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    let serverRecord = null;
    if (rejected.newInsert !== true) {
      if (needsFullReconciliation && activePush) {
        pendingRecords.push(rejected);
        continue;
      }
      try {
        if (RECORD_LOOKUP_TABLES.has(rejected.type)) {
          serverRecord = await controller.fetchRecordByLookup(
            rejected.type,
            rejected.conflictingId || rejected.id,
            { requireCanonicalOutcome: true, storeResult: false },
          );
        } else if (Array.isArray(fullSnapshot?.[rejected.type])
          && !(fullSnapshot.paginatedKeys || []).includes(rejected.type)
          && (fullSnapshot.useServerSidePagination !== true
            || Array.isArray(fullSnapshot.paginatedKeys))) {
          serverRecord = fullSnapshot[rejected.type].find(
            (record) => String(record.id) === String(rejected.id),
          ) || null;
        } else {
          pendingRecords.push(rejected);
          continue;
        }
      } catch (error) {
        console.error("Failed to restore rejected server record:", error);
        if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
        pendingRecords.push(rejected);
        // A known pre-mutation snapshot can roll back rejected input, but it
        // does not prove the record's current revision or current read scope.
        const base = snapshot?.baseSnapshots?.[rejected.type]?.[rejected.id];
        if (base && String(base.id) === rejected.id && Number(base.rowVersion) > 0
          && (!base.organizationId || String(base.organizationId) === workspace.organizationId)) {
          try {
            await projectRejectedRecord(controller, rejected, structuredClone(base), workspace);
          } catch (storageError) {
            console.error("Failed to persist rejected-record rollback:", storageError);
          }
          if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
          changedKeys.add(rejected.type);
        }
        continue;
      }
    }
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    // A rejected fresh insert has no server row, but a distinct newer local
    // correction may now own the same id. Preserve that input instead of
    // treating the original rejection as authority to erase the correction.
    if (rejected.newInsert === true) {
      serverRecord = controller.model.getMutationQueue?.()?.upserts?.[rejected.type]?.[rejected.id] || null;
    }
    const projected = await projectRejectedRecord(controller, rejected, serverRecord, workspace);
    if (projected?.workspaceChanged) return projected;
    changedKeys.add(rejected.type);
  }
  if (changedKeys.size > 0) {
    await renderChangedState(controller, changedKeys, { isBackground: true });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
  }
  return { ok: pendingRecords.length === 0, pendingRecords };
}

function rejectedRecordProjection(model, table, canonical) {
  // Read the queue after the canonical response arrives: a newer mutation may
  // have been staged while that lookup was in flight. Preserve its exact intent
  // and rowVersion rather than overwriting or silently rebasing the edit.
  const queue = model.getMutationQueue?.() || {};
  const id = String(canonical.id);
  if ((queue.deletes || []).some((record) => record.table === table && String(record.id) === id)) return null;
  const upsert = queue.upserts?.[table]?.[id];
  if (upsert) return structuredClone(upsert);
  const patch = queue.patches?.[table]?.[id];
  return patch ? applyRecordPatch(canonical, patch) : canonical;
}

function pendingRejectedRecoveries(controller, workspace) {
  const store = rejectedDraftStore(controller, workspace);
  const database = controller.model?.db;
  const hydrated = controller._rejectedRecoveryDatabaseSnapshot;
  const databaseDrafts = hydrated && hydrated.database === database
    && hydrated.workspaceToken === String(workspace.token || workspace.organizationId || "")
    ? hydrated.drafts : null;
  const drafts = mergeRejectedArchives(databaseDrafts, store?.readAll() || {});
  if (store && store.durability !== "ready" && databaseDrafts === null) {
    return { storageDegraded: true, recoveries: [] };
  }
  const recoveries = Object.entries(drafts).filter(([, draft]) => (
    draft?.payload?.workspaceKey === workspace.workspaceKey
    && ["prepared", "rejected"].includes(draft.payload.phase)
  )).map(([key, draft]) => ({ key, payload: draft.payload, store, database, durabilityRequired: true }));
  const inMemory = controller._rejectedRecordRestoration;
  if (inMemory?.workspaceToken === String(workspace.token || workspace.organizationId || "")
    && !recoveries.some((recovery) => recovery.key === inMemory.key)) {
    recoveries.push(inMemory);
  }
  return { recoveries, storageDegraded: false };
}

function preparedReceiptForCurrentIntent(saved, current) {
  const receipt = { ...saved, upserts: {}, patches: {}, deletes: {}, dirtyTables: {} };
  // A receipt identity can change because of an unrelated edit. Reconcile
  // each original operation independently, never adopt the whole new batch.
  // Unmatched entries remain in this receipt with an impossible generation so
  // the existing rejection scoping/dependency rules cannot retire newer input.
  for (const operation of ["upserts", "patches"]) {
    for (const [table, entries] of Object.entries(saved?.[operation] || {})) {
      receipt[operation][table] = {};
      for (const id of Object.keys(entries || {})) {
        const before = saved.recordSnapshots?.[operation]?.[table]?.[id];
        const now = current?.recordSnapshots?.[operation]?.[table]?.[id];
        receipt[operation][table][id] = before && now && JSON.stringify(before) === JSON.stringify(now)
          ? current[operation]?.[table]?.[id] ?? -1 : -1;
      }
    }
  }
  let ambiguous = false;
  for (const key of Object.keys(saved?.deletes || {})) {
    const generation = current?.deletes?.[key];
    // Legacy receipts do not contain deletion expectedVersion/content. A new
    // batch identity cannot prove whether a same-key deletion was corrected.
    if (generation !== undefined && current.id !== saved.id) ambiguous = true;
    receipt.deletes[key] = current?.id === saved.id ? generation ?? -1 : -1;
  }
  for (const table of Object.keys(saved?.dirtyTables || {})) {
    receipt.dirtyTables[table] = current?.id === saved.id ? current.dirtyTables?.[table] ?? -1 : -1;
  }
  return { receipt, ambiguous };
}

function matchingPreparedTargets(saved, current, targets) {
  const { receipt } = preparedReceiptForCurrentIntent(saved, current);
  return targets.some(({ type, id }) => (
    Number(receipt.upserts?.[type]?.[id] ?? -1) >= 0
    || Number(receipt.patches?.[type]?.[id] ?? -1) >= 0
    || Number(receipt.deletes?.[`delete:${type}:${id}`] ?? -1) >= 0
  ));
}

async function recoverRejectedProjections(controller, recoveries, workspace) {
  for (const recovery of recoveries) {
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    const payload = recovery.payload;
    if (payload.phase === "prepared") {
      // Resume an interrupted terminal rejection, not the rejected mutation.
      const currentReceipt = controller.model.buildMutationSyncPayload?.()?.snapshot;
      const { receipt, ambiguous } = preparedReceiptForCurrentIntent(payload.snapshot, currentReceipt);
      if (ambiguous || (!currentReceipt && controller.model.hasPendingMutationOutboxChanges?.())) {
        return restorationPendingResult(controller);
      }
      const targets = rejectedRecordsFromReceipt(payload.snapshot, payload.validationErrors);
      const removed = controller.model.discardRejectedMutations?.(
        payload.validationErrors, receipt, { fallbackToBatch: true },
      ) || [];
      await controller.model.flushMutationOutbox?.();
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
      if (matchingPreparedTargets(payload.snapshot, controller.model.buildMutationSyncPayload?.()?.snapshot, targets)) {
        return restorationPendingResult(controller);
      }
      payload.pendingRecords = [...new Map([...targets, ...removed].map((record) => [`${record.type}:${record.id}`, record])).values()];
      payload.phase = "rejected";
    }
    const restored = await restoreRejectedRecords(
      controller, payload.pendingRecords || [], workspace, payload.snapshot,
    );
    if (restored.workspaceChanged) return restored;
    payload.pendingRecords = restored.pendingRecords;
    payload.phase = restored.ok ? "restored" : "rejected";
    setPendingRejectedRecovery(controller, workspace, recovery);
    if (!await saveRejectedRecovery(recovery)) return restorationPendingResult(controller, { storageDegraded: true });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    if (!restored.ok) return restorationPendingResult(controller);
    controller._rejectedRecordRestoration = null;
  }
  return { ok: true };
}

function rejectedRecordsFromReceipt(snapshot, validationErrors = []) {
  const records = new Map();
  for (const operation of ["upserts", "patches"]) {
    for (const [type, byId] of Object.entries(snapshot?.recordSnapshots?.[operation] || {})) {
      for (const [id, record] of Object.entries(byId || {})) {
        records.set(`${type}:${id}`, {
          type, id, operation: operation === "patches" ? "patch" : "upsert",
          newInsert: operation === "upserts" && !snapshot?.baseSnapshots?.[type]?.[id]
            && record?.expectedVersion === undefined && record?.rowVersion === undefined,
        });
      }
    }
  }
  for (const key of Object.keys(snapshot?.deletes || {})) {
    const [, type, ...id] = key.split(":");
    if (type && id.length) records.set(`${type}:${id.join(":")}`, { type, id: id.join(":"), operation: "delete" });
  }
  const serverTables = Object.fromEntries(Object.entries(CLIENT_TABLE_MAP).map(([key, table]) => [table, key]));
  const scopedKeys = new Set();
  let unscoped = false;
  for (const error of validationErrors) {
    if (!error?.table || !error?.id) unscoped = true;
    else scopedKeys.add(`${serverTables[error.table] || error.table}:${String(error.id)}`);
  }
  const matching = [...records.keys()].some((key) => scopedKeys.has(key));
  return [...records.entries()].filter(([key]) => unscoped || !matching || scopedKeys.has(key)).map(([, record]) => record);
}

export async function applySuccessfulPush(controller, {
  data,
  payload,
  snapshot,
  deferPostCommitRender,
  status,
  workspace = captureWorkspace(controller),
}) {
  if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  const storage = workspace.storage || currentWorkspaceStorage(controller);
  // The timestamp fallback is also a pull cursor, not an ACK timestamp.
  // A push ACK identifies the server transaction, not a complete pulled
  // snapshot. Another actor may have committed rows between our cursor and
  // this ACK, so only SyncPullService.commitSyncCursor may advance the delta
  // cursor after the complete delta has been applied.
  if (controller.model) controller.model.syncErrors = [];
  if (typeof controller.model?.clearCommittedMutationBatch === "function") {
    controller.model.clearCommittedMutationBatch(snapshot);
  } else {
    storage.removeItem("bf_local_deletions");
  }
  if (Array.isArray(data.rowVersions) && typeof controller.model?.applyCommittedRowVersions === "function") {
    await controller.model.applyCommittedRowVersions(data.rowVersions);
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  }
  let orphanStateChanged = false;
  for (const orphan of Array.isArray(data.orphanedIds) ? data.orphanedIds : []) {
    const stateKey = {
      thong_tin_mo_thau: "thongtinmothau",
      phan_cong_nhan_su: "assignments",
    }[orphan.table] || orphan.table;
    if (!stateKey || !Array.isArray(controller.model.state[stateKey])) continue;
    const before = controller.model.state[stateKey].length;
    controller.model.state[stateKey] = controller.model.state[stateKey].filter(
      (item) => String(item.id) !== String(orphan.id)
    );
    if (controller.model.state[stateKey].length < before) {
      await controller.model.persistData(stateKey, { trackMutation: false });
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
      orphanStateChanged = true;
    }
  }
  const committedKeys = collectCommittedMutationKeys(payload);
  // Pages loaded before the commit may omit the newly inserted rows. Once the
  // outbox is acknowledged its overlay disappears, so retire those pages first.
  for (const key of committedKeys) {
    invalidatePaginatedQueryCache(controller.model, key, { abortInFlight: true });
  }
  if (applyDashboardSummaryAfterMutation(controller.model, payload, data)) {
    committedKeys.add("dashboardSummary");
    if (controller.view) controller.view._dashboardAggregateCache = null;
  }
  const deletedKeys = new Set(
    (payload.deletions || []).map((item) => item?.table).filter(Boolean)
  );
  const committedDeletions = {};
  for (const deletion of [...(payload.deletions || []), ...(Array.isArray(data.deleteImpacts) ? data.deleteImpacts : [])]) {
    const table = deletion?.table;
    if (!table || deletion.id == null) continue;
    (committedDeletions[table] ||= []).push(deletion.id);
  }
  clearDeletedBusinessListSelections(controller.model, committedDeletions);
  deletedKeys.forEach((key) => {
    if (controller.model?.currentPage && Object.prototype.hasOwnProperty.call(controller.model.currentPage, key)) {
      controller.model.currentPage[key] = 1;
    }
  });
  const renderKeys = selectPostCommitRenderKeys(committedKeys, {
    hasDeletions: deletedKeys.size > 0,
    serverStateChanged: orphanStateChanged,
  });
  if (!deferPostCommitRender) {
    await renderChangedState(controller, renderKeys);
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  }
  if (Array.isArray(data.deleteImpacts) && data.deleteImpacts.length > 0) {
    controller.view?.showToast?.(
      "Thành công",
      deleteSuccessMessage(payload, data.deleteImpacts),
      "success",
    );
  }
  controller._syncConflict = null;
  hideOfflineBanner();
  controller.updateSyncState({ phase: "serverSaved", online: true, lastSyncedAt: Date.now() });
  return { ok: true, status, data };
}

export async function applyFailedPush(controller, {
  status,
  data,
  snapshot,
  workspace = captureWorkspace(controller),
}) {
  if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  const validationErrors = getSyncValidationErrors(data);
  if (status === 409 && data?.code === "IDEMPOTENCY_KEY_REUSED") {
    const renewed = controller.model?.renewMutationBatchIdentity?.() === true;
    if (renewed) await controller.model?.flushMutationOutbox?.();
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    controller._syncConflict = null;
    controller.updateSyncState({
      phase: "localPending",
      online: true,
      message: "Đang làm mới yêu cầu đồng bộ · Thay đổi cục bộ vẫn được giữ lại",
    });
    controller.view?.showToast?.(
      "Đang khôi phục đồng bộ",
      "Ứng dụng đã giữ nguyên thay đổi cục bộ và đang đối chiếu lại dữ liệu máy chủ.",
      "warning",
    );
    return {
      ok: false,
      status,
      data,
      idempotencyKeyReused: true,
      retryable: renewed,
    };
  }
  const hasRowVersionConflict = validationErrors.some(
    (error) => error?.code === "ROW_VERSION_CONFLICT",
  );
  if (
    (status === 409 || data.status === "conflict")
    && hasRowVersionConflict
    && typeof controller.model?.quarantineMutationBatch === "function"
  ) {
    logRowVersionConflicts(data, snapshot, workspace);
    const recoveryDraft = await controller.model.quarantineMutationBatch({ data, snapshot });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    const storageFailure = conflictStorageFailure(controller, { status, data, recoveryDraft });
    if (storageFailure) return storageFailure;
    if (recoveryDraft?.id) {
      controller._syncConflict = null;
      controller.updateSyncState({
        phase: "conflict",
        online: true,
        message: "Dữ liệu đã thay đổi trên máy chủ · Nội dung nhập được giữ đến khi nhấn F5",
      });
      controller.view?.showToast?.(
        "Dữ liệu đã thay đổi trên máy chủ",
        "Nội dung nhập được giữ trên màn hình đến khi nhấn F5. Bản nháp trong Trung tâm xung đột sẽ không tự áp lại; F5 tải dữ liệu máy chủ.",
        "warning",
      );
      return {
        ok: false,
        status,
        data,
        conflictQuarantined: true,
        recoveryDraftId: recoveryDraft.id,
      };
    }
    if (recoveryDraft?.sessionOnly === true) {
      controller._syncConflict = {
        serverSyncVersion: data.currentSyncVersion ?? null,
        message: data.message || data.error || "Server data changed before local sync.",
        reloadRequired: true,
      };
      controller.updateSyncState({
        phase: "conflict",
        online: true,
        message: "Dữ liệu đã thay đổi trên máy chủ · Nhấn F5 để tải trạng thái mới nhất",
      });
      if (data.currentSyncVersion !== void 0 && data.currentSyncVersion !== null) {
        (workspace.storage || currentWorkspaceStorage(controller)).setItem(
          "bf_conflict_server_sync_version",
          String(data.currentSyncVersion),
        );
      }
      controller.view?.showToast?.(
        "Dữ liệu đã thay đổi trên máy chủ",
        "Nội dung nhập được giữ trên màn hình. Nhấn F5 để tải dữ liệu máy chủ; nội dung xung đột sẽ không tự áp lại.",
        "warning",
      );
      return {
        ok: false,
        status,
        data,
        conflictQuarantined: true,
        reloadRequired: true,
        sessionOnlyConflict: true,
      };
    }
  }
  if (status === 409 || data.status === "conflict") {
    void reportSyncConflict({
      workspaceKey: workspace.workspaceKey,
      correlationId: data.requestId,
    });
    const resolution = await resolveRowVersionConflicts(controller, { data, snapshot });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    if (resolution.resolved) {
      controller._syncConflict = null;
      controller.updateSyncState({ phase: "idle", online: true, lastSyncedAt: Date.now() });
      return { ok: true, status, data, resolvedConflict: resolution.choice };
    }
    controller._syncConflict = {
      serverSyncVersion: data.currentSyncVersion ?? null,
      message: data.message || data.error || "Server data changed before local sync."
    };
    controller.updateSyncState({ phase: "conflict" });
    if (data.currentSyncVersion !== void 0 && data.currentSyncVersion !== null) {
      (workspace.storage || currentWorkspaceStorage(controller)).setItem(
        "bf_conflict_server_sync_version",
        String(data.currentSyncVersion),
      );
    }
    controller.view?.showToast?.(
      "Cảnh báo",
      "Dữ liệu đã thay đổi trong lúc bạn thao tác. Ứng dụng đang tải lại dữ liệu mới nhất; vui lòng kiểm tra và lưu lại.",
      "warning",
    );
    return { ok: false, status, data, conflict: true };
  }
  if (validationErrors.length > 0) {
    let recovery = null;
    if (receiptHasRecoverableIntent(snapshot)) {
      recovery = {
        key: String(snapshot.id || snapshot.clientMutationId || ""),
        store: rejectedDraftStore(controller, workspace),
        database: controller.model?.db,
        durabilityRequired: true,
        payload: {
          workspaceKey: workspace.workspaceKey,
          phase: "prepared",
          snapshot,
          validationErrors,
        },
      };
      if (!recovery.key || !await saveRejectedRecovery(recovery)) {
        controller._terminalRejectionRecovery = { status, data, snapshot, workspace };
        showSyncErrorReport(controller, validationErrors);
        return { ...restorationPendingResult(controller, { storageDegraded: true }), status, data, draftRecoveryFailed: true };
      }
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    }
    controller._terminalRejectionRecovery = null;
    const rejected = typeof controller.model?.discardRejectedMutations === "function"
      ? controller.model.discardRejectedMutations(
        validationErrors,
        snapshot,
        { fallbackToBatch: true },
      )
      : [];
    await controller.model?.flushMutationOutbox?.();
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    recovery ||= {
      key: String(snapshot?.id || ""), store: null,
      payload: { workspaceKey: workspace.workspaceKey, snapshot, validationErrors },
    };
    recovery.payload.phase = "rejected";
    recovery.payload.pendingRecords = rejected;
    setPendingRejectedRecovery(controller, workspace, recovery);
    if (!await saveRejectedRecovery(recovery)) {
      showSyncErrorReport(controller, validationErrors, rejected.length);
      return { ...restorationPendingResult(controller, { storageDegraded: true }), status, data };
    }
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    const restoreResult = await restoreRejectedRecords(controller, rejected, workspace, snapshot);
    if (restoreResult?.workspaceChanged || !workspaceIsCurrent(controller, workspace)) {
      return staleWorkspaceResult({ status, data });
    }
    logValidationErrors(validationErrors, data.requestId);
    showSyncErrorReport(controller, validationErrors, rejected.length);
    recovery.payload.pendingRecords = restoreResult.pendingRecords;
    recovery.payload.phase = restoreResult.ok ? "restored" : "rejected";
    const recoverySaved = await saveRejectedRecovery(recovery);
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    if (!restoreResult.ok || !recoverySaved) {
      return { ...restorationPendingResult(controller, { storageDegraded: !recoverySaved }), status, data };
    }
    controller._rejectedRecordRestoration = null;
  } else {
    console.error("[Sync Error]", data.error || data.message || "Đồng bộ thất bại");
    controller.view?.showToast?.("Thất bại", "Không thể lưu thay đổi. Vui lòng thử lại.", "error");
  }
  controller.updateSyncState({
    phase: validationErrors.length > 0
      ? "validationRejected"
      : "error",
    message: validationErrors.length > 0
      ? `${validationErrors.length} lỗi dữ liệu`
      : data.error || data.message || "Lỗi đồng bộ",
  });
  return { ok: false, status, data, validation: validationErrors.length > 0 };
}

function resumeAfterRejectedRecovery(controller, workspace, options, deferPostCommitRender) {
  if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
  if (deferPostCommitRender) controller._deferPostCommitRender = true;
  return controller.autoSync(options);
}

function synchronizeRejectedRecovery(controller, workspace, options, deferPostCommitRender) {
  const workspaceToken = String(workspace.token || workspace.organizationId || "");
  const terminalRecovery = controller._terminalRejectionRecovery;
  if (terminalRecovery && workspaceIsCurrent(controller, terminalRecovery.workspace)) {
    return applyFailedPush(controller, terminalRecovery);
  }
  const recoveryDatabase = controller.model?.db;
  if (options.rejectedArchiveHydrated !== true && typeof recoveryDatabase?.get === "function"
    && typeof recoveryDatabase?.set === "function") {
    const activeRead = controller._rejectedArchiveReadOwner;
    if (activeRead?.workspaceToken === workspaceToken && activeRead.database === recoveryDatabase) {
      activeRead.deferPostCommitRender ||= deferPostCommitRender;
      return activeRead.promise;
    }
    const owner = { workspaceToken, database: recoveryDatabase, deferPostCommitRender, promise: null };
    owner.promise = Promise.resolve().then(() => recoveryDatabase.get(REJECTED_DRAFT_STORAGE_KEY))
      .then((drafts) => {
        if (!workspaceIsCurrent(controller, workspace) || controller.model?.db !== recoveryDatabase) return staleWorkspaceResult();
        controller._rejectedRecoveryDatabaseSnapshot = {
          workspaceToken, database: recoveryDatabase, drafts: mergeRejectedArchives(drafts),
        };
        // The read is complete. Recovery may resume sync and request another
        // archive read; it must not join this promise and wait for itself.
        if (controller._rejectedArchiveReadOwner === owner) controller._rejectedArchiveReadOwner = null;
        return resumeAfterRejectedRecovery(controller, workspace,
          { ...options, rejectedArchiveHydrated: true }, owner.deferPostCommitRender);
      }).catch((error) => {
        if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
        return { ...restorationPendingResult(controller, { storageDegraded: true }), error };
      }).finally(() => {
        if (controller._rejectedArchiveReadOwner === owner) controller._rejectedArchiveReadOwner = null;
      });
    controller._rejectedArchiveReadOwner = owner;
    return owner.promise;
  }
  const activeRestoration = controller._rejectedRestoreOwner;
  if (activeRestoration?.workspaceToken === workspaceToken) {
    activeRestoration.deferPostCommitRender ||= deferPostCommitRender;
    return activeRestoration.promise;
  }
  const pendingRestoration = pendingRejectedRecoveries(controller, workspace);
  if (pendingRestoration.storageDegraded) {
    return Promise.resolve(restorationPendingResult(controller, { storageDegraded: true }));
  }
  if (pendingRestoration.recoveries.length === 0) return null;
  const owner = { workspaceToken, deferPostCommitRender, promise: null };
  const restored = recoverRejectedProjections(controller, pendingRestoration.recoveries, workspace);
  owner.promise = restored.finally(() => {
    if (controller._rejectedRestoreOwner === owner) controller._rejectedRestoreOwner = null;
  }).then((result) => {
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    return result.ok ? resumeAfterRejectedRecovery(controller, workspace,
      { ...options, rejectedArchiveHydrated: false }, owner.deferPostCommitRender) : result;
  });
  controller._rejectedRestoreOwner = owner;
  return owner.promise;
}

export function autoSync(options = {}) {
  const workspace = captureWorkspace(this);
  const workspaceToken = String(workspace.token || workspace.organizationId || "");
  const deferPostCommitRender = this._deferPostCommitRender === true;
  this._deferPostCommitRender = false;
  // In-tab conflict guards must not let late callbacks resubmit rejected work,
  // including a receipt restored after failed durable retirement.
  if (this._syncConflict) {
    return Promise.resolve({
      ok: false,
      conflict: true,
      status: 409,
      reconciliationRequired: true,
      ...(this._syncConflict.reloadUnsafe ? {
        storageDegraded: true,
        reloadUnsafe: true,
      } : {}),
    });
  }
  // A normal mutation-triggered flush must never race the startup owner,
  // even during the brief interval before its state projection is published.
  // Startup reconciliation will observe and replay pending outbox work after
  // its authoritative pull.
  if (options.startupReconciliation !== true && this._startupReconciliationPromise) {
    return Promise.resolve(this._startupReconciliationPromise).then(() => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      const settledPhase = this.getStartupReconciliationState?.().phase;
      return {
        ok: false,
        conflict: settledPhase === "CONFLICT",
        reconciliationRequired: true,
      };
    });
  }
  if (options.startupReconciliation !== true) {
    const startupState = this.getStartupReconciliationState?.();
    if (startupState?.phase === "CONFLICT") {
      return Promise.resolve({
        ok: false,
        conflict: true,
        reconciliationRequired: true,
      });
    }
    if (startupState?.phase === "SYNC_ERROR") {
      return Promise.resolve({ ok: false, reconciliationRequired: true });
    }
    if (["LOCAL_READY", "RECONCILING"].includes(startupState?.phase)) {
      const barrier = startupState?.promise || this._startupReconciliationPromise;
      if (barrier) {
        return Promise.resolve(barrier).then(() => {
          if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
          const settledPhase = this.getStartupReconciliationState?.().phase;
          if (settledPhase === "RECONCILED") {
            return this.autoSync(options);
          }
          return {
            ok: false,
            conflict: settledPhase === "CONFLICT",
            reconciliationRequired: true,
          };
        });
      }
      return Promise.resolve({ ok: false, reconciliationRequired: true });
    }
  }
  const activeSync = this._autoSyncOwner;
  if (activeSync?.workspaceToken === workspaceToken && activeSync.promise) {
    // Startup reconciliation owns the first push for this workspace. A
    // mutation callback that arrives at the same boundary must join that
    // request, not queue a second submission of the identical outbox batch.
    if (activeSync.startupReconciliation === true) return activeSync.promise;
    activeSync.queued = true;
    this._autoSyncQueued = true;
    return activeSync.promise.then((result) => {
      const retryRecoveredTransport = options.retryAfterReconnect === true
        && result?.ok === false
        && result?.transport === true;
      if (!activeSync.queued || (result?.ok !== true && !retryRecoveredTransport)) {
        activeSync.queued = false;
        if (this._autoSyncOwner === activeSync) this._autoSyncQueued = false;
        return result;
      }
      activeSync.queued = false;
      if (this._autoSyncOwner === activeSync) this._autoSyncQueued = false;
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      return this.autoSync(options);
    });
  }
  const pullKey = String(workspace.token || workspace.organizationId || "");
  const activePulls = [...(this._workspacePullFlights?.get(pullKey)?.values() || [])]
    .map((flight) => flight.promise);
  if (activePulls.length > 0) {
    return Promise.allSettled(activePulls).then(() => {
      if (!workspaceIsCurrent(this, workspace)) {
        return { ok: false, workspaceChanged: true, code: "WORKSPACE_CHANGED" };
      }
      return this.autoSync(options);
    });
  }
  const activeRepair = this._syncRepairOwner;
  if (activeRepair?.workspaceToken === workspaceToken && activeRepair.promise) {
    return activeRepair.promise;
  }
  if (!workspace.organizationId) {
    return Promise.resolve({ ok: false, error: new Error("No active workspace") });
  }
  const rejectionRecovery = synchronizeRejectedRecovery(this, workspace, options, deferPostCommitRender);
  if (rejectionRecovery) return rejectionRecovery;
  const outboxStatus = this.model?.getMutationOutboxStatus?.();
  if (outboxStatus?.state === "pending" && typeof this.model?.flushMutationOutbox === "function") {
    return this.model.flushMutationOutbox().then(() => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      const settledStatus = this.model?.getMutationOutboxStatus?.();
      if (settledStatus?.trusted !== false) return this.autoSync(options);
      const error = Object.assign(new Error("Mutation outbox durability is pending"), {
        code: settledStatus?.code || "OUTBOX_DURABILITY_PENDING",
      });
      return { ok: false, error, storageDegraded: true };
    }).catch((error) => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      this.updateSyncState?.({
        phase: "storageError",
        message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
      });
      return { ok: false, error, storageDegraded: true };
    });
  }
  if (outboxStatus?.trusted === false) {
    const error = this.model?.getMutationOutboxFailure?.()
      || Object.assign(new Error("Mutation outbox durability is degraded"), {
        code: outboxStatus.code || "OUTBOX_DURABILITY_PENDING",
      });
    this.updateSyncState?.({
      phase: "storageError",
      message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
    });
    return Promise.resolve({ ok: false, error, storageDegraded: true });
  }
  if (
    options.skipDuplicatePlanRepair !== true
    && typeof this.model?.repairPendingDuplicatePlanVersions === "function"
  ) {
    const repair = this.model.repairPendingDuplicatePlanVersions();
    if (repair) {
      const repairOwner = { workspaceToken, promise: null };
      const trackedRepair = Promise.resolve(repair).then(() => {
        if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
        if (this._syncRepairOwner === repairOwner) {
          this._syncRepairOwner = null;
          if (this._syncRepairPromise === trackedRepair) this._syncRepairPromise = null;
        }
        if (deferPostCommitRender) this._deferPostCommitRender = true;
        return this.autoSync({ ...options, skipDuplicatePlanRepair: true });
      }).catch((error) => {
        if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
        this.updateSyncState?.({
          phase: "storageError",
          message: "Không thể sửa hàng đợi đồng bộ cục bộ",
        });
        return { ok: false, error, storageDegraded: true };
      }).finally(() => {
        if (this._syncRepairOwner === repairOwner) {
          this._syncRepairOwner = null;
          if (this._syncRepairPromise === trackedRepair) this._syncRepairPromise = null;
        }
      });
      repairOwner.promise = trackedRepair;
      this._syncRepairOwner = repairOwner;
      this._syncRepairPromise = trackedRepair;
      return trackedRepair;
    }
  }
  const mutationBatch = this.model?.buildMutationSyncPayload?.() || null;
  const preparedOutboxStatus = this.model?.getMutationOutboxStatus?.();
  if (preparedOutboxStatus?.state === "pending" && typeof this.model?.flushMutationOutbox === "function") {
    return this.model.flushMutationOutbox().then(() => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      return this.autoSync(options);
    }).catch((error) => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      this.updateSyncState?.({
        phase: "storageError",
        message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
      });
      return { ok: false, error, storageDegraded: true };
    });
  }
  if (!mutationBatch) {
    const localMutationsPending = Boolean(this.model?.hasPendingMutationOutboxChanges?.());
    this.updateSyncState(localMutationsPending
      ? { phase: "localPending" }
      : { phase: "idle" });
    return Promise.resolve(localMutationsPending
      ? { ok: true, skipped: true, localMutationsPending: true }
      : { ok: true, skipped: true });
  }
  const { payload, snapshot } = mutationBatch;
  if (
    mutationRequiresManagerPersona(payload)
    && String(this.model?.state?.activerole || "").trim().toLowerCase() !== "manager"
  ) {
    this.updateSyncState({
      phase: "localPending",
      online: globalThis.navigator?.onLine !== false,
      message: "Thay đổi quyền đã được lưu trên thiết bị · Chuyển sang vai trò Quản lý để đồng bộ",
    });
    return Promise.resolve({
      ok: true,
      skipped: true,
      localMutationsPending: true,
      requiredActiveRole: "manager",
    });
  }
  this.updateSyncState({ phase: "syncing" });
  if (mutationAffectsDashboard(payload)) payload.includeDashboardSummary = true;
  const request = apiFetch("/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Active-Org": encodeURIComponent(workspace.organizationId),
    },
    body: JSON.stringify(payload),
  }).then((response) => response.json().then((data) => ({
    ok: response.ok,
    status: response.status,
    data,
  }))).then(async ({ ok, status, data }) => {
    if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult({ status, data });
    if (!ok || data.status === "error") {
      return applyFailedPush(this, { status, data, snapshot, workspace });
    }
    return applySuccessfulPush(this, {
      data,
      payload,
      snapshot,
      deferPostCommitRender,
      status,
      workspace,
    });
  }).catch((error) => {
    void reportOutboxFailure({
      workspaceKey: workspace.workspaceKey,
      correlationId: error?.requestId,
    });
    console.error("Automatic sync transport failed; structured diagnostic submitted.");
    if (!workspaceIsCurrent(this, workspace)) {
      return staleWorkspaceResult({ error });
    }
    this.updateSyncState({ phase: "transportError", message: "Không thể kết nối máy chủ" });
    return { ok: false, error, transport: true };
  });
  const syncOwner = {
    workspaceToken,
    promise: null,
    queued: false,
    startupReconciliation: options.startupReconciliation === true,
  };
  const trackedRequest = request.finally(() => {
    if (this._autoSyncOwner === syncOwner) {
      this._autoSyncOwner = null;
      this._autoSyncQueued = false;
    }
  });
  let completion;
  completion = trackedRequest.finally(() => {
    if (this._autoSyncPromise === completion) this._autoSyncPromise = null;
  });
  syncOwner.promise = completion;
  this._autoSyncOwner = syncOwner;
  this._autoSyncPromise = completion;
  return completion;
}
