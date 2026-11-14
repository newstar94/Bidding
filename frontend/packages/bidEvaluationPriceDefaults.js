// Evaluation prices (ADR 0107).
//
// G (giá sau sửa lỗi, hiệu chỉnh sai lệch, trừ giảm giá)
//   = (giá dự thầu + giá trị sửa lỗi + giá trị hiệu chỉnh sai lệch) × (1 − tỷ lệ giảm giá)
// Giá xếp hạng
//   - phương pháp giá thấp nhất (và các phương pháp khác): G + ưu đãi
//   - phương pháp giá đánh giá: G + ΔG + ưu đãi
// Giá đề nghị trúng thầu: G
//
// Ưu đãi is the official preference surcharge from the bidder goods table
// (trangThaiTinhUuDai = "ready"); otherwise 0. Corrections and ΔG may be negative.
//
// A price typed by the user is kept (flag giaXepHangNhapTay / giaDeNghiTrungThauNhapTay
// = true). Automatic prices are recomputed. Rows saved before the flags existed
// (flag null) are automatic when the stored price is empty or equals one of the
// automatic values. Mirrors backend/domain/bid_price.py.

import { parseVietnameseNumber } from "../shared/formatters.js";
import { EVALUATION_METHOD_CODES, normalizeEvaluationMethod } from "./evaluationMethodRules.js";

const RATE_SCALE = 1_000_000n; // percent with 4 decimals → units of 1/10000 %

export function parseSignedMoney(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.round(value)) : null;
  }
  const text = String(value).trim().replace(/−/g, "-").replace(/[.\s]/g, "");
  if (!/^[+-]?\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function moneyValue(amount) {
  if (amount === null) return "";
  const safe = amount <= BigInt(Number.MAX_SAFE_INTEGER) && amount >= -BigInt(Number.MAX_SAFE_INTEGER);
  return safe ? Number(amount) : amount.toString();
}

export function formatSignedMoney(value, formatVND) {
  const amount = parseSignedMoney(value);
  if (amount === null) return "";
  const formatted = formatVND((amount < 0n ? -amount : amount).toString()) || "";
  return amount < 0n && formatted ? `-${formatted}` : formatted;
}

// Keeps a leading minus sign while the user types ("-" alone is allowed).
export function formatSignedMoneyInput(text, formatVND) {
  const raw = String(text ?? "").trim().replace(/−/g, "-");
  const negative = raw.startsWith("-");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return negative ? "-" : "";
  const formatted = formatVND(digits) || "";
  return negative ? `-${formatted}` : formatted;
}

function discountUnits(rate) {
  const parsed = typeof rate === "number" ? rate : parseVietnameseNumber(String(rate ?? "").trim() || "0");
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return BigInt(Math.round(parsed * 10000));
}

function divideHalfUp(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -quotient : quotient;
}

function adjustments(bid) {
  return {
    errorCorrection: parseSignedMoney(bid?.giaTriSuaLoi) ?? 0n,
    deviationAdjustment: parseSignedMoney(bid?.giaTriHieuChinhSaiLech) ?? 0n,
  };
}

export function hasPriceCorrection(bid) {
  const { errorCorrection, deviationAdjustment } = adjustments(bid);
  return errorCorrection !== 0n || deviationAdjustment !== 0n;
}

// G as BigInt, or null when the bid price is unknown.
export function correctedBidPrice(bid = {}) {
  const { errorCorrection, deviationAdjustment } = adjustments(bid);
  if (errorCorrection === 0n && deviationAdjustment === 0n) {
    const discounted = parseSignedMoney(bid.giaSauGiamGia);
    if (discounted !== null && discounted > 0n) return discounted;
  }
  const price = parseSignedMoney(bid.giaDuThau);
  const units = discountUnits(bid.tyLeGiamGia);
  if (price === null || units === null) return null;
  return divideHalfUp(
    (price + errorCorrection + deviationAdjustment) * (RATE_SCALE - units),
    RATE_SCALE,
  );
}

export function preferenceSurcharge(bid = {}) {
  if (String(bid.trangThaiTinhUuDai || "") !== "ready") return 0n;
  const total = parseSignedMoney(bid.tongGiaTriCongUuDai);
  if (total !== null) return total;
  const comparison = parseSignedMoney(bid.giaSoSanhSauUuDai);
  const discounted = parseSignedMoney(bid.giaSauGiamGia);
  return comparison !== null && discounted !== null ? comparison - discounted : 0n;
}

export function usesDeltaG(pkg) {
  return normalizeEvaluationMethod(pkg) === EVALUATION_METHOD_CODES.EVALUATED_PRICE;
}

function deltaG(bid, pkg) {
  return usesDeltaG(pkg) ? (parseSignedMoney(bid?.giaTriQuyDoi) ?? 0n) : 0n;
}

function correctedLabel(bid) {
  return hasPriceCorrection(bid)
    ? "giá sau sửa lỗi, hiệu chỉnh sai lệch, giảm giá"
    : "giá sau giảm giá";
}

export function defaultRankingPrice(bid = {}, pkg = {}) {
  const corrected = correctedBidPrice(bid);
  if (corrected === null) return { value: "", label: "" };
  const surcharge = preferenceSurcharge(bid);
  const total = corrected + deltaG(bid, pkg) + surcharge;
  if (total <= 0n) return { value: "", label: "" };
  const parts = [correctedLabel(bid)];
  if (usesDeltaG(pkg)) parts.push("ΔG");
  if (surcharge !== 0n) parts.push("ưu đãi");
  return { value: moneyValue(total), label: `Tự động: ${parts.join(" + ")}` };
}

export function defaultProposedAwardPrice(bid = {}) {
  const corrected = correctedBidPrice(bid);
  if (corrected === null || corrected <= 0n) return { value: "", label: "" };
  return { value: moneyValue(corrected), label: `Tự động: ${correctedLabel(bid)}` };
}

function legacyAutomaticCandidates(bid, pkg, kind) {
  const corrected = correctedBidPrice(bid);
  const candidates = [parseSignedMoney(bid.giaSauGiamGia), corrected];
  if (kind === "ranking" && corrected !== null) {
    const surcharge = preferenceSurcharge(bid);
    const delta = deltaG(bid, pkg);
    candidates.push(
      corrected + surcharge,
      corrected + delta,
      corrected + delta + surcharge,
      parseSignedMoney(bid.giaSoSanhSauUuDai),
    );
  }
  return new Set(candidates.filter((amount) => amount !== null).map(String));
}

function resolve(stored, manualFlag, fallback, candidates) {
  if (manualFlag === true) return { value: stored ?? "", auto: false, label: "" };
  const storedAmount = parseSignedMoney(stored);
  const isAutomatic = manualFlag === false
    || storedAmount === null
    || storedAmount === 0n
    || candidates.has(String(storedAmount));
  if (!isAutomatic) return { value: stored, auto: false, label: "" };
  return { value: fallback.value, auto: true, label: fallback.label };
}

export function resolveEvaluationPriceDefaults(bid = {}, pkg = {}) {
  return {
    ranking: resolve(
      bid.giaXepHang,
      bid.giaXepHangNhapTay,
      defaultRankingPrice(bid, pkg),
      legacyAutomaticCandidates(bid, pkg, "ranking"),
    ),
    proposedAward: resolve(
      bid.giaDeNghiTrungThau,
      bid.giaDeNghiTrungThauNhapTay,
      defaultProposedAwardPrice(bid),
      legacyAutomaticCandidates(bid, pkg, "proposed"),
    ),
  };
}

// Recompute automatic prices on a bid record (used after an official preference
// calculation, so the stored ranking price follows the new surcharge).
export function applyAutomaticEvaluationPrices(bid, pkg) {
  if (!bid) return bid;
  const resolved = resolveEvaluationPriceDefaults(bid, pkg);
  if (resolved.ranking.auto) {
    bid.giaXepHang = resolved.ranking.value;
    bid.giaXepHangNhapTay = false;
  }
  if (resolved.proposedAward.auto) {
    bid.giaDeNghiTrungThau = resolved.proposedAward.value;
    bid.giaDeNghiTrungThauNhapTay = false;
  }
  return bid;
}
