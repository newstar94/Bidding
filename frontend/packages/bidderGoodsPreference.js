export const PREFERENCE_RATE_BP = Object.freeze({ 0: 0, 1: 750, 2: 1000, 3: 1000, 4: 1200, 5: 1500 });

export const PREFERENCE_DESCRIPTIONS = Object.freeze({
  0: "Không thuộc đối tượng ưu đãi",
  1: "Xuất xứ Việt Nam, chi phí trong nước dưới 50%",
  2: "Mã 1 và cơ sở đáp ứng điều kiện lao động ưu tiên",
  3: "Xuất xứ Việt Nam, chi phí trong nước từ 50% trở lên",
  4: "Mã 3 và cơ sở đáp ứng điều kiện lao động ưu tiên",
  5: "Sản phẩm đổi mới sáng tạo có xuất xứ Việt Nam",
});

export const INNOVATION_PREFERENCE_HELP = [
  "Công nghệ cao được ưu tiên hoặc khuyến khích",
  "Kết quả nhiệm vụ khoa học, công nghệ và đổi mới sáng tạo",
  "Sản phẩm từ sáng chế, thiết kế bố trí, giống cây trồng hoặc chương trình máy tính của nhà thầu",
  "Sản phẩm chip bán dẫn",
  "Sản phẩm đạt giải thưởng Hồ Chí Minh hoặc giải thưởng Nhà nước về khoa học và công nghệ",
  "Sản phẩm mới từ kết quả nghiên cứu tại trung tâm đổi mới sáng tạo cấp quốc gia hoặc cấp tỉnh",
  "Sản phẩm mới từ nghiên cứu khoa học và phát triển công nghệ theo pháp luật chuyển giao công nghệ",
  "Thời hạn hưởng ưu đãi: 06 năm từ lần đầu được sản xuất và đủ điều kiện đưa ra thị trường",
].join("; ");

export function preferenceRateBp(code) {
  const normalized = Number(code);
  if (!Number.isInteger(normalized) || !(normalized in PREFERENCE_RATE_BP)) {
    throw new RangeError("Mã ưu đãi phải là số nguyên từ 0 đến 5.");
  }
  return PREFERENCE_RATE_BP[normalized];
}

function money(value, label) {
  try {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) throw new Error();
    return BigInt(text);
  } catch {
    throw new RangeError(`${label} phải là số nguyên VND không âm.`);
  }
}

function divideHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function derivedUnitPrice(total, quantityValue, precision = 6) {
  const text = String(quantityValue ?? "").trim().replace(",", ".");
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  const quantityNumerator = BigInt(`${match[1]}${fraction}`);
  if (quantityNumerator <= 0n) return null;
  const quantityDenominator = 10n ** BigInt(fraction.length);
  const scale = 10n ** BigInt(precision);
  const scaled = divideHalfUp(total * quantityDenominator * scale, quantityNumerator);
  const whole = scaled / scale;
  const decimals = (scaled % scale).toString().padStart(precision, "0").replace(/0+$/, "");
  return decimals ? `${whole}.${decimals}` : whole.toString();
}

export function divideMoneyByQuantity(totalValue, quantityValue, precision = 6) {
  const total = money(totalValue, "Giá trị sau giảm giá");
  const result = derivedUnitPrice(total, quantityValue, precision);
  if (result === null) {
    throw new RangeError("Khối lượng phải là số lớn hơn 0 để xác định đơn giá.");
  }
  return result;
}

function allocate(amounts, target, keys) {
  const total = amounts.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) {
    if (target !== 0n) throw new RangeError("Không thể phân bổ giá sau giảm giá khi tổng dòng bằng 0.");
    return amounts.map(() => 0n);
  }
  const bases = amounts.map((value) => value * target / total);
  let remainder = target - bases.reduce((sum, value) => sum + value, 0n);
  const order = amounts.map((value, index) => ({
    index,
    fraction: value * target % total,
    key: keys[index],
  })).sort((left, right) => (
    left.fraction === right.fraction
      ? left.key.localeCompare(right.key)
      : left.fraction > right.fraction ? -1 : 1
  ));
  for (let cursor = 0; remainder > 0n; cursor += 1, remainder -= 1n) {
    bases[order[cursor].index] += 1n;
  }
  return bases;
}

export function calculateBidderGoodsPreference(lines, {
  discountRateBp = 0,
  discountRatePercent = null,
  scopeAfterDiscount = null,
  evaluationBase = null,
} = {}) {
  if (!Array.isArray(lines) || lines.length === 0) throw new RangeError("Chưa có hàng hóa để tính ưu đãi.");
  const normalized = lines.map((line, index) => ({
    line,
    amount: money(line.thanhTienDuThau, "Thành tiền dự thầu"),
    code: Number(line.maUuDai ?? 0),
    intrinsic: preferenceRateBp(line.maUuDai ?? 0),
    key: `${String(line.sortOrder ?? index).padStart(12, "0")}::${line.id || ""}`,
  }));
  const before = normalized.reduce((sum, item) => sum + item.amount, 0n);
  let after;
  if (scopeAfterDiscount != null) {
    after = money(scopeAfterDiscount, "Giá sau giảm giá");
  } else if (discountRatePercent != null) {
    const text = String(discountRatePercent).trim().replace(",", ".");
    const match = text.match(/^(\d+)(?:\.(\d{1,4}))?$/);
    if (!match) throw new RangeError("Tỷ lệ giảm giá phải từ 0 đến 100% và tối đa 4 chữ số thập phân.");
    const fraction = (match[2] || "").padEnd(4, "0");
    const discountUnits = BigInt(match[1]) * 10000n + BigInt(fraction || "0");
    if (discountUnits > 1000000n) throw new RangeError("Tỷ lệ giảm giá phải từ 0 đến 100%.");
    after = divideHalfUp(before * (1000000n - discountUnits), 1000000n);
  } else {
    const discount = Number(discountRateBp || 0);
    if (!Number.isInteger(discount) || discount < 0 || discount > 10000) {
      throw new RangeError("Tỷ lệ giảm giá basis point phải từ 0 đến 10000.");
    }
    after = divideHalfUp(before * BigInt(10000 - discount), 10000n);
  }
  const bases = allocate(normalized.map((item) => item.amount), after, normalized.map((item) => item.key));
  const maximum = Math.max(...normalized.map((item) => item.intrinsic));
  let totalSurcharge = 0n;
  const calculatedLines = normalized.map((item, index) => {
    const surchargeRate = Math.max(0, maximum - item.intrinsic);
    const surcharge = divideHalfUp(bases[index] * BigInt(surchargeRate), 10000n);
    const total = bases[index] + surcharge;
    totalSurcharge += surcharge;
    return {
      ...item.line,
      maUuDai: item.code,
      heSoUuDaiGocBp: item.intrinsic,
      heSoCongUuDaiBp: surchargeRate,
      giaTriCoSoSauGiamGia: bases[index].toString(),
      giaTriCongUuDai: surcharge.toString(),
      thanhTienSauUuDai: total.toString(),
      giaDuThauSauUuDai: derivedUnitPrice(total, item.line.khoiLuong),
    };
  });
  const comparison = after + totalSurcharge;
  return {
    lines: calculatedLines,
    tongTruocGiamGia: before.toString(),
    tongSauGiamGia: after.toString(),
    heSoUuDaiCaoNhatBp: maximum,
    tongGiaTriCongUuDai: totalSurcharge.toString(),
    giaSoSanhSauUuDai: comparison.toString(),
    giaDanhGiaSauUuDai: evaluationBase == null
      ? null : (money(evaluationBase, "Giá đánh giá nền") + totalSurcharge).toString(),
    trangThaiTinhUuDai: "ready",
  };
}
