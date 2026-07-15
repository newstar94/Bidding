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

export function renderNeutralStatusBadge(status) {
  const label = String(status || "").trim() || "Chưa cập nhật";
  return `<span class="badge badge-neutral">${escapeHtml(label)}</span>`;
}
