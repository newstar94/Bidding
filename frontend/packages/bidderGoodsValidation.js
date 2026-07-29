export function bidderGoodsLineDifference(row) {
  const quantity = Number(row?.khoiLuong);
  const unitPrice = Number(row?.donGiaDuThau);
  const total = Number(row?.thanhTienDuThau);
  if (![quantity, unitPrice, total].every(Number.isFinite)) return null;
  return total - quantity * unitPrice;
}

export function validateBidderGoodsRow(row, { official = false } = {}) {
  const errors = [];
  if (!String(row?.danhMucHangHoa || "").trim()) errors.push("Danh mục hàng hóa không được để trống.");
  if (!Number.isFinite(Number(row?.khoiLuong)) || Number(row.khoiLuong) <= 0) errors.push("Khối lượng phải lớn hơn 0.");
  if (!Number.isSafeInteger(Number(row?.donGiaDuThau)) || Number(row.donGiaDuThau) < 0) errors.push("Đơn giá dự thầu phải là số tiền không âm.");
  if (!Number.isSafeInteger(Number(row?.thanhTienDuThau)) || Number(row.thanhTienDuThau) < 0) errors.push("Thành tiền phải là số tiền không âm.");
  const difference = bidderGoodsLineDifference(row);
  if (difference === null || Math.abs(difference) > 1) errors.push("Thành tiền không khớp khối lượng × đơn giá (sai lệch tối đa 1 VND).");
  if (official && row?.mappingStatus !== "matched") errors.push("Hàng hóa chưa được ghép duy nhất với danh mục yêu cầu.");
  return errors;
}

export function summarizeBidderGoods({ rows = [], requirements = [], bidPrice = null } = {}) {
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.thanhTienDuThau)) ? Number(row.thanhTienDuThau) : 0), 0);
  const mappedIds = new Set(rows.filter((row) => row.mappingStatus === "matched").map((row) => String(row.goiThauHangHoaId)));
  const requiredIds = new Set(requirements.map((item) => String(item.id)));
  const missing = [...requiredIds].filter((id) => !mappedIds.has(id));
  const duplicate = rows.filter((row) => row.mappingStatus === "duplicate").length;
  const unmatched = rows.filter((row) => row.mappingStatus !== "matched" && row.mappingStatus !== "duplicate").length;
  const invalidRows = rows.filter((row) => validateBidderGoodsRow(row, { official: true }).length > 0).length;
  const numericBidPrice = bidPrice === null || bidPrice === "" ? null : Number(bidPrice);
  const difference = Number.isFinite(numericBidPrice) ? total - numericBidPrice : null;
  return { total, difference, missing, duplicate, unmatched, invalidRows };
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
  if (summary.difference === null || Math.abs(summary.difference) > 1) errors.push("Tổng thành tiền không khớp giá dự thầu trước giảm giá.");
  return { valid: errors.length === 0, errors, summary };
}
