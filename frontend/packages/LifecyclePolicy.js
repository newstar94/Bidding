const CONTRACT = Object.freeze({
  version: 2,
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
  transitions: Object.freeze({
    UNKNOWN: Object.freeze(["CANCELLED", "PREPARING"]),
    PREPARING: Object.freeze(["CANCELLED", "INVITED"]),
    INVITED: Object.freeze(["CANCELLED", "OPENED"]),
    OPENED: Object.freeze(["CANCELLED", "EVALUATING"]),
    EVALUATING: Object.freeze(["AWARDED", "CANCELLED", "PARTIALLY_AWARDED"]),
    PARTIALLY_AWARDED: Object.freeze(["AWARDED", "CANCELLED", "EVALUATING"]),
    AWARDED: Object.freeze(["CANCELLED", "EVALUATING", "PARTIALLY_AWARDED"]),
    CANCELLED: Object.freeze(["AWARDED", "EVALUATING", "INVITED", "OPENED", "PARTIALLY_AWARDED", "PREPARING"]),
  }),
  lockedAfterInvitation: Object.freeze([
    "giaGoiThau", "hinhThucLuaChon", "keHoachId", "linhVuc", "loaiHopDong",
    "maGoiThau", "nguonVon", "phanLo", "phuongPhapDanhGia",
    "phuongThucLuaChon", "quaMang", "tenGoiThau", "trongNuocQuocTe",
    "tuyChonMuaThem",
  ]),
});

export function lifecycleContract() {
  return structuredClone(CONTRACT);
}

export function normalizeStatus(value) {
  const text = String(value || "").trim();
  return Object.hasOwn(CONTRACT.statuses, text) ? text : (CONTRACT.aliases[text] || "PREPARING");
}

export function allowedTransitions(status) {
  return [...(CONTRACT.transitions[normalizeStatus(status)] || [])];
}

export function fieldPolicy(status, packageType) {
  const code = normalizeStatus(status);
  const editable = code === "UNKNOWN" || code === "PREPARING";
  return {
    editable,
    required: packageType === "goods" ? ["linhVuc", "giaGoiThau"] : ["giaGoiThau"],
    visible: [...CONTRACT.lockedAfterInvitation],
  };
}

export function workflowStep(status, method, lotState) {
  const code = normalizeStatus(status);
  if (code === "UNKNOWN" || code === "PREPARING") return "preparation";
  if (code === "INVITED") return "invitation";
  if (code === "OPENED") return "opening";
  if (code === "EVALUATING" || code === "PARTIALLY_AWARDED") return "evaluation";
  if (code === "AWARDED") return "result";
  if (code === "CANCELLED") return "cancelled";
  void method;
  void lotState;
  return "preparation";
}

export function presentStatus(status) {
  return { ...CONTRACT.statuses[normalizeStatus(status)] };
}
