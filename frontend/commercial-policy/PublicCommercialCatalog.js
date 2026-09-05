const PUBLIC_OWNER_KINDS = new Set(["account", "organization"]);
const PUBLIC_SALES_STATES = new Set(["sellable"]);
const PUBLIC_VISIBILITY = new Set(["public", "hidden"]);
const PERIOD_LABELS = Object.freeze({
  yearly: "/ năm",
  monthly: "/ tháng",
  one_time: "Thanh toán một lần",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeDisplay(display) {
  if (!isRecord(display)) return {};
  const benefits = Array.isArray(display.benefits)
    ? display.benefits.map(safeText).filter(Boolean)
    : [];
  return {
    name: safeText(display.name),
    description: safeText(display.description),
    badge: safeText(display.badge),
    recommended: display.recommended === true,
    visibility: PUBLIC_VISIBILITY.has(display.visibility) ? display.visibility : "public",
    variantLabel: safeText(display.variantLabel),
    periodLabel: safeText(display.periodLabel),
    benefits,
  };
}

export function classifyPublicCommercialResponse(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.offers)) {
    return { state: "unavailable", catalog: null };
  }
  if (Object.hasOwn(payload, "availability")) {
    const validOff = payload.availability === "off"
      && payload.offers.length === 0
      && Array.isArray(payload.creditPacks)
      && Array.isArray(payload.quotaWarnings ?? []);
    return validOff
      ? { state: "off", catalog: payload }
      : { state: "unavailable", catalog: null };
  }
  const validEnabled = nonEmptyString(payload.releaseId)
    && nonEmptyString(payload.releaseChecksum)
    && Array.isArray(payload.creditPacks)
    && Array.isArray(payload.quotaWarnings);
  if (!validEnabled) return { state: "unavailable", catalog: null };
  return {
    state: payload.offers.length === 0 ? "empty" : "available",
    catalog: payload,
  };
}

export function formatCommercialMoney(value, currency = "VND") {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: safeText(currency) || "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function presentCommercialOffer(offer) {
  const source = isRecord(offer) ? offer : {};
  const display = safeDisplay(source.display);
  const price = isRecord(source.price) ? source.price : {};
  const memberQuota = safeNonNegativeInteger(source.memberQuota);
  const includedProcurementQuota = safeNonNegativeInteger(source.includedProcurementQuota);
  const canonicalBenefits = [
    memberQuota > 0 ? `${memberQuota.toLocaleString("vi-VN")} thành viên` : "",
    includedProcurementQuota > 0
      ? `${includedProcurementQuota.toLocaleString("vi-VN")} lượt lấy hồ sơ Mua Sắm Công kèm theo`
      : "",
    source.violationCheckEnabled === true ? "Có kiểm tra vi phạm nhà thầu" : "",
  ].filter(Boolean);
  return {
    code: safeText(source.code),
    ownerKind: PUBLIC_OWNER_KINDS.has(source.ownerKind) ? source.ownerKind : "",
    name: display.name || safeText(source.code),
    description: display.description,
    badge: display.badge,
    recommended: display.recommended,
    variantLabel: display.variantLabel,
    periodLabel: display.periodLabel || PERIOD_LABELS[price.period] || "",
    benefits: display.benefits.length ? display.benefits : canonicalBenefits,
    priceLabel: formatCommercialMoney(price.total, price.currency),
  };
}

export function visibleOffersForOwner(offers, ownerKind = "") {
  if (!Array.isArray(offers)) return [];
  return offers.filter((offer) => {
    if (!isRecord(offer) || !PUBLIC_SALES_STATES.has(offer.salesState)) return false;
    if (ownerKind && offer.ownerKind !== ownerKind) return false;
    return safeDisplay(offer.display).visibility !== "hidden";
  });
}
