import { parseVND } from "../shared/formatters.js";

export const LOW_PRICE_REJECTION_REASON_PACKAGE = "Nhà thầu có giá đề nghị trúng thầu nhỏ hơn 50% giá gói thầu. Tuy nhiên nhà thầu không chứng minh được các yếu tố cấu thành chi phí chào thầu.";
export const LOW_PRICE_REJECTION_REASON_LOT = "Nhà thầu có giá đề nghị trúng thầu nhỏ hơn 50% giá phần lô. Tuy nhiên nhà thầu không chứng minh được các yếu tố cấu thành chi phí chào thầu.";

function parseLots(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function moneyBigInt(value) {
  const parsed = parseVND(value);
  return parsed === null ? null : BigInt(parsed);
}

function normalizeLotCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

export function normalizeLowPriceAcceptance(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  const normalized = String(value ?? "").trim().toLocaleLowerCase("vi-VN");
  if (normalized === "true" || normalized === "chấp thuận") return true;
  if (normalized === "false" || normalized === "không chấp thuận") return false;
  return null;
}

export function getProposedAwardReferencePrice(pkg, bid) {
  if (pkg?.phanLo !== "Có") return pkg?.giaGoiThau ?? null;
  const bidLotCode = normalizeLotCode(bid?.maPhanLo || bid?.ma_phan_lo);
  if (!bidLotCode) return null;
  const lot = parseLots(pkg?.phanLoList).find((item) => (
    normalizeLotCode(item?.maPhanLo || item?.ma_phan_lo || item?.code) === bidLotCode
  ));
  return lot?.giaTriPhanLo ?? lot?.gia_tri_phan_lo ?? lot?.price ?? null;
}

export function isProposedAwardPriceBelowHalf(pkg, bid, proposedPrice = bid?.giaDeNghiTrungThau) {
  const price = moneyBigInt(proposedPrice);
  const referencePrice = moneyBigInt(getProposedAwardReferencePrice(pkg, bid));
  return price !== null
    && referencePrice !== null
    && price > 0n
    && referencePrice > 0n
    && price * 2n < referencePrice;
}

export function getLowPriceRejectionReason(pkg, bid, proposedPrice = bid?.giaDeNghiTrungThau) {
  if (!isProposedAwardPriceBelowHalf(pkg, bid, proposedPrice)) return "";
  return pkg?.phanLo === "Có"
    ? LOW_PRICE_REJECTION_REASON_LOT
    : LOW_PRICE_REJECTION_REASON_PACKAGE;
}

export function isLowPriceRejectionReason(value) {
  const reason = String(value || "").trim();
  return reason === LOW_PRICE_REJECTION_REASON_PACKAGE || reason === LOW_PRICE_REJECTION_REASON_LOT;
}

export function isLowPriceBidRejected(pkg, bid, proposedPrice = bid?.giaDeNghiTrungThau) {
  return isProposedAwardPriceBelowHalf(pkg, bid, proposedPrice)
    && normalizeLowPriceAcceptance(bid?.chapThuanGiaDeNghiTrungThauDuoi50) === false;
}
