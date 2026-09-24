import { escapeHtml } from "../shared/view_helpers.js";

const TONES = Object.freeze({
  success: new Set(["active", "available", "healthy", "ready", "paid", "paid_today", "issued", "completed", "success", "succeeded", "free"]),
  warning: new Set(["degraded", "pending", "processing", "requested", "retry", "due", "due_in_2_weeks", "due_in_3_weeks"]),
  danger: new Set(["unavailable", "incompatible", "dead_letter", "failed", "error", "expired", "cancelled", "canceled", "overdue", "suspended", "revoked"]),
  primary: new Set(["dispatched", "in_progress", "enabled"]),
});

const LABELS = Object.freeze({
  active: "Hoạt động", available: "Khả dụng", healthy: "Khỏe mạnh", ready: "Sẵn sàng",
  paid: "Đã thanh toán", paid_today: "Đã thanh toán hôm nay", issued: "Đã phát hành",
  completed: "Hoàn thành", success: "Thành công", succeeded: "Thành công", free: "Miễn phí",
  pending: "Đang chờ", processing: "Đang xử lý", requested: "Đã yêu cầu", retry: "Chờ thử lại",
  due: "Sắp đến hạn", due_in_2_weeks: "Đến hạn trong 2 tuần", due_in_3_weeks: "Đến hạn trong 3 tuần",
  inactive: "Không hoạt động", incompatible: "Không tương thích", degraded: "Suy giảm", unavailable: "Không khả dụng", unknown: "Chưa xác định",
  failed: "Thất bại", error: "Lỗi", expired: "Hết hạn", cancelled: "Đã hủy", canceled: "Đã hủy",
  overdue: "Quá hạn", suspended: "Tạm khóa", revoked: "Đã thu hồi", dispatched: "Đã phát",
  dead_letter: "Lỗi vĩnh viễn", in_progress: "Đang thực hiện", enabled: "Đã bật",
});

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function adminStatusLabel(value, fallback = "N/A") {
  const raw = String(value ?? "").trim();
  return LABELS[normalizedStatus(raw)] || raw || fallback;
}

export function adminStatusMarkup(value, fallback = "N/A") {
  const raw = String(value ?? "").trim();
  const label = adminStatusLabel(raw, fallback);
  const key = normalizedStatus(raw);
  const tone = Object.entries(TONES).find(([, values]) => values.has(key))?.[0] || "neutral";
  return `<span class="bf-admin-status bf-admin-status-${tone}"><span class="bf-admin-status-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
}
