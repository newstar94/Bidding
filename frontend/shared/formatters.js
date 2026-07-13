export function formatCurrency(value) {
  if (value === null || value === void 0 || value === "" || isNaN(value)) return "--";
  const hasFraction = value % 1 !== 0;
  const fixedValue = hasFraction ? value.toFixed(2) : value.toFixed(0);
  const parts = fixedValue.split(".");
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimalPart = parts[1] ? "," + parts[1] : "";
  return integerPart + decimalPart + " ₫";
}
export function formatVND(value) {
  if (value === null || value === void 0) return "";
  let str = value.toString().trim();
  if (!str) return "";
  if (typeof value === "number") {
    str = value.toString().replace(".", ",");
  }
  const parts = str.split(",");
  let integerPart = parts[0];
  let decimalPart = parts.length > 1 ? parts[1] : null;
  integerPart = integerPart.replace(/\D/g, "");
  if (!integerPart && decimalPart === null) return "";
  if (!integerPart) integerPart = "0";
  const formattedInteger = parseInt(integerPart, 10).toLocaleString("vi-VN");
  if (decimalPart !== null) {
    decimalPart = decimalPart.replace(/\D/g, "");
    return formattedInteger + "," + decimalPart;
  }
  return formattedInteger;
}
export function parseVND(value) {
  if (value === null || value === void 0) return null;
  let str = value.toString().trim();
  if (!str) return null;
  str = str.replace(/\./g, "");
  str = str.replace(/,/g, ".");
  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}
export function parseDisplayDateParts(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate(),
      hours: value.getHours(), minutes: value.getMinutes(), hasTime: true
    };
  }
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2}):(\d{2})\s+ngày\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/i);
  if (match) {
    return { year: +match[5], month: +match[4], day: +match[3], hours: +match[1], minutes: +match[2], hasTime: true };
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (match) {
    return { year: +match[1], month: +match[2], day: +match[3], hours: +(match[4] || 0), minutes: +(match[5] || 0), hasTime: match[4] !== void 0 };
  }
  match = text.replace(/\s*-\s*/, " ").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (match) {
    return { year: +match[3], month: +match[2], day: +match[1], hours: +(match[4] || 0), minutes: +(match[5] || 0), hasTime: match[4] !== void 0 };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate(),
    hours: parsed.getHours(), minutes: parsed.getMinutes(), hasTime: /[T\s]\d{1,2}:\d{2}/.test(text)
  };
}
export function formatDisplayMonth(month) {
  const number = Number(month);
  return number === 1 || number === 2 ? String(number).padStart(2, "0") : String(number);
}
export function formatDate(dateStr) {
  if (!dateStr) return "--";
  const parts = parseDisplayDateParts(dateStr);
  if (!parts) return String(dateStr);
  return `${String(parts.day).padStart(2, "0")}/${formatDisplayMonth(parts.month)}/${parts.year}`;
}
export function formatDateOnly(dateStr) {
  return formatDate(dateStr);
}
export function formatDateWithTime(dateStr) {
  if (!dateStr) return "--";
  const parts = parseDisplayDateParts(dateStr);
  if (!parts) return String(dateStr);
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")} ngày ${String(parts.day).padStart(2, "0")}/${formatDisplayMonth(parts.month)}/${parts.year}`;
}
export function formatForDateInput(dateStr) {
  if (!dateStr) return "";
  let year = null, month = null, day = null;
  if (dateStr instanceof Date) {
    const d = dateStr;
    day = String(d.getDate()).padStart(2, "0");
    month = String(d.getMonth() + 1).padStart(2, "0");
    year = d.getFullYear();
  } else {
    const str = String(dateStr).trim();
    const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (ymdMatch) {
      year = ymdMatch[1];
      month = ymdMatch[2];
      day = ymdMatch[3];
    } else if (dmyMatch) {
      day = dmyMatch[1];
      month = dmyMatch[2];
      year = dmyMatch[3];
    } else {
      const cleanedStr = str.replace(/\s*-\s*/, " ");
      const dmyMatch2 = cleanedStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (dmyMatch2) {
        day = dmyMatch2[1];
        month = dmyMatch2[2];
        year = dmyMatch2[3];
      } else {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        day = String(d.getDate()).padStart(2, "0");
        month = String(d.getMonth() + 1).padStart(2, "0");
        year = d.getFullYear();
      }
    }
  }
  return `${day}/${month}/${year}`;
}
export function formatForDatetimeLocal(dateStr) {
  if (!dateStr) return "";
  let year = null, month = null, day = null, hours = "00", minutes = "00";
  if (dateStr instanceof Date) {
    const d = dateStr;
    day = String(d.getDate()).padStart(2, "0");
    month = String(d.getMonth() + 1).padStart(2, "0");
    year = d.getFullYear();
    hours = String(d.getHours()).padStart(2, "0");
    minutes = String(d.getMinutes()).padStart(2, "0");
  } else {
    const str = String(dateStr).trim();
    const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
    if (ymdMatch) {
      year = ymdMatch[1];
      month = ymdMatch[2];
      day = ymdMatch[3];
      if (ymdMatch[4] !== void 0) {
        hours = ymdMatch[4];
        minutes = ymdMatch[5];
      }
    } else if (dmyMatch) {
      day = dmyMatch[1];
      month = dmyMatch[2];
      year = dmyMatch[3];
      if (dmyMatch[4] !== void 0) {
        hours = dmyMatch[4];
        minutes = dmyMatch[5];
      }
    } else {
      const cleanedStr = str.replace(/\s*-\s*/, " ");
      const dmyMatch2 = cleanedStr.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s](\d{2}):(\d{2}))?/);
      if (dmyMatch2) {
        day = dmyMatch2[1];
        month = dmyMatch2[2];
        year = dmyMatch2[3];
        if (dmyMatch2[4] !== void 0) {
          hours = dmyMatch2[4];
          minutes = dmyMatch2[5];
        }
      } else {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        day = String(d.getDate()).padStart(2, "0");
        month = String(d.getMonth() + 1).padStart(2, "0");
        year = d.getFullYear();
        hours = String(d.getHours()).padStart(2, "0");
        minutes = String(d.getMinutes()).padStart(2, "0");
      }
    }
  }
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
export function convertDMYToYMD(dmyStr) {
  if (!dmyStr) return "";
  let cleaned = String(dmyStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  cleaned = cleaned.replace(/-(\d{2}:\d{2})/, " $1");
  cleaned = cleaned.replace(/\s*-\s*/, " ").trim();
  const partsSpace = cleaned.split(" ");
  let datePart = partsSpace[0];
  datePart = datePart.replace(/-/g, "/");
  const parts = datePart.split("/");
  if (parts.length !== 3) return dmyStr;
  const day = parts[0].padStart(2, "0");
  const month = parts[1].padStart(2, "0");
  const year = parts[2];
  return `${year}-${month}-${day}`;
}
export function convertDMYHMSToYMDHMS(dmyHMSStr) {
  if (!dmyHMSStr) return "";
  let cleaned = String(dmyHMSStr).trim();
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(cleaned)) {
    let normalized = cleaned.replace("T", " ");
    const parts2 = normalized.split(" ");
    let timePart2 = parts2[1].split("+")[0];
    if (timePart2.split(":").length === 2) {
      timePart2 += ":00";
    }
    return `${parts2[0]} ${timePart2}`;
  }
  cleaned = cleaned.replace(/-(\d{2}:\d{2})/, " $1");
  const oldFormatMatch = cleaned.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (oldFormatMatch) {
    const hh = oldFormatMatch[1];
    const mm = oldFormatMatch[2];
    const d = oldFormatMatch[3];
    const m = oldFormatMatch[4];
    const y = oldFormatMatch[5];
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${hh}:${mm}:00`;
  }
  cleaned = cleaned.replace(/\s*-\s*/, " ").trim();
  const parts = cleaned.split(" ");
  let datePart = parts[0];
  datePart = datePart.replace(/-/g, "/");
  let timePart = parts[1] || "00:00:00";
  if (timePart.split(":").length === 2) {
    timePart += ":00";
  }
  const ymd = convertDMYToYMD(datePart);
  return `${ymd} ${timePart}`;
}
export function getFileExtensionFromBase64(base64Str) {
  if (!base64Str) return "png";
  if (base64Str.startsWith("data:image/jpeg") || base64Str.startsWith("data:image/jpg")) return "jpg";
  if (base64Str.startsWith("data:image/webp")) return "webp";
  if (base64Str.startsWith("data:image/gif")) return "gif";
  if (base64Str.includes(".")) {
    return base64Str.split(".").pop();
  }
  return "png";
}
export function getPlanBaseCode(code) {
  return code || "";
}
export function getVersionLabel(phienBan) {
  const verNum = parseInt(phienBan) || 0;
  return String(verNum).padStart(2, "0");
}
export function getCurrentDateTimeString() {
  const d = /* @__PURE__ */ new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
export function getCurrentDateYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function getPackageBaseCode(code) {
  return code || "";
}
