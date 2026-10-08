export const ANNUAL_PRICE_MULTIPLIER = 10;

export function calculateMonthlyPackagePrices(value, policy) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)$/u.test(raw)) throw new TypeError("Giá tháng phải là số nguyên VND không âm.");
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(amount * ANNUAL_PRICE_MULTIPLIER)) throw new TypeError("Giá năm vượt giới hạn số nguyên an toàn.");
  if (typeof policy?.taxInclusive !== "boolean" || !Number.isInteger(policy.taxBasisPoints) || policy.taxBasisPoints < 0 || policy.taxBasisPoints > 10000 || !["ceil", "floor", "half_up"].includes(policy.rounding)) throw new TypeError("Hoàn tất cấu hình thuế để tính giá tháng và giá năm.");
  const price = (basis, period) => {
    const numerator = BigInt(basis) * BigInt(policy.taxBasisPoints);
    const denominator = BigInt(policy.taxInclusive ? 10000 + policy.taxBasisPoints : 10000);
    const quotient = numerator / denominator, remainder = numerator % denominator;
    const increment = policy.rounding === "ceil" ? remainder > 0n : policy.rounding === "half_up" && remainder * 2n >= denominator;
    const tax = Number(quotient + (increment ? 1n : 0n));
    const subtotal = policy.taxInclusive ? basis - tax : basis;
    const total = subtotal + tax;
    if (!Number.isSafeInteger(total)) throw new TypeError("Tổng tiền vượt giới hạn số nguyên an toàn.");
    return { period, currency: "VND", subtotal, tax, total, monthlyBaseAmount: amount };
  };
  return { monthly: price(amount, "monthly"), yearly: price(amount * ANNUAL_PRICE_MULTIPLIER, "yearly") };
}

export function packageMonthlyBase(documentValue, index) {
  const offer = documentValue?.offers?.[index];
  if (!offer) return null;
  if (Number.isSafeInteger(offer.price?.monthlyBaseAmount)) return offer.price.monthlyBaseAmount;
  const basisKey = documentValue.taxInvoice?.taxInclusive === false ? "subtotal" : "total";
  if (offer.price?.period === "monthly") return offer.price[basisKey] ?? null;
  const amount = offer.price?.[basisKey];
  return Number.isSafeInteger(amount) && amount % ANNUAL_PRICE_MULTIPLIER === 0 ? amount / ANNUAL_PRICE_MULTIPLIER : null;
}

export function applyPackageMonthlyBase(documentValue, index, value) {
  const source = documentValue?.offers?.[index];
  if (!source) throw new TypeError("Không tìm thấy gói để cập nhật giá tháng.");
  const prices = calculateMonthlyPackagePrices(value, documentValue.taxInvoice);
  const next = JSON.parse(JSON.stringify(documentValue));
  for (const offer of next.offers) {
    if (offer.tier === source.tier && offer.variant === source.variant && offer.ownerKind === source.ownerKind && prices[offer.price?.period]) {
      offer.price = { ...offer.price, ...prices[offer.price.period] };
    }
  }
  return next;
}
