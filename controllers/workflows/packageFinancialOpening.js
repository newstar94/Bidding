import { persistAndSync } from "../domain/MutationService.js";

function parseStoredDateTime(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (
    date.getFullYear() !== Number(year)
    || date.getMonth() !== Number(month) - 1
    || date.getDate() !== Number(day)
    || date.getHours() !== Number(hour)
    || date.getMinutes() !== Number(minute)
  ) return null;
  return date;
}

export function validateFinancialOpeningTime({ required = false, rawValue = "", convertedValue = "", technicalOpeningTime = "" } = {}) {
  if (!required) return { valid: true, message: "" };
  if (!String(rawValue || "").trim()) {
    return { valid: false, message: "Vui lòng nhập thời gian mở E-HSĐXTC." };
  }
  const financialOpening = parseStoredDateTime(convertedValue);
  if (!financialOpening) {
    return { valid: false, message: "Thời gian mở E-HSĐXTC không đúng định dạng." };
  }
  const technicalOpening = parseStoredDateTime(technicalOpeningTime);
  if (technicalOpening && financialOpening < technicalOpening) {
    return { valid: false, message: "Thời gian mở E-HSĐXTC không được trước thời gian mở E-HSĐXKT." };
  }
  return { valid: true, message: "" };
}

export async function savePackageFinancialOpening(controller, pkg, bidUpdates, { openingTime } = {}) {
  const updates = new Map((bidUpdates || []).map((update) => [String(update.id), update]));
  (controller.model.state.thongtinmothau || []).forEach((bid) => {
    const update = updates.get(String(bid.id));
    if (!update) return;
    bid.giaDuThau = update.giaDuThau;
    bid.tyLeGiamGia = update.tyLeGiamGia;
    bid.giaSauGiamGia = update.giaSauGiamGia;
    if (update.hieuLucHsdt != null) {
      bid.hieuLucHsdt = update.hieuLucHsdt;
    } else if (pkg.linhVuc === "Tư vấn") {
      bid.hieuLucHsdt = Number.parseInt(bid.hieuLucHsdxt, 10) || 0;
    }
  });
  pkg.thoiGianMoEhsdxtc = openingTime || pkg.thoiGianMoEhsdxtc || controller.model.getCurrentDateTimeString();
  await persistAndSync(controller, ["thongtinmothau", "goithau"]);
  return pkg;
}
