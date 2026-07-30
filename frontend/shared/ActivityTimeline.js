import { getJson } from "./apiClient.js";
import { trustedHTML } from "./trustedTypes.js";
import { escapeHtml } from "./view_helpers.js";

export const ACTIVITY_LABELS = Object.freeze({
  "goithau.created": "Đã tạo gói thầu",
  "goithau.updated": "Đã cập nhật gói thầu",
  "hopdong.created": "Đã tạo hợp đồng",
  "hopdong.updated": "Đã cập nhật hợp đồng",
  "package_document.uploaded": "Đã tải tài liệu lên",
  "package_document.replaced": "Đã thay thế tài liệu",
  "package_document.deleted": "Đã xóa tài liệu",
  "assignment.added": "Đã thêm người phụ trách",
  "assignment.removed": "Đã gỡ người phụ trách",
});

export function formatActivityTime(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "Không rõ thời gian";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
}

function activityDetail(item) {
  const metadata = item?.metadata || {};
  if (metadata.documentName) return `Tài liệu: ${metadata.documentName}`;
  if (metadata.assigneeName) return `Nhân sự: ${metadata.assigneeName}`;
  if (Array.isArray(metadata.changedFields) && metadata.changedFields.length) {
    return `Trường thay đổi: ${metadata.changedFields.join(", ")}`;
  }
  return "";
}

export function buildActivityTimelineMarkup(items, { hasMore = false } = {}) {
  if (!items?.length) {
    return `<div class="activity-empty"><i data-lucide="history" aria-hidden="true"></i><p>Chưa có lịch sử chỉnh sửa.</p></div>`;
  }
  return `<ol class="activity-timeline-list">
    ${items.map((item) => `<li class="activity-timeline-item">
      <span class="activity-avatar" aria-hidden="true">${escapeHtml(String(item.actorName || "?").trim().charAt(0).toUpperCase() || "?")}</span>
      <div class="activity-copy">
        <p><strong>${escapeHtml(item.actorName || "Không xác định")}</strong> ${escapeHtml(ACTIVITY_LABELS[item.action] || item.action)}</p>
        ${activityDetail(item) ? `<p class="activity-detail">${escapeHtml(activityDetail(item))}</p>` : ""}
        <time datetime="${escapeHtml(item.occurredAt || "")}">${escapeHtml(formatActivityTime(item.occurredAt))}</time>
      </div>
    </li>`).join("")}
  </ol>${hasMore ? '<button type="button" class="btn btn-outline" data-activity-more>Xem thêm</button>' : ""}`;
}

const requestVersions = new WeakMap();

export async function renderActivityTimeline(container, {
  targetType,
  targetId,
  isCurrent = () => true,
} = {}) {
  if (!container) return;
  const requestVersion = (requestVersions.get(container) || 0) + 1;
  requestVersions.set(container, requestVersion);
  let items = [];
  let cursor = null;

  const load = async ({ append = false } = {}) => {
    if (!append) {
      container.innerHTML = trustedHTML('<div class="activity-loading" role="status"><span class="loading-spinner" aria-hidden="true"></span> Đang tải lịch sử chỉnh sửa...</div>');
    }
    const query = new URLSearchParams({ limit: "30" });
    if (cursor?.beforeOccurredAt && cursor?.beforeId) {
      query.set("beforeOccurredAt", cursor.beforeOccurredAt);
      query.set("beforeId", cursor.beforeId);
    }
    try {
      const data = await getJson(
        `/api/activities/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}?${query}`,
        { retries: 0 },
      );
      if (requestVersions.get(container) !== requestVersion || !isCurrent()) return;
      items = append ? [...items, ...(data.items || [])] : (data.items || []);
      cursor = data.nextCursor || null;
      container.innerHTML = trustedHTML(buildActivityTimelineMarkup(items, { hasMore: Boolean(cursor) }));
      container.querySelector("[data-activity-more]")?.addEventListener("click", () => load({ append: true }));
      globalThis.lucide?.createIcons?.({ root: container });
    } catch (error) {
      if (requestVersions.get(container) !== requestVersion || !isCurrent()) return;
      container.innerHTML = trustedHTML(`<div class="activity-error" role="alert"><p>${escapeHtml(error?.message || "Không tải được lịch sử chỉnh sửa.")}</p><button type="button" class="btn btn-outline" data-activity-retry>Thử lại</button></div>`);
      container.querySelector("[data-activity-retry]")?.addEventListener("click", () => load());
    }
  };

  await load();
}
