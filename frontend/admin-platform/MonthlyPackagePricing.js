export const ANNUAL_PRICE_MULTIPLIER = 10;
export const MONTHLY_TERM_DAYS = 30;
export const ANNUAL_TERM_DAYS = 365;

export function configurePackageBillingTerms(documentValue) {
  const next = JSON.parse(JSON.stringify(documentValue));
  next.policies ||= {};
  for (const [key, days] of [["monthlyBaseTerm", MONTHLY_TERM_DAYS], ["baseTerm", ANNUAL_TERM_DAYS]]) {
    next.policies[key] = { ...next.policies[key], kind: "fixed_days", days };
    delete next.policies[key].reason;
  }
  return next;
}

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
  if (!["monthly", "yearly"].includes(source.price?.period)) throw new TypeError("Chọn gói tháng hoặc năm để cấu hình giá.");
  const prices = calculateMonthlyPackagePrices(value, documentValue.taxInvoice);
  const next = configurePackageBillingTerms(documentValue);
  const samePackage = offer => offer.tier === source.tier && offer.variant === source.variant && offer.ownerKind === source.ownerKind;
  for (const period of ["monthly", "yearly"]) {
    const matches = next.offers.filter(offer => samePackage(offer) && offer.price?.period === period);
    if (matches.length > 1) throw new TypeError("Gói có kỳ thanh toán trùng nhau. Kiểm tra lại cấu hình.");
    if (matches.length) continue;
    if (next.offers.length >= 16) throw new TypeError("Danh mục hỗ trợ tối đa 16 giá theo kỳ.");
    const code = `${source.tier}.${source.variant}.${period}`;
    if (next.offers.some(offer => offer.code === code)) throw new TypeError("Mã của kỳ thanh toán đã tồn tại.");
    const paired = JSON.parse(JSON.stringify(source));
    paired.code = code;
    paired.price = { ...paired.price, ...prices[period] };
    paired.display ||= {};
    delete paired.display.periodLabel;
    // Retain the existing contract: connected quotas require explicit configuration.
    paired.includedProcurementQuota = source.variant === "internal" ? 0 : null;
    if (source.variant !== "internal") paired.salesState = "non_sellable";
    next.offers.push(paired);
  }
  for (const offer of next.offers) {
    if (samePackage(offer) && prices[offer.price?.period]) {
      offer.price = { ...offer.price, ...prices[offer.price.period] };
    }
  }
  return next;
}
