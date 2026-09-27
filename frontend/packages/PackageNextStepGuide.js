const STATUS_LABELS = Object.freeze({
  PREPARING: "Chuẩn bị",
  INVITED: "Đang mời thầu",
  OPENED: "Đã mở thầu",
  EVALUATING: "Đang chấm thầu",
  AWARDED: "Đã có kết quả",
  PARTIALLY_AWARDED: "Đã có kết quả một phần",
  CANCELLED: "Hủy thầu",
});

const TWO_ENVELOPE_METHOD = "Một giai đoạn hai túi hồ sơ";

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * Derive presentation-only guidance from fields already present on a package.
 * This does not add a business rule, mutate data, or turn a warning into a block.
 */
export function derivePackageNextStepGuide(pkg = {}) {
  const rawStatus = String(pkg.effectiveStatus || pkg.trangThai || "").trim();
  const normalizedStatus = rawStatus.toUpperCase();
  const statusCode = STATUS_LABELS[normalizedStatus]
    ? normalizedStatus
    : ({
      "ĐANG MỜI THẦU": "INVITED",
      "ĐÃ MỞ THẦU": "OPENED",
      "ĐANG CHẤM THẦU": "EVALUATING",
      "ĐÃ CÓ KẾT QUẢ": "AWARDED",
      "ĐÃ CÓ KẾT QUẢ MỘT PHẦN": "PARTIALLY_AWARDED",
      "CHUẨN BỊ": "PREPARING",
      "HỦY THẦU": "CANCELLED",
    }[normalizedStatus] || normalizedStatus);
  const status = STATUS_LABELS[statusCode] || rawStatus || "Chưa xác định";
  const missing = [];
  if (!hasValue(pkg.thoiGianDongThau)) missing.push("Thời gian đóng thầu");
  if (!hasValue(pkg.thoiGianMoThau) && ["OPENED", "EVALUATING", "AWARDED", "PARTIALLY_AWARDED"].includes(statusCode)) {
    missing.push("Thời gian mở thầu");
  }
  let action = "Xem thông tin gói thầu và cập nhật trường còn thiếu nếu cần.";
  let targetTab = "summary";
  if (statusCode === "INVITED") {
    targetTab = pkg.phuongThucLuaChon === TWO_ENVELOPE_METHOD ? "opening_tech" : "opening";
    action = "Theo dõi mốc đóng/mở thầu trong tab dữ liệu nhà thầu.";
  } else if (["OPENED", "EVALUATING"].includes(statusCode)) {
    action = "Tiếp tục rà soát hồ sơ trong tab đánh giá kỹ thuật.";
    targetTab = "eval_tech";
  } else if (["AWARDED", "PARTIALLY_AWARDED"].includes(statusCode)) {
    action = "Rà soát kết quả lựa chọn nhà thầu trong tab kết quả.";
    targetTab = "result";
  }
  return {
    statusCode,
    status,
    action,
    targetTab,
    missing,
    assessment: missing.length ? "Chưa đủ dữ liệu hiển thị" : "Đã đọc trạng thái hiện có",
    source: "Trạng thái và dữ liệu gói thầu hiện tại",
  };
}
