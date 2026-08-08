export function deriveSyncStatus({
  phase = "idle",
  online = true,
  lastSyncedAt = null,
  message = ""
} = {}) {
  if (!online) {
    return { state: "offline", label: "Ngoại tuyến", assertive: true };
  }
  if (phase === "conflict") {
    return { state: "conflict", label: "Xung đột dữ liệu", assertive: true };
  }
  if (phase === "validationRejected") {
    return { state: "validation-rejected", label: message || "Dữ liệu chưa hợp lệ", assertive: true };
  }
  if (phase === "transportError") {
    return { state: "transport-error", label: message || "Mất kết nối máy chủ", assertive: true };
  }
  if (phase === "error") {
    return { state: "error", label: message || "Lỗi đồng bộ", assertive: true };
  }
  if (phase === "syncing") {
    return { state: "syncing", label: "Đang đồng bộ", assertive: false };
  }
  if (phase === "localPending") {
    return { state: "local-pending", label: "Đã lưu cục bộ · Chờ đồng bộ", assertive: false };
  }
  if (lastSyncedAt) {
    const time = new Date(lastSyncedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    return { state: "server-saved", label: `Đã lưu máy chủ lúc ${time}`, assertive: false };
  }
  return { state: "local", label: "Dữ liệu cục bộ", assertive: false };
}

export function renderSyncStatus(element, input = {}) {
  if (!element) return null;
  const status = deriveSyncStatus(input);
  element.dataset.syncState = status.state;
  element.hidden = ["server-saved", "local", "syncing"].includes(status.state);
  element.setAttribute("aria-live", status.assertive ? "assertive" : "polite");
  element.setAttribute("aria-label", `${status.label}. Nhấn để đồng bộ hoặc xử lý lỗi.`);
  const label = element.querySelector?.("[data-sync-label]");
  if (label) label.textContent = status.label;
  else element.textContent = status.label;
  return status;
}
