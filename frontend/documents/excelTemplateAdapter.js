import { authFetchDownload } from "../shared/workflow_helpers.js";
import { getActiveEvaluationLotScope } from "../packages/lotEvaluationScope.js";
export function triggerExcelTemplateDownload(controller, type) {
  controller._excelImportType = type;
  if (type === "mothau") {
    return downloadOpeningTemplate(controller);
  }
  if (type === "danhgiahsdt") {
    return downloadEvaluationTemplate(controller);
  }
  if (type === "ketquaqd") {
    return downloadAwardResultTemplate(controller);
  }
  if (type === "opening_fin") {
    return downloadFinancialOpeningTemplate(controller);
  }
  return authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);
}
function downloadOpeningTemplate(controller) {
  const select = document.getElementById("mothau-goithau-select") || document.getElementById("danhgiahsdt-goithau-select");
  const gtId = select ? select.value : "";
  const gt = requirePackage(controller, gtId, "Vui lòng chọn gói thầu trước khi tải file mẫu!");
  if (!gt) return;
  const isTuVan = gt.linhVuc === "Tư vấn";
  const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const is1G1T = gt.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
  const hasPhanLo = gt.phanLo === "Có";
  let caseType = "1G1T_NO_LOT";
  if (isTuVan) caseType = "TU_VAN";
  else if (!isTuVan && is1G2T) caseType = hasPhanLo ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
  else if (is1G1T) caseType = hasPhanLo ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
  const safeCode = getSafePackageCode(gt);
  const lotCodes = (gt.phanLoList || []).map((l) => l.maPhanLo).join(",");
  return authFetchDownload(`/api/export-mothau-template?case_type=${caseType}&package_name=${encodeURIComponent(safeCode)}&lot_codes=${encodeURIComponent(lotCodes)}`, `Mau_Mo_Thau_${caseType}_${safeCode}.xlsx`);
}
function downloadEvaluationTemplate(controller) {
  const select = document.getElementById("danhgiahsdt-goithau-select");
  const gtId = select ? select.value : "";
  const gt = requirePackage(controller, gtId, "Vui lòng chọn gói thầu trước khi tải file mẫu!");
  if (!gt) return;
  const safeCode = getSafePackageCode(gt);
  const lotScope = getActiveEvaluationLotScope(controller, gt);
  const lotCodes = lotScope?.lotCodes || [];
  const scopeQuery = lotCodes.length
    ? `&lot_codes=${encodeURIComponent(lotCodes.join(","))}`
    : "";
  return authFetchDownload(`/api/export-danhgiahsdt-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}&eval_type=${controller.currentDanhGiaTab || "technical"}${scopeQuery}`, `DanhGia_HSDT_${safeCode}.xlsx`);
}
function downloadAwardResultTemplate(controller) {
  const select = document.getElementById("result-goithau-select") || document.getElementById("danhgiahsdt-goithau-select") || document.getElementById("mothau-goithau-select");
  const gtId = select ? select.value : controller._currentResultPackageId;
  const gt = requirePackage(controller, gtId, "Không tìm thấy thông tin gói thầu hiện tại!");
  if (!gt) return;
  const safeCode = getSafePackageCode(gt);
  return authFetchDownload(`/api/export-ketquaqd-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `KetQua_QD_${safeCode}.xlsx`);
}
function downloadFinancialOpeningTemplate(controller) {
  const select = document.getElementById("mothau-goithau-select") || document.getElementById("danhgiahsdt-goithau-select");
  const gtId = select ? select.value : controller._currentPackageId || "";
  const gt = requirePackage(controller, gtId, "Không tìm thấy thông tin gói thầu hiện tại!");
  if (!gt) return;
  const safeCode = getSafePackageCode(gt);
  return authFetchDownload(`/api/export-opening-fin-template?package_id=${gtId}&package_name=${encodeURIComponent(safeCode)}`, `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`);
}
function requirePackage(controller, gtId, message) {
  if (!gtId) {
    const select = document.getElementById("result-goithau-select")
      || document.getElementById("danhgiahsdt-goithau-select")
      || document.getElementById("mothau-goithau-select");
    controller.view.customAlert("Chưa chọn Gói thầu", message, "alert-triangle", select);
    return null;
  }
  return controller.model.state.goithau.find((g) => String(g.id) === String(gtId)) || null;
}
function getSafePackageCode(gt) {
  return (gt.maGoiThau || "GoiThau").replace(/[^a-zA-Z0-9_-]/g, "").trim().substring(0, 30);
}
