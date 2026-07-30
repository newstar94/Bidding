function unsignedMoney(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function positiveQuantity(value) {
  const match = String(value ?? "").trim().replace(",", ".").match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  const numerator = BigInt(`${match[1]}${fraction}`);
  if (numerator <= 0n) return null;
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function divideHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

export function deriveBidderGoodsLineTotal(row = {}) {
  const quantity = positiveQuantity(row.khoiLuong);
  const unitPrice = unsignedMoney(row.donGiaDuThau);
  if (!quantity || unitPrice === null) return null;
  return divideHalfUp(unitPrice * quantity.numerator, quantity.denominator).toString();
}

export function withDerivedBidderGoodsFinancials(row = {}) {
  const total = deriveBidderGoodsLineTotal(row);
  return {
    ...row,
    thanhTienDuThau: total,
    giaDuThauSauUuDai: null,
    thanhTienSauUuDai: null,
  };
}
