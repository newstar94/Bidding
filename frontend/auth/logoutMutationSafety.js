function mutationRecordCount(upserts) {
  return Object.values(upserts || {}).reduce(
    (total, records) => total + Object.keys(records || {}).length,
    0,
  );
}

export function countPendingMutations(queue = {}) {
  const dirtyTables = Object.values(queue.dirtyTables || {})
    .filter(Boolean).length;
  const upserts = mutationRecordCount(queue.upserts);
  const deletes = Array.isArray(queue.deletes) ? queue.deletes.length : 0;
  return dirtyTables + upserts + deletes;
}

function syncFailureReason(result, error) {
  if (error?.message) return error.message;
  return String(
    result?.error?.message
    || result?.error?.code
    || result?.code
    || "Đồng bộ cuối cùng chưa hoàn tất.",
  );
}

export async function prepareExplicitLogout(controller) {
  let result = { ok: true, skipped: true };
  let syncError = null;
  if (typeof controller?.autoSync === "function") {
    try {
      result = await controller.autoSync();
    } catch (error) {
      syncError = error;
      result = { ok: false };
    }
  }
  if (result?.ok === true) {
    return { discardConfirmed: false, proceed: true };
  }

  const queue = controller?.model?.getMutationQueue?.() || {};
  const pendingCount = countPendingMutations(queue);
  if (pendingCount === 0) {
    return { discardConfirmed: false, proceed: true };
  }

  const reason = syncFailureReason(result, syncError);
  const discardConfirmed = Boolean(await controller?.view?.customConfirm?.(
    "Chưa thể đồng bộ trước khi đăng xuất",
    `Còn ${pendingCount} thay đổi chưa được gửi lên máy chủ. Lý do: ${reason}\n\n`
      + "Chọn \"Bỏ dữ liệu và đăng xuất\" để xóa vĩnh viễn các thay đổi này, "
      + "hoặc Hủy để quay lại và thử đồng bộ.",
    "alert-triangle",
    {
      confirmLabel: "Bỏ dữ liệu và đăng xuất",
      cancelLabel: "Hủy đăng xuất",
    },
  ));
  if (!discardConfirmed) {
    return { pendingCount, proceed: false, reason };
  }

  controller.model?.discardMutationBatch?.();
  await controller.model?.flushMutationOutbox?.();
  return {
    discardConfirmed: true,
    pendingCount,
    proceed: true,
  };
}

export async function quarantineForcedSession(controller) {
  controller?.disconnectWebSocket?.(false);
  try {
    await controller?.model?.flushMutationOutbox?.();
  } catch {
    // Existing durable replicas remain scoped to the previous user/workspace.
  }
  await controller?.model?.deactivateWorkspace?.();
  controller?.model?.clearSessionData?.();
}
