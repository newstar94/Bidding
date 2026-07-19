const TOAST_TYPES = new Set(["success", "error", "warning"]);

const TOAST_TITLES = Object.freeze({
  success: "Thành công",
  error: "Thất bại",
  warning: "Cảnh báo"
});

const DEFAULT_MESSAGES = Object.freeze({
  success: "Thao tác đã hoàn tất.",
  error: "Thao tác không thành công. Vui lòng thử lại.",
  warning: "Vui lòng kiểm tra lại thông tin."
});

/**
 * Keep transient feedback user-facing and consistent. Technical details stay
 * in diagnostics; the toast only states the outcome and the useful next step.
 */
export function normalizeToastFeedback(message, type = "warning") {
  const normalizedType = TOAST_TYPES.has(String(type)) ? String(type) : "warning";
  const normalizedMessage = String(message || "").replace(/\s+/g, " ").trim();
  return {
    title: TOAST_TITLES[normalizedType],
    message: normalizedMessage || DEFAULT_MESSAGES[normalizedType],
    type: normalizedType
  };
}
