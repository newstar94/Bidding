import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { apiFetch } from "../shared/apiClient.js";
import { generateRecordId } from "../shared/idUtils.js";
import { findDuplicateGoodsCodes, normalizeGoodsCode, validatePackageGoodsItem } from "./packageGoodsValidation.js";

const FIELD_ALIASES = Object.freeze({
  stt: ["stt", "so thu tu"],
  maPhanLo: ["ma phan lo", "ma phanlo", "ma lo", "phan lo"],
  tenPhanLo: ["ten phan lo", "ten lo"],
  maHangHoa: ["ma hang hoa", "ma hang muc", "ma mat hang"],
  tenHangHoa: ["ten hang hoa", "ten hang muc", "danh muc hang hoa", "danh muc hang hoa 1"],
  nhomHangHoa: ["nhom hang hoa", "nhom hang muc"],
  donViTinh: ["don vi tinh", "dvt", "don vi"],
  soLuong: ["so luong", "khoi luong", "khoi luong moi thau"],
  yeuCauKyThuat: ["yeu cau ky thuat", "thong so ky thuat", "mo ta ky thuat"],
  kyMaHieuThamChieu: ["ky ma hieu tham chieu", "ky ma hieu"],
  xuatXuYeuCau: ["xuat xu yeu cau", "xuat xu"],
  diaDiemGiaoHang: ["dia diem giao hang"],
  thoiGianGiaoHang: ["thoi gian giao hang"],
  donGiaDuToan: ["don gia du toan", "don gia"],
  thanhTienDuToan: ["thanh tien du toan", "thanh tien"],
  ghiChu: ["ghi chu"],
});

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[()]/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function valueByAlias(row, field) {
  if (Object.prototype.hasOwnProperty.call(row || {}, field)) return row[field];
  const aliases = FIELD_ALIASES[field] || [];
  for (const [header, value] of Object.entries(row || {})) {
    if (aliases.includes(normalized(header))) return value;
  }
  return "";
}

function numberValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalizedNumber = text.includes(",") && text.includes(".")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(",", ".");
  const result = Number(normalizedNumber);
  return Number.isFinite(result) ? result : Number.NaN;
}

export function parsePackageGoodsRows(rows, { pkg, selectedLotId = "" } = {}) {
  const lots = Array.isArray(pkg?.phanLoList) ? pkg.phanLoList : [];
  const lotByCode = new Map(lots.map((lot) => [normalizeGoodsCode(lot.maPhanLo), lot]));
  let inheritedLot = selectedLotId ? lots.find((lot) => String(lot.id) === String(selectedLotId)) : null;
  const parsed = [];
  (rows || []).forEach((row, index) => {
    const stt = String(valueByAlias(row, "stt") || "").trim();
    const lotCode = String(valueByAlias(row, "maPhanLo") || "").trim();
    const lotName = String(valueByAlias(row, "tenPhanLo") || "").trim();
    const goodsName = String(valueByAlias(row, "tenHangHoa") || "").trim();
    const unit = String(valueByAlias(row, "donViTinh") || "").trim();
    const quantityRaw = valueByAlias(row, "soLuong");
    const isLotHeading = pkg?.phanLo === "Có" && lotCode && lotName && !goodsName && !unit && (String(quantityRaw ?? "").trim() === "" || Number(quantityRaw) === 0);
    if (lotCode) inheritedLot = lotByCode.get(normalizeGoodsCode(lotCode)) || { id: "", maPhanLo: lotCode, tenPhanLo: lotName };
    if (isLotHeading) return;
    if (!goodsName && !unit && String(quantityRaw ?? "").trim() === "") return;
    const explicitCode = String(valueByAlias(row, "maHangHoa") || "").trim();
    const item = {
      id: generateRecordId("goithauhanghoa"),
      goiThauId: pkg?.id || "",
      phanLoId: pkg?.phanLo === "Có" ? (selectedLotId || inheritedLot?.id || "") : null,
      maHangHoa: explicitCode || stt,
      tenHangHoa: goodsName,
      nhomHangHoa: String(valueByAlias(row, "nhomHangHoa") || "").trim(),
      donViTinh: unit,
      soLuong: numberValue(quantityRaw),
      yeuCauKyThuat: String(valueByAlias(row, "yeuCauKyThuat") || "").trim(),
      kyMaHieuThamChieu: String(valueByAlias(row, "kyMaHieuThamChieu") || "").trim(),
      xuatXuYeuCau: String(valueByAlias(row, "xuatXuYeuCau") || "").trim(),
      diaDiemGiaoHang: String(valueByAlias(row, "diaDiemGiaoHang") || "").trim(),
      thoiGianGiaoHang: String(valueByAlias(row, "thoiGianGiaoHang") || "").trim(),
      donGiaDuToan: numberValue(valueByAlias(row, "donGiaDuToan")),
      thanhTienDuToan: numberValue(valueByAlias(row, "thanhTienDuToan")),
      ghiChu: String(valueByAlias(row, "ghiChu") || "").trim(),
      sortOrder: parsed.length,
      _rowNumber: index + 2,
      _lotCode: lotCode || inheritedLot?.maPhanLo || "",
    };
    parsed.push(item);
  });
  return parsed;
}

export function buildPackageGoodsPreview(imported, existing, { pkg } = {}) {
  const lots = Array.isArray(pkg?.phanLoList) ? pkg.phanLoList : [];
  const existingByKey = new Map((existing || []).map((item) => [`${item.phanLoId || ""}::${normalizeGoodsCode(item.maHangHoa)}`, item]));
  const duplicateKeys = findDuplicateGoodsCodes(imported);
  return (imported || []).map((item) => {
    const key = `${item.phanLoId || ""}::${normalizeGoodsCode(item.maHangHoa)}`;
    const current = existingByKey.get(key);
    const errors = validatePackageGoodsItem(item, { pkg, lots });
    if (duplicateKeys.has(key)) errors.push("Trùng mã hàng hóa trong cùng file và phạm vi.");
    const comparable = { ...item }; delete comparable.id; delete comparable._rowNumber; delete comparable._lotCode;
    const currentComparable = current ? { ...current } : null;
    if (currentComparable) ["id", "rowVersion", "syncVersion", "organizationId", "ownerType", "createdAt", "updatedAt"].forEach((keyName) => delete currentComparable[keyName]);
    const operation = errors.length ? "invalid" : !current ? "create" : JSON.stringify(comparable) === JSON.stringify(currentComparable) ? "unchanged" : "update";
    return { ...item, id: current?.id || item.id, rowVersion: current?.rowVersion, _operation: operation, _valid: errors.length === 0, _comment: errors.join(" ") };
  });
}

export async function readPackageGoodsExcel(file, context) {
  const form = new FormData();
  form.append("file", file);
  form.append("type", "goithauhanghoa");
  const response = await apiFetch("/api/import-excel", { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || !Array.isArray(payload.rows)) {
    throw new Error(payload?.message || payload?.error || "Không thể phân tích tệp Excel an toàn.");
  }
  return parsePackageGoodsRows(payload.rows.map((row) => row?.data || {}), context);
}

export function packageGoodsHeaders(includeLots = false) {
  return [
    ...(includeLots ? ["Mã phần lô", "Tên phần lô"] : []),
    "Mã hàng hóa", "Tên hàng hóa", "Nhóm hàng hóa", "Đơn vị tính", "Số lượng",
    "Yêu cầu kỹ thuật", "Ký mã hiệu tham chiếu", "Xuất xứ yêu cầu",
    "Địa điểm giao hàng", "Thời gian giao hàng", "Đơn giá dự toán",
    "Thành tiền dự toán", "Ghi chú",
  ];
}

export async function downloadPackageGoodsWorkbook(pkg, goods, { template = false, selectedLotId = "" } = {}) {
  const XLSX = await ensureXlsxLoaded();
  const lots = Array.isArray(pkg?.phanLoList) ? pkg.phanLoList : [];
  const lotById = new Map(lots.map((lot) => [String(lot.id), lot]));
  const includeLots = pkg?.phanLo === "Có" && !selectedLotId;
  const headers = packageGoodsHeaders(includeLots);
  const source = template ? [] : (goods || []).filter((item) => !selectedLotId || String(item.phanLoId) === String(selectedLotId));
  const rows = source.map((item) => {
    const lot = lotById.get(String(item.phanLoId || ""));
    return [
      ...(includeLots ? [lot?.maPhanLo || "", lot?.tenPhanLo || ""] : []),
      item.maHangHoa || "", item.tenHangHoa || "", item.nhomHangHoa || "", item.donViTinh || "", Number(item.soLuong) || 0,
      item.yeuCauKyThuat || "", item.kyMaHieuThamChieu || "", item.xuatXuYeuCau || "",
      item.diaDiemGiaoHang || "", item.thoiGianGiaoHang || "", item.donGiaDuToan === "" ? "" : Number(item.donGiaDuToan || 0),
      item.thanhTienDuToan === "" ? "" : Number(item.thanhTienDuToan || 0), item.ghiChu || "",
    ];
  });
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, rows.length + 1)}` };
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(14, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "DanhMucHangHoa");
  XLSX.writeFile(workbook, `${template ? "Mau_nhap" : "Danh_muc"}_hang_hoa_${pkg?.maGoiThau || "goi_thau"}.xlsx`);
}
