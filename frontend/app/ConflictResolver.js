import { renderChangedState } from "./SyncRenderCoordinator.js";


export function getSyncValidationErrors(data) {
  if (Array.isArray(data?.errors)) return data.errors;
  if (Array.isArray(data?.fields?.errors)) return data.fields.errors;
  return [];
}

function syncConflictLabel(error) {
  const record = error?.serverRecord || {};
  const code = record.maKeHoach || record.maGoiThau || record.maHopDong || record.maNhaThau || record.maChuDauTu || "";
  const name = record.tenKeHoach || record.tenGoiThau || record.tenHopDong || record.tenNhaThau || record.tenChuDauTu || "";
  return [code, name].filter(Boolean).join(" — ") || String(error?.id || "Bản ghi không xác định");
}

async function restoreRejectedSyncRecords(controller, rejectedRecords) {
  const changedKeys = new Set();
  for (const rejected of rejectedRecords) {
    let serverRecord = null;
    try {
      serverRecord = await controller.fetchRecordByLookup(
        rejected.type,
        rejected.conflictingId || rejected.id,
      );
    } catch (error) {
      console.error("Failed to restore conflicted server record:", error);
    }
    if (Array.isArray(controller.model.state[rejected.type]) && (!serverRecord || String(serverRecord.id) !== rejected.id)) {
      const records = controller.model.state[rejected.type];
      records.splice(0, records.length, ...records.filter(
        (item) => String(item.id) !== rejected.id
      ));
      await controller.model.db?.deleteRecord?.(rejected.type, rejected.id);
    }
    changedKeys.add(rejected.type);
  }
  if (changedKeys.size > 0) {
    await renderChangedState(controller, changedKeys, { isBackground: true });
  }
  return changedKeys;
}

export async function resolveRowVersionConflicts(controller, { data, snapshot }) {
  const conflictErrors = getSyncValidationErrors(data).filter(
    (error) => error?.code === "ROW_VERSION_CONFLICT"
  );
  if (conflictErrors.length === 0) return { resolved: false };
  const labels = conflictErrors.slice(0, 3).map(syncConflictLabel).join("; ");
  const suffix = conflictErrors.length > 3
    ? `; và ${conflictErrors.length - 3} bản ghi khác`
    : "";
  const rejected = controller.model?.discardRejectedMutations?.(
    conflictErrors,
    snapshot,
  ) || [];
  await restoreRejectedSyncRecords(controller, rejected);
  controller.view?.showToast?.(
    "Đã dùng dữ liệu server",
    `Đã bỏ thay đổi local bị xung đột của: ${labels}${suffix}.`,
    "info",
  );
  return {
    resolved: rejected.length === conflictErrors.length,
    choice: "server",
    automatic: true,
  };
}
