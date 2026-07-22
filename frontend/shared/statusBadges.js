import { escapeHtml } from "./view_helpers.js";

const PACKAGE_STATUS_PRESENTATION = Object.freeze({
  "Chuẩn bị": ["badge-neutral", "circle-dot"],
  "Đang mời thầu": ["badge-info", "megaphone"],
  "Đã mở thầu": ["badge-opened", "folder-open"],
  "Đang chấm thầu": ["badge-warning", "award"],
  "Đã có kết quả": ["badge-success", "check-circle"],
  "Hủy thầu": ["badge-danger", "x-circle"],
});

export function renderPackageStatusBadge(status) {
  const label = String(status || "").trim() || "Chưa cập nhật";
  const [className = "badge-neutral", icon = "circle-dot"] = PACKAGE_STATUS_PRESENTATION[label] || [];
  return `<span class="badge ${className}"><i data-lucide="${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
}

export function renderCustomStatusBadge(status, catalog = []) {
  const label = String(status || "").trim() || "Chưa cập nhật";
  const configured = Array.isArray(catalog)
    ? catalog.find((item) => String(item?.name || "").trim() === label)
    : null;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(configured?.color || ""))
    ? configured.color
    : "#64748B";
  return `<span class="status-pill" style="background-color: ${color};">${escapeHtml(label)}</span>`;
}
