import { escapeHtml } from "../shared/view_helpers.js";

const TONES = Object.freeze({
  success: new Set(["active", "available", "paid", "paid_today", "issued", "completed", "success", "succeeded", "free"]),
  warning: new Set(["pending", "processing", "requested", "retry", "due", "due_in_2_weeks", "due_in_3_weeks"]),
  danger: new Set(["failed", "error", "expired", "cancelled", "canceled", "overdue", "suspended", "revoked"]),
  primary: new Set(["dispatched", "in_progress", "enabled"]),
});

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

export function adminStatusMarkup(value, fallback = "N/A") {
  const raw = String(value ?? "").trim();
  const label = raw || fallback;
  const key = normalizedStatus(raw);
  const tone = Object.entries(TONES).find(([, values]) => values.has(key))?.[0] || "neutral";
  return `<span class="bf-admin-status bf-admin-status-${tone}"><span class="bf-admin-status-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
}
