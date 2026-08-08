import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";

export function isDirectOrSpecialPackage(gt) {
  return gt?.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt?.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
}
export function isNextEvaluationStepSaved(gt) {
  const is1G2T = gt?.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  if (!gt?.danhGiaHsdtMetadata) return false;
  const parsed = parseEvaluationMetadataForDisplay(gt.danhGiaHsdtMetadata).metadata;
  return is1G2T ? !!(parsed.is1G2T && parsed.technical && parsed.technical.saved) : !!parsed.saved;
}
export function canSaveOpeningInfo(gt) {
  if (!gt) return false;
  if (isDirectOrSpecialPackage(gt)) {
    return gt.trangThai !== "Đã có kết quả";
  }
  const isNextStepSaved = isNextEvaluationStepSaved(gt);
  return gt.trangThai === "Đang mời thầu" || gt.trangThai === "Đã mở thầu" || gt.trangThai === "Đang chấm thầu" && !isNextStepSaved;
}
export function validateOpeningTime(gt, formatDeadline) {
  if (!gt?.thoiGianDongThau || !gt?.thoiGianMoThau) {
    return { valid: true, message: "" };
  }
  const dongThauDate = new Date(gt.thoiGianDongThau);
  const moThauDate = new Date(gt.thoiGianMoThau);
  const isInvalid = !isNaN(dongThauDate.getTime()) && !isNaN(moThauDate.getTime()) && moThauDate < dongThauDate;
  if (!isInvalid) {
    return { valid: true, message: "" };
  }
  const deadline = typeof formatDeadline === "function" ? formatDeadline(gt.thoiGianDongThau) : gt.thoiGianDongThau;
  return {
    valid: false,
    message: `Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu (${deadline})!`
  };
}
export function getAwardRequiredFieldIds({ isDirectOrSpecial = false, danhGiaNangLucVal = "Không", hasField = () => false } = {}) {
  const fields = ["award-decision-no", "award-decision-date"];
  if (hasField("award-so-bctd")) fields.push("award-so-bctd");
  if (hasField("award-ngay-bctd")) fields.push("award-ngay-bctd");
  if (isDirectOrSpecial) {
    fields.push("date-yeu-cau-bao-gia", "date-gui-bao-gia");
    if (danhGiaNangLucVal === "Có") {
      fields.push("date-bao-cao-danh-gia");
    }
    fields.push("date-moi-thuong-thao", "date-thuong-thao", "date-trinh-ket-qua");
  }
  return fields;
}
