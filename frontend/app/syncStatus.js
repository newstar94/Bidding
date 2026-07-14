export function summarizeMutationQueue(queue = {}) {
  const upserts = Object.values(queue.upserts || {}).reduce(
    (total, records) => total + Object.keys(records || {}).length,
    0
  );
  const deletions = Array.isArray(queue.deletes) ? queue.deletes.length : 0;
  return { upserts, deletions, pendingCount: upserts + deletions };
}

export function deriveSyncStatus({
  phase = "idle",
  online = true,
  pendingCount = 0,
  lastSyncedAt = null,
  message = ""
} = {}) {
  if (!online) {
    return { state: "offline", label: pendingCount ? `Ngoại tuyến · ${pendingCount} chờ` : "Ngoại tuyến", assertive: true };
  }
  if (phase === "conflict") {
    return { state: "conflict", label: pendingCount ? `Xung đột · ${pendingCount} chờ` : "Xung đột dữ liệu", assertive: true };
  }
  if (phase === "error") {
    return { state: "error", label: message || (pendingCount ? `Lỗi · ${pendingCount} chờ` : "Lỗi đồng bộ"), assertive: true };
  }
  if (phase === "syncing") {
    return { state: "syncing", label: pendingCount ? `Đang đồng bộ ${pendingCount} thay đổi` : "Đang tải dữ liệu", assertive: false };
  }
  if (pendingCount > 0) {
    return { state: "pending", label: `${pendingCount} thay đổi chờ đồng bộ`, assertive: false };
  }
  if (lastSyncedAt) {
    const time = new Date(lastSyncedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    return { state: "synced", label: `Đã đồng bộ lúc ${time}`, assertive: false };
  }
  return { state: "local", label: "Dữ liệu cục bộ", assertive: false };
}

export function renderSyncStatus(element, input = {}) {
  if (!element) return null;
  const status = deriveSyncStatus(input);
  element.dataset.syncState = status.state;
  element.setAttribute("aria-live", status.assertive ? "assertive" : "polite");
  element.setAttribute("aria-label", `${status.label}. Nhấn để đồng bộ hoặc xử lý lỗi.`);
  const label = element.querySelector?.("[data-sync-label]");
  const count = element.querySelector?.("[data-sync-count]");
  if (label) label.textContent = status.label;
  else element.textContent = status.label;
  if (count) {
    count.textContent = String(input.pendingCount || 0);
    count.hidden = !input.pendingCount;
  }
  return status;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildConflictDiff(queue = {}, responseData = {}) {
  const lines = [];
  for (const error of responseData.errors || []) {
    const type = error.table || "unknown";
    const id = String(error.id || "");
    const local = queue.upserts?.[type]?.[id] || {};
    const server = error.serverRecord || {};
    const changedFields = new Set([...Object.keys(local), ...Object.keys(server)]);
    const differences = [...changedFields]
      .filter((field) => !["syncVersion", "updatedAt", "createdAt"].includes(field))
      .filter((field) => JSON.stringify(local[field]) !== JSON.stringify(server[field]));
    lines.push(`[${type}/${id || "?"}] ${error.message || "Dữ liệu đã thay đổi trên máy chủ."}`);
    differences.slice(0, 8).forEach((field) => {
      lines.push(`  • ${field}: máy này=${displayValue(local[field])} | máy chủ=${displayValue(server[field])}`);
    });
  }
  if (lines.length === 0) {
    const localVersion = queue.baseSyncVersion ?? "?";
    const serverVersion = responseData.currentSyncVersion ?? responseData.syncVersion ?? "?";
    lines.push(`Phiên dữ liệu máy này: ${localVersion}; máy chủ: ${serverVersion}.`);
    lines.push("Có thay đổi cục bộ chưa được gửi; hãy chọn giữ bản máy này hoặc dùng bản máy chủ.");
  }
  return lines;
}
