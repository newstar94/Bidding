import { escapeHtml } from "./view_helpers.js";
import {
  PACKAGE_STATUS_PRESENTATION,
  resolveContractStatusColor,
} from "./statusPresentation.js";

export function renderPackageStatusBadge(status) {
  const label = String(status || "").trim() || "Chưa cập nhật";
  const {
    className = "badge-status-neutral",
    icon = "circle-dot",
    color = "#64748B",
  } = (
    PACKAGE_STATUS_PRESENTATION[label] || {}
  );
  return `<span class="badge ${className}" style="--status-color: ${color};"><i data-lucide="${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
}

export function renderCustomStatusBadge(status, catalog = []) {
  const label = String(status || "").trim() || "Chưa cập nhật";
  const color = resolveContractStatusColor(label, catalog);
  return `<span class="badge status-pill" style="--status-color: ${color};">${escapeHtml(label)}</span>`;
}
