import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { normalizeBidderGoodsText } from "./bidderGoodsMapping.js";

export const BIDDER_GOODS_SHEET_LABEL = "Mẫu số 12.1B. Bảng giá dự thầu";

const HEADER_ALIASES = Object.freeze({
  sttNguon: ["stt", "so thu tu"],
  maPhanLoNguon: ["ma phan lo", "ma lo"],
  tenPhanLoNguon: ["ten phan lo", "ten lo"],
  danhMucHangHoa: ["danh muc hang hoa"],
  kyMaHieu: ["ky ma hieu", "ky ma hieu tham chieu"],
  nhanHieu: ["nhan hieu"],
  namSanXuat: ["nam san xuat"],
  xuatXu: ["xuat xu", "xuat xu quoc gia vung lanh tho"],
  hangSanXuat: ["hang san xuat", "nha san xuat"],
  cauHinhTinhNangKyThuat: [
    "cau hinh tinh nang ky thuat co ban",
    "cau hinh ky thuat",
    "thong so ky thuat",
  ],
  donViTinh: ["don vi tinh", "dvt"],
  khoiLuong: ["khoi luong", "so luong"],
  maHs: ["ma hs"],
  donGiaDuThau: ["don gia du thau", "don gia"],
  thanhTienDuThau: ["thanh tien", "tong tien"],
});

const REQUIRED_FIELDS = Object.freeze([
  "sttNguon",
  "danhMucHangHoa",
  "donViTinh",
  "khoiLuong",
  "donGiaDuThau",
  "thanhTienDuThau",
]);

const IGNORED_ROW_PHRASES = Object.freeze([
  "tong cong gia du thau",
  "so tien bang chu",
  "chi phi du phong",
  "ghi chu",
]);

function normalizeHeader(value) {
  return normalizeBidderGoodsText(value)
    .replace(/\bda bao gom thue phi le phi neu co\b/g, "")
    .trim();
}

function aliasField(value) {
  const header = normalizeHeader(value);
  if (!header) return null;
  return Object.entries(HEADER_ALIASES).find(([, aliases]) => (
    aliases.some((alias) => header === alias || header.startsWith(`${alias} `))
  ))?.[0] || null;
}

function normalizeSheetName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

export function findBidderGoodsSheet(sheets = []) {
  const target = normalizeSheetName(BIDDER_GOODS_SHEET_LABEL);
  return sheets.find((sheet) => normalizeSheetName(sheet?.name) === target)
    || sheets.find((sheet) => normalizeSheetName(sheet?.name).includes("12.1b"))
    || sheets.find((sheet) => {
      const name = normalizeSheetName(sheet?.name);
      return name.includes("12.1") && name.includes("bảng giá dự thầu");
    })
    || null;
}

export function findBidderGoodsHeader(rows = [], { requireLots = false } = {}) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
    const fieldByColumn = new Map();
    (rows[rowIndex] || []).forEach((value, columnIndex) => {
      const field = aliasField(value);
      if (field && !fieldByColumn.has(field)) fieldByColumn.set(field, columnIndex);
    });
    const required = requireLots
      ? [...REQUIRED_FIELDS, "maPhanLoNguon", "tenPhanLoNguon"]
      : REQUIRED_FIELDS;
    if (required.every((field) => fieldByColumn.has(field))) {
      return { rowIndex, fieldByColumn };
    }
  }
  return null;
}

function cell(row, fieldByColumn, field) {
  const index = fieldByColumn.get(field);
  return index === undefined ? "" : row?.[index] ?? "";
}

function textCell(row, fieldByColumn, field) {
  return String(cell(row, fieldByColumn, field) ?? "").trim();
}

export function parseBidderGoodsNumber(value, { money = false } = {}) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!text) return null;
  text = text.replace(/[^0-9,.-]/g, "");
  if (!text || !/[0-9]/.test(text)) return Number.NaN;
  if (text.includes(",") && text.includes(".")) {
    const decimalSeparator = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    text = text.replaceAll(groupingSeparator, "").replace(decimalSeparator, ".");
  } else if (money) {
    text = text.replace(/[.,]/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function lotMaps(pkg) {
  const lots = Array.isArray(pkg?.phanLoList) ? pkg.phanLoList : [];
  return {
    byCode: new Map(lots.map((lot) => [normalizeBidderGoodsText(lot.maPhanLo), lot])),
    byName: new Map(lots.map((lot) => [normalizeBidderGoodsText(lot.tenPhanLo), lot])),
  };
}

function isIgnoredRow(values) {
  const first = normalizeBidderGoodsText(values.find((value) => String(value || "").trim()) || "");
  return IGNORED_ROW_PHRASES.some((phrase) => first.startsWith(phrase));
}

export function parseBidderGoodsSheet(sheet, { pkg } = {}) {
  if (!sheet?.rows || !Array.isArray(sheet.rows)) {
    throw new Error("Sheet 12.1 không có dữ liệu hợp lệ.");
  }
  const requireLots = String(pkg?.phanLo || "") === "Có";
  const header = findBidderGoodsHeader(sheet.rows, { requireLots });
  if (!header) {
    throw new Error("Sheet 12.1 thiếu các cột bắt buộc của bảng giá dự thầu.");
  }
  const { byCode, byName } = lotMaps(pkg);
  let inheritedLot = null;
  let inheritedLotCode = "";
  let inheritedLotName = "";
  const parsed = [];
  const skipped = [];
  const errors = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const source = sheet.rows[rowIndex] || [];
    if (!source.some((value) => String(value ?? "").trim())) continue;
    if (isIgnoredRow(source)) {
      skipped.push({ rowNumber: rowIndex + 1, reason: "summary" });
      continue;
    }
    const sttNguon = textCell(source, header.fieldByColumn, "sttNguon");
    const explicitLotCode = textCell(source, header.fieldByColumn, "maPhanLoNguon");
    const explicitLotName = textCell(source, header.fieldByColumn, "tenPhanLoNguon");
    const danhMucHangHoa = textCell(source, header.fieldByColumn, "danhMucHangHoa");
    const donViTinh = textCell(source, header.fieldByColumn, "donViTinh");
    const quantityRaw = cell(source, header.fieldByColumn, "khoiLuong");
    const unitPriceRaw = cell(source, header.fieldByColumn, "donGiaDuThau");
    const lineTotalRaw = cell(source, header.fieldByColumn, "thanhTienDuThau");
    const explicitLot = byCode.get(normalizeBidderGoodsText(explicitLotCode))
      || byName.get(normalizeBidderGoodsText(explicitLotName));
    const appearsLotParent = requireLots
      && Boolean(sttNguon && (explicitLotCode || explicitLotName))
      && !danhMucHangHoa && !donViTinh
      && String(quantityRaw ?? "").trim() === "";
    if (appearsLotParent) {
      inheritedLot = explicitLot || null;
      inheritedLotCode = explicitLotCode;
      inheritedLotName = explicitLotName;
      if (!explicitLot) {
        errors.push({ rowNumber: rowIndex + 1, code: "LOT_NOT_FOUND", message: "Không tìm thấy phần lô trong gói thầu." });
      }
      skipped.push({ rowNumber: rowIndex + 1, reason: "lot_parent" });
      continue;
    }
    if (explicitLotCode || explicitLotName) {
      inheritedLot = explicitLot || null;
      inheritedLotCode = explicitLotCode;
      inheritedLotName = explicitLotName;
    }
    if (!danhMucHangHoa && !donViTinh && String(quantityRaw ?? "").trim() === "") {
      skipped.push({ rowNumber: rowIndex + 1, reason: "non_goods" });
      continue;
    }
    const lotCode = explicitLotCode || inheritedLotCode;
    const lotName = explicitLotName || inheritedLotName;
    const lot = explicitLot || inheritedLot;
    const row = {
      sttNguon,
      maPhanLoNguon: lotCode,
      tenPhanLoNguon: lotName,
      phanLoId: requireLots ? lot?.id || null : null,
      danhMucHangHoa,
      kyMaHieu: textCell(source, header.fieldByColumn, "kyMaHieu"),
      nhanHieu: textCell(source, header.fieldByColumn, "nhanHieu"),
      namSanXuat: textCell(source, header.fieldByColumn, "namSanXuat"),
      xuatXu: textCell(source, header.fieldByColumn, "xuatXu"),
      hangSanXuat: textCell(source, header.fieldByColumn, "hangSanXuat"),
      cauHinhTinhNangKyThuat: textCell(source, header.fieldByColumn, "cauHinhTinhNangKyThuat"),
      donViTinh,
      khoiLuong: parseBidderGoodsNumber(quantityRaw),
      maHs: textCell(source, header.fieldByColumn, "maHs"),
      donGiaDuThau: parseBidderGoodsNumber(unitPriceRaw, { money: true }),
      thanhTienDuThau: parseBidderGoodsNumber(lineTotalRaw, { money: true }),
      sourceRowNumber: rowIndex + 1,
      sortOrder: parsed.length,
    };
    if (requireLots && !lot) {
      row.mappingStatus = lotCode || lotName ? "lot_not_found" : "wrong_lot";
    }
    parsed.push(row);
  }
  return {
    sheetName: sheet.name,
    headerRow: header.rowIndex + 1,
    rows: parsed,
    skipped,
    errors,
  };
}

export function parseBidderGoodsWorkbookSheets(sheets, context = {}) {
  const sheet = findBidderGoodsSheet(sheets);
  if (!sheet) throw new Error("Không tìm thấy Sheet Mẫu số 12.1B. Bảng giá dự thầu.");
  return parseBidderGoodsSheet(sheet, context);
}

export function escapeSpreadsheetFormula(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function buildBidderGoodsTemplateRows(pkg, requirements = []) {
  const lotsById = new Map(
    (pkg?.phanLoList || []).map((lot) => [String(lot.id), lot]),
  );
  return requirements.map((requirement, index) => {
    const lot = lotsById.get(String(requirement.phanLoId || ""));
    return {
      sttNguon: String(index + 1),
      maPhanLoNguon: lot?.maPhanLo || "",
      tenPhanLoNguon: lot?.tenPhanLo || "",
      danhMucHangHoa: requirement.tenHangHoa || "",
      donViTinh: requirement.donViTinh || "",
      khoiLuong: requirement.soLuong ?? "",
    };
  });
}

export function downloadBidderGoodsTemplate(pkg, requirements = []) {
  return downloadBidderGoodsWorkbook(
    pkg,
    buildBidderGoodsTemplateRows(pkg, requirements),
  );
}

export async function downloadBidderGoodsWorkbook(pkg, rows = []) {
  const XLSX = await ensureXlsxLoaded();
  const includeLots = String(pkg?.phanLo || "") === "Có";
  const headers = [
    "STT",
    ...(includeLots ? ["Mã phần (lô)", "Tên phần (lô)"] : []),
    "Danh mục hàng hóa", "Ký mã hiệu", "Nhãn hiệu", "Năm sản xuất",
    "Xuất xứ (quốc gia, vùng lãnh thổ)", "Hãng sản xuất",
    "Cấu hình, tính năng kỹ thuật cơ bản", "Đơn vị tính", "Khối lượng",
    "Mã HS", "Đơn giá dự thầu", "Thành tiền",
  ];
  const values = rows.map((row) => [
    escapeSpreadsheetFormula(row.sttNguon),
    ...(includeLots ? [escapeSpreadsheetFormula(row.maPhanLoNguon), escapeSpreadsheetFormula(row.tenPhanLoNguon)] : []),
    escapeSpreadsheetFormula(row.danhMucHangHoa),
    escapeSpreadsheetFormula(row.kyMaHieu),
    escapeSpreadsheetFormula(row.nhanHieu),
    escapeSpreadsheetFormula(row.namSanXuat),
    escapeSpreadsheetFormula(row.xuatXu),
    escapeSpreadsheetFormula(row.hangSanXuat),
    escapeSpreadsheetFormula(row.cauHinhTinhNangKyThuat),
    escapeSpreadsheetFormula(row.donViTinh),
    Number(row.khoiLuong) || 0,
    escapeSpreadsheetFormula(row.maHs),
    Number(row.donGiaDuThau) || 0,
    Number(row.thanhTienDuThau) || 0,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, values.length + 1)}` };
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(12, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "HangHoaDuThau");
  XLSX.writeFile(workbook, `Hang_hoa_du_thau_${pkg?.maGoiThau || "goi_thau"}.xlsx`);
}
