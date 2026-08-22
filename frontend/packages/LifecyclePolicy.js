const CONTRACT = Object.freeze({
  statuses: Object.freeze({
    UNKNOWN: Object.freeze({ label: "Chưa xác định", tone: "neutral", icon: "circle-help" }),
    PREPARING: Object.freeze({ label: "Chuẩn bị", tone: "neutral", icon: "clipboard-list" }),
    INVITED: Object.freeze({ label: "Đang mời thầu", tone: "info", icon: "send" }),
    OPENED: Object.freeze({ label: "Đã mở thầu", tone: "warning", icon: "folder-open" }),
    EVALUATING: Object.freeze({ label: "Đang chấm thầu", tone: "info", icon: "scale" }),
    PARTIALLY_AWARDED: Object.freeze({ label: "Đã có kết quả một phần", tone: "success", icon: "award" }),
    AWARDED: Object.freeze({ label: "Đã có kết quả", tone: "success", icon: "circle-check" }),
    CANCELLED: Object.freeze({ label: "Hủy thầu", tone: "danger", icon: "circle-x" }),
  }),
  aliases: Object.freeze({
    "Chưa xác định": "UNKNOWN",
    "Chuẩn bị": "PREPARING",
    "Đang mời thầu": "INVITED",
    "Đã mở thầu": "OPENED",
    "Đang chấm thầu": "EVALUATING",
    "Đã có kết quả một phần": "PARTIALLY_AWARDED",
    "Đã có kết quả": "AWARDED",
    "Hủy thầu": "CANCELLED",
    "Huỷ thầu": "CANCELLED",
  }),
});

export function normalizeStatus(value) {
  const text = String(value || "").trim();
  return Object.hasOwn(CONTRACT.statuses, text) ? text : (CONTRACT.aliases[text] || "PREPARING");
}

export function presentStatus(status) {
  return { ...CONTRACT.statuses[normalizeStatus(status)] };
}
