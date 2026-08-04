function moneyBigInt(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function positiveDecimalFraction(value) {
  const match = String(value ?? "").trim().replace(",", ".").match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || "";
  const numerator = BigInt(`${match[1]}${fraction}`);
  if (numerator <= 0n) return null;
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function exactLineDifference(row) {
  const quantity = positiveDecimalFraction(row?.khoiLuong);
  const unitPrice = moneyBigInt(row?.donGiaDuThau);
  const total = moneyBigInt(row?.thanhTienDuThau);
  if (!quantity || unitPrice === null || total === null) return null;
  return {
    numerator: total * quantity.denominator - quantity.numerator * unitPrice,
    denominator: quantity.denominator,
  };
}

export function bidderGoodsRowFieldErrors(row, { official = false } = {}) {
  const errors = {};
  const add = (field, message) => {
    if (!errors[field]) errors[field] = [];
    errors[field].push(message);
  };
  if (!String(row?.danhMucHangHoa || "").trim()) add("danhMucHangHoa", "Danh mục hàng hóa không được để trống.");
  if (!positiveDecimalFraction(row?.khoiLuong)) add("khoiLuong", "Khối lượng phải lớn hơn 0.");
  if (moneyBigInt(row?.donGiaDuThau) === null) add("donGiaDuThau", "Vui lòng nhập đơn giá dự thầu hợp lệ.");
  if (moneyBigInt(row?.thanhTienDuThau) === null) add("thanhTienDuThau", "Thành tiền phải là số tiền không âm.");
  const difference = exactLineDifference(row);
  if (
    difference === null
    || (difference.numerator < 0n ? -difference.numerator : difference.numerator)
      > difference.denominator
  ) add("thanhTienDuThau", "Thành tiền không khớp khối lượng × đơn giá (sai lệch tối đa 1 VND).");
  if (official && row?.mappingStatus !== "matched") add("goiThauHangHoaId", "Hàng hóa chưa được ghép duy nhất với danh mục yêu cầu.");
  if (!Number.isInteger(Number(row?.maUuDai ?? 0)) || Number(row?.maUuDai ?? 0) < 0 || Number(row?.maUuDai ?? 0) > 5) {
    add("maUuDai", "Mã ưu đãi phải là số nguyên từ 0 đến 5.");
  }
  if (official && ![undefined, null, "", "matched"].includes(row?.uuDaiMatchStatus)) {
    add("maUuDai", "Mapping hoặc khai báo Mẫu 15A còn mơ hồ/mâu thuẫn.");
  }
  if (official && row?.preferenceWarnings?.length) add("maUuDai", "Khai báo ưu đãi còn cảnh báo chưa xử lý.");
  return errors;
}

export function validateBidderGoodsRow(row, options = {}) {
  return Object.values(bidderGoodsRowFieldErrors(row, options)).flat();
}

export function summarizeBidderGoods({ rows = [], requirements = [], bidPrice = null } = {}) {
  const totalBigInt = rows.reduce(
    (sum, row) => sum + (moneyBigInt(row.thanhTienDuThau) ?? 0n),
    0n,
  );
  const total = totalBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(totalBigInt) : totalBigInt.toString();
  const mappedIds = new Set(rows.filter((row) => row.mappingStatus === "matched").map((row) => String(row.goiThauHangHoaId)));
  const requiredIds = new Set(requirements.map((item) => String(item.id)));
  const missing = [...requiredIds].filter((id) => !mappedIds.has(id));
  const duplicate = rows.filter((row) => row.mappingStatus === "duplicate").length;
  const unmatched = rows.filter((row) => row.mappingStatus !== "matched" && row.mappingStatus !== "duplicate").length;
  const invalidRows = rows.filter((row) => validateBidderGoodsRow(row, { official: true }).length > 0).length;
  const parsedBidPrice = bidPrice === null || bidPrice === "" ? null : moneyBigInt(bidPrice);
  const differenceBigInt = parsedBidPrice === null ? null : totalBigInt - parsedBidPrice;
  const difference = differenceBigInt === null
    ? null
    : differenceBigInt >= BigInt(Number.MIN_SAFE_INTEGER)
      && differenceBigInt <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(differenceBigInt)
      : differenceBigInt.toString();
  const matchesBidPrice = differenceBigInt !== null
    && (differenceBigInt < 0n ? -differenceBigInt : differenceBigInt) <= 1n;
  return { total, difference, matchesBidPrice, missing, duplicate, unmatched, invalidRows };
}

export function validateBidderGoodsSubmission(context = {}) {
  const summary = summarizeBidderGoods(context);
  const errors = [];
  if (!context.requirements?.length) errors.push("Gói thầu chưa có danh mục hàng hóa yêu cầu.");
  if (!context.rows?.length) errors.push("Chưa có hàng hóa dự thầu để lưu.");
  if (summary.missing.length) errors.push(`Thiếu ${summary.missing.length} hàng hóa yêu cầu.`);
  if (summary.unmatched) errors.push(`Còn ${summary.unmatched} dòng chưa ghép.`);
  if (summary.duplicate) errors.push(`Có ${summary.duplicate} dòng trùng hàng hóa yêu cầu.`);
  if (summary.invalidRows) errors.push(`Có ${summary.invalidRows} dòng sai dữ liệu hoặc thành tiền.`);
  if (!summary.matchesBidPrice) errors.push("Tổng thành tiền không khớp giá dự thầu trước giảm giá.");
  return { valid: errors.length === 0, errors, summary };
}
