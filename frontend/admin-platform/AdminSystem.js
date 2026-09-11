import { renderAdminDirectory } from "./AdminDirectory.js";
import { escapeHtml } from "../shared/view_helpers.js";

function text(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  return escapeHtml(normalized || fallback);
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const source = typeof value === "number" ? value * 1_000 : value;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? text(value) : escapeHtml(date.toLocaleString("vi-VN"));
}

function progressMarkup(progress) {
  const completed = Number(progress?.completedItems);
  const total = Number(progress?.totalItems);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total < 1) return "N/A";
  return `<strong>${escapeHtml(completed)}/${escapeHtml(total)}</strong><div class="small text-secondary">${text(progress?.phase)}</div>`;
}

function summaryCards(items) {
  return `<div class="row row-cards mb-3">${items.map(([key, label, value]) => `<div class="col-sm-6 col-xl-3"><article class="card h-100"><div class="card-body"><div class="text-secondary">${escapeHtml(label)}</div><div class="h2 mb-0 mt-2" data-admin-system-metric="${escapeHtml(key)}">${Number.isFinite(value) ? escapeHtml(new Intl.NumberFormat("vi-VN").format(value)) : "N/A"}</div></div></article></div>`).join("")}</div>`;
}

export function jobSummaryMarkup(summary) {
  const byStatus = summary?.byStatus && typeof summary.byStatus === "object" ? summary.byStatus : {};
  return summaryCards([
    ["jobs-total", "Tổng tác vụ", summary?.total],
    ["jobs-pending", "Đang chờ", byStatus.pending],
    ["jobs-processing", "Đang xử lý", byStatus.processing],
    ["jobs-failed", "Thất bại", byStatus.failed],
  ]);
}

export function syncSummaryMarkup(summary) {
  const byStatus = summary?.eventsByStatus && typeof summary.eventsByStatus === "object"
    ? summary.eventsByStatus
    : {};
  return `${summaryCards([
    ["sync-events", "Tổng sự kiện", summary?.eventsTotal],
    ["sync-failed", "Sự kiện lỗi", (byStatus.retry || 0) + (byStatus.dead_letter || 0)],
    ["sync-connections", "Kết nối hoạt động", summary?.activeConnections],
    ["sync-mutations", "Mutation đã ghi nhận", summary?.recordedMutations],
    ["sync-row-conflicts", "Xung đột phiên bản", summary?.rowVersionConflicts],
    ["sync-visibility-resets", "Thu hồi hiển thị", summary?.visibilityResets],
    ["sync-full-resets", "Đồng bộ toàn phần", summary?.fullSyncs],
    ["sync-outbox-failures", "Lỗi outbox", summary?.outboxFailures],
  ])}<p class="text-secondary small">Các chỉ số không được hệ thống lưu có thẩm quyền hiển thị N/A; không suy diễn từ log hoặc dữ liệu riêng tư.</p>`;
}

export const JOB_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/system/jobs",
  title: "Tác vụ",
  searchPlaceholder: "Lọc theo loại tác vụ",
  searchQueryKey: "operation",
  emptyMessage: "Không có tác vụ phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "updated_at", "available_at", "status", "attempt_count"],
  summaryMarkup: jobSummaryMarkup,
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["pending", "Đang chờ"], ["processing", "Đang xử lý"], ["retry", "Chờ thử lại"], ["completed", "Hoàn thành"], ["failed", "Thất bại"]] },
  ],
  columns: [
    { label: "Tác vụ" }, { label: "Tổ chức" },
    { label: "Trạng thái", sortKey: "status" }, { label: "Tiến độ" },
    { label: "Lần thử", sortKey: "attempt_count" }, { label: "Lỗi cuối" },
    { label: "Cập nhật", sortKey: "updated_at" },
  ],
  rowMarkup(job) {
    return `<tr><td data-label="Tác vụ"><strong>${text(job?.operation)}</strong><div class="small text-secondary">${text(job?.id)} · ${text(job?.recordType)}</div></td><td data-label="Tổ chức">${text(job?.organizationId)}</td><td data-label="Trạng thái">${text(job?.status)}</td><td data-label="Tiến độ">${progressMarkup(job?.progress)}</td><td data-label="Lần thử">${Number.isFinite(job?.attemptCount) ? escapeHtml(job.attemptCount) : "N/A"}</td><td data-label="Lỗi cuối">${text(job?.lastErrorCode)}</td><td data-label="Cập nhật">${formatDate(job?.updatedAt)}</td></tr>`;
  },
});

export const SYNC_DIRECTORY = Object.freeze({
  endpoint: "/api/admin/system/sync",
  title: "Đồng bộ",
  searchPlaceholder: "",
  hideSearch: true,
  emptyMessage: "Không có sự kiện đồng bộ phù hợp với bộ lọc.",
  defaultSort: "created_at",
  defaultSortDir: "desc",
  sortKeys: ["created_at", "available_at", "status", "attempt_count"],
  summaryMarkup: syncSummaryMarkup,
  filters: [
    { key: "status", label: "Trạng thái", allLabel: "Mọi trạng thái", options: [["pending", "Đang chờ"], ["retry", "Chờ thử lại"], ["dispatched", "Đã phát"], ["dead_letter", "Lỗi vĩnh viễn"]] },
    { key: "eventType", label: "Loại sự kiện", allLabel: "Mọi sự kiện", options: [["broadcast", "Phát tới tổ chức"], ["revoke_user", "Thu hồi người dùng"]] },
  ],
  columns: [
    { label: "Sự kiện" }, { label: "Tổ chức" },
    { label: "Trạng thái", sortKey: "status" },
    { label: "Lần thử", sortKey: "attempt_count" },
    { label: "Sẵn sàng", sortKey: "available_at" },
    { label: "Đã phát" }, { label: "Lỗi cuối" },
  ],
  rowMarkup(event) {
    return `<tr><td data-label="Sự kiện"><strong>${text(event?.eventType)}</strong><div class="small text-secondary">#${text(event?.id)}</div></td><td data-label="Tổ chức">${text(event?.organizationId)}</td><td data-label="Trạng thái">${text(event?.status)}</td><td data-label="Lần thử">${Number.isFinite(event?.attemptCount) ? escapeHtml(event.attemptCount) : "N/A"}</td><td data-label="Sẵn sàng">${formatDate(event?.availableAt)}</td><td data-label="Đã phát">${formatDate(event?.dispatchedAt)}</td><td data-label="Lỗi cuối">${text(event?.lastErrorCode)}</td></tr>`;
  },
});

export function renderAdminSystemJobs(container, options) {
  return renderAdminDirectory(container, JOB_DIRECTORY, options);
}

export function renderAdminSystemSync(container, options) {
  return renderAdminDirectory(container, SYNC_DIRECTORY, options);
}
