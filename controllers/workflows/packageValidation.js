import { parseBidDateTime } from "./dateParseUtils.js";
export function validateExtensionRows(mainClosingTime, rows) {
  const mainClosingDate = parseBidDateTime(mainClosingTime);
  const acceptedRows = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const timeStr = String(row.timeStr || "").trim();
    const reason = String(row.reason || "").trim();
    const displayIndex = index + 1;
    if (!timeStr || !reason) {
      return {
        valid: false,
        error: `Vui lòng nhập đầy đủ thông tin gia hạn ở dòng Lần ${displayIndex}!`,
        rows: acceptedRows
      };
    }
    const currentDate = parseBidDateTime(timeStr);
    if (!currentDate) {
      return {
        valid: false,
        error: `Thời gian gia hạn Lần ${displayIndex} không hợp lệ!`,
        rows: acceptedRows
      };
    }
    if (index === 0) {
      if (mainClosingDate && currentDate <= mainClosingDate) {
        return {
          valid: false,
          error: `Thời gian gia hạn Lần 1 (${timeStr}) phải lớn hơn thời gian đóng thầu gốc (${mainClosingTime})!`,
          rows: acceptedRows
        };
      }
    } else {
      const previousTimeStr = acceptedRows[index - 1].timeStr;
      const previousDate = parseBidDateTime(previousTimeStr);
      if (previousDate && currentDate <= previousDate) {
        return {
          valid: false,
          error: `Thời gian gia hạn Lần ${displayIndex} (${timeStr}) phải lớn hơn thời gian gia hạn Lần ${index} (${previousTimeStr})!`,
          rows: acceptedRows
        };
      }
    }
    acceptedRows.push({ timeStr, reason });
  }
  return { valid: true, error: null, rows: acceptedRows };
}
