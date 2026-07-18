const PLAN_METHODS = new Set([
  "editKeHoach",
  "deleteKeHoach",
  "openPlanBreakdownModal",
  "addBreakdownRow",
  "removeBreakdownRow",
  "savePlanBreakdown"
]);

const PACKAGE_METHODS = new Set([
  "editGoiThau",
  "deleteGoiThau",
  "restoreCanceledPackage",
  "addGiaHanRow",
  "validateGiaHanRealtime",
  "moThauGoiThau",
  "phatHanhHsmtGoiThau",
  "enforceSingleLeader",
  "openMoThauJVManager",
  "openMoThauJVViewModal",
  "showNhaThauDetailsAndCloseJV",
  "saveKetQuaChiDinhThau",
  "renderMoThauPanel",
  "renderDanhGiaHsdtPanel"
]);

const PARTNER_METHODS = new Set([
  "editChuDauTu",
  "deleteChuDauTu",
  "editNhaThau",
  "deleteNhaThau",
  "editChuyenGia",
  "deleteChuyenGia",
  "editHopDong",
  "deleteHopDong"
]);

const ROUTE_SCOPES = Object.freeze({
  kehoach: "plan",
  "kehoach-detail": "plan",
  goithau: "package",
  mothau: "package",
  danhgiahsdt: "package",
  "goithau-detail": "package",
  chudautu: "partner",
  "chudautu-detail": "partner",
  nhathau: "partner",
  "nhathau-detail": "partner",
  chuyengia: "partner",
  hopdong: "partner",
  "hopdong-detail": "partner"
});

const ALREADY_LAZY_METHODS = new Set([
  "triggerExcelImport",
  "triggerExcelTemplateDownload",
  "handleExcelUpload",
  "saveExcelImport"
]);

export const WORKFLOW_SCOPES = Object.freeze(["plan", "package", "partner"]);

export function resolveWorkflowScope(request = "all") {
  const normalized = String(request || "all").trim();
  if (!normalized || normalized === "all") return "all";
  if (WORKFLOW_SCOPES.includes(normalized)) return normalized;
  if (ALREADY_LAZY_METHODS.has(normalized)) return null;
  if (PLAN_METHODS.has(normalized)) return "plan";
  if (PACKAGE_METHODS.has(normalized)) return "package";
  if (PARTNER_METHODS.has(normalized)) return "partner";
  return ROUTE_SCOPES[normalized] || "all";
}
