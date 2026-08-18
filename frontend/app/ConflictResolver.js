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

export async function resolveRowVersionConflicts(controller, { data, snapshot }) {
  const conflictErrors = getSyncValidationErrors(data).filter(
    (error) => error?.code === "ROW_VERSION_CONFLICT"
  );
  if (conflictErrors.length === 0) return { resolved: false };
  const labels = conflictErrors.slice(0, 3).map(syncConflictLabel).join("; ");
  const suffix = conflictErrors.length > 3
    ? `; và ${conflictErrors.length - 3} bản ghi khác`
    : "";
  controller.view?.showToast?.(
    "Xung đột dữ liệu",
    `Đã giữ thay đổi cục bộ bị xung đột của: ${labels}${suffix}. Vui lòng thử đồng bộ lại để đối chiếu trước khi quyết định bỏ thay đổi.`,
    "warning",
  );
  return {
    resolved: false,
    choice: null,
    automatic: false,
    conflicts: conflictErrors.length,
    snapshot,
  };
}
