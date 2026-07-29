import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { normalizeBidderGoodsText } from "./bidderGoodsMapping.js";

export const BIDDER_GOODS_SHEET_LABEL = "Mẫu số 12.1B. Bảng giá dự thầu";
export const GOODS_PREFERENCE_SHEET_LABEL = "Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi";

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
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
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

export function findGoodsPreferenceSheet(sheets = []) {
  return sheets.find((sheet) => {
    const name = normalizeBidderGoodsText(normalizeSheetName(sheet?.name));
    return /(^|\D)15\s*\.?\s*a(\D|$)/.test(name)
      && !/(^|\D)15\s*\.?\s*c(\D|$)/.test(name)
      && (name.includes("hang hoa") || name.includes("uu dai") || name.length < 40);
  }) || null;
}

function preferenceHeaderField(value) {
  const header = normalizeHeader(value);
  if (!header) return null;
  if (header === "stt" || header.includes("so thu tu")) return "sttNguon";
  if (header.includes("ten hang hoa") || header.includes("danh muc hang hoa")) return "danhMucHangHoa";
  if (header.includes("xuat xu") && !header.includes("viet nam")) return "xuatXu";
  if (header.includes("doi moi sang tao") || (header.includes("diem i") && header.includes("dieu 10"))) return "innovation";
  if (header.includes("lao dong") && (header.includes("50") || header.includes("uu tien"))) return "specialLabor";
  if (header.includes("50") && (header.includes("tro len") || header.includes("lon hon") || header.includes(">="))) return "domesticAtLeast50";
  if ((header.includes("duoi 50") || header.includes("30") && header.includes("50")) && header.includes("viet nam")) return "domesticUnder50";
  if (header.includes("15c") || header.includes("chi phi san xuat trong nuoc")) return "domesticCostReference";
  if (header.includes("ma phan lo") || header === "ma lo") return "maPhanLoNguon";
  if (header.includes("ten phan lo") || header === "ten lo") return "tenPhanLoNguon";
  return null;
}

export function parseGoodsPreferenceBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = normalizeBidderGoodsText(value).replace(/[✓✔☑]/g, "x");
  if (!normalized) return null;
  if (["co", "yes", "y", "true", "1", "x"].includes(normalized)) return true;
  if (["khong", "no", "n", "false", "0"].includes(normalized)) return false;
  return undefined;
}

export function classifyGoodsPreference(values = {}) {
  const under = parseGoodsPreferenceBoolean(values.domesticUnder50);
  const over = parseGoodsPreferenceBoolean(values.domesticAtLeast50);
  const labor = parseGoodsPreferenceBoolean(values.specialLabor);
  const innovation = parseGoodsPreferenceBoolean(values.innovation);
  const warnings = [];
  for (const [field, value] of Object.entries({ domesticUnder50: under, domesticAtLeast50: over, specialLabor: labor, innovation })) {
    if (value === undefined) warnings.push({ code: "PREFERENCE_BOOLEAN_UNKNOWN", field, message: "Giá trị Có/Không không nhận diện được." });
  }
  if (under === true && over === true) warnings.push({ code: "PREFERENCE_RATE_CONFLICT", message: "Đồng thời khai báo dưới 50% và từ 50% trở lên." });
  if (labor === true && under !== true && over !== true) warnings.push({ code: "PREFERENCE_LABOR_WITHOUT_RATE", message: "Điều kiện lao động chưa gắn với nhóm tỷ lệ chi phí trong nước." });
  const origin = normalizeBidderGoodsText(values.xuatXu);
  if ((under === true || over === true || innovation === true) && origin && !origin.includes("viet nam")) {
    warnings.push({ code: "PREFERENCE_ORIGIN_CONFLICT", message: "Hàng hóa ưu đãi không có xuất xứ Việt Nam." });
  }
  const code = innovation === true ? 5 : over === true && labor === true ? 4
    : over === true ? 3 : under === true && labor === true ? 2 : under === true ? 1 : 0;
  return { code, warnings };
}

function mergedHeaderValue(rows, merges, row, column) {
  const range = (merges || []).find((item) => (
    row >= item.s.r && row <= item.e.r
    && column >= item.s.c && column <= item.e.c
  ));
  return range ? rows[range.s.r]?.[range.s.c] : rows[row]?.[column];
}

export function findGoodsPreferenceHeader(rows = [], { merges = [] } = {}) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 80); rowIndex += 1) {
    const fields = new Map();
    const width = Math.max(...rows.slice(rowIndex, rowIndex + 3).map((row) => row?.length || 0), 0);
    for (let column = 0; column < width; column += 1) {
      const mergedHeader = rows.slice(rowIndex, rowIndex + 3)
        .map((_row, offset) => mergedHeaderValue(
          rows, merges, rowIndex + offset, column,
        ))
        .filter((value) => String(value ?? "").trim()).join(" ");
      const field = preferenceHeaderField(mergedHeader);
      if (field && !fields.has(field)) fields.set(field, column);
    }
    if (fields.has("danhMucHangHoa") && ["domesticUnder50", "domesticAtLeast50", "innovation"].some((field) => fields.has(field))) {
      return { rowIndex, fieldByColumn: fields };
    }
  }
  return null;
}

export function parseGoodsPreferenceSheet(sheet) {
  const header = findGoodsPreferenceHeader(
    sheet?.rows || [],
    { merges: sheet?.merges || [] },
  );
  if (!header) throw new Error("Sheet 15A thiếu hàng tiêu đề hoặc các cột ưu đãi bắt buộc.");
  const rows = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const source = sheet.rows[rowIndex] || [];
    const values = Object.fromEntries([...header.fieldByColumn].map(([field, column]) => [field, source[column]]));
    const name = String(values.danhMucHangHoa || "").trim();
    if (!name || isIgnoredRow(source)) continue;
    const classification = classifyGoodsPreference(values);
    rows.push({
      ...values,
      danhMucHangHoa: name,
      maUuDai: classification.code,
      preferenceWarnings: classification.warnings,
      preferenceSourceRow: rowIndex + 1,
    });
  }
  return { sheetName: sheet.name, headerRow: header.rowIndex + 1, rows };
}

function attachGoodsPreferences(goodsRows, preferenceResult, { goodsSheetName = "" } = {}) {
  if (!preferenceResult) return goodsRows.map((row) => ({
    ...row, maUuDai: 0, uuDaiSourceSheet: "", uuDaiSourceRow: null,
    uuDaiMatchMethod: "no_15a", uuDaiMatchStatus: "matched",
    uuDaiSourcePayload: JSON.stringify({
      source12Sheet: goodsSheetName,
      source12Row: row.sourceRowNumber,
      source15Sheet: "",
      source15Row: null,
      maUuDai: 0,
      warnings: [],
    }),
    preferenceWarnings: [],
  }));
  const queues = new Map();
  preferenceResult.rows.forEach((row) => {
    const key = `${normalizeBidderGoodsText(row.maPhanLoNguon || row.tenPhanLoNguon)}::${normalizeBidderGoodsText(row.danhMucHangHoa)}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(row);
  });
  const lotScopes = new Set(goodsRows.map(
    (row) => normalizeBidderGoodsText(row.maPhanLoNguon || row.tenPhanLoNguon),
  ).filter(Boolean));
  const goodsNameCounts = new Map();
  goodsRows.forEach((row) => {
    const name = normalizeBidderGoodsText(row.danhMucHangHoa);
    goodsNameCounts.set(name, (goodsNameCounts.get(name) || 0) + 1);
  });
  const allowPosition = lotScopes.size <= 1
    && preferenceResult.rows.length === goodsRows.length;
  return goodsRows.map((row, index) => {
    const lot = normalizeBidderGoodsText(row.maPhanLoNguon || row.tenPhanLoNguon);
    const name = normalizeBidderGoodsText(row.danhMucHangHoa);
    const scopedQueue = queues.get(`${lot}::${name}`) || [];
    const unscopedQueue = queues.get(`::${name}`) || [];
    let matched = null;
    let matchMethod = "unmatched";
    if (scopedQueue.length) {
      matched = scopedQueue.shift();
      matchMethod = "normalized_name_occurrence";
    } else if (unscopedQueue.length && (
      lotScopes.size <= 1 || goodsNameCounts.get(name) === 1
    )) {
      matched = unscopedQueue.shift();
      matchMethod = "normalized_name_occurrence";
    } else if (allowPosition) {
      matched = preferenceResult.rows[index] || null;
      matchMethod = matched ? "position" : "unmatched";
    }
    const ambiguous = !matched;
    const warnings = matched?.preferenceWarnings || (
      ambiguous
        ? [{ code: "PREFERENCE_MAPPING_AMBIGUOUS", message: "Không xác định chắc chắn dòng 15A tương ứng." }]
        : []
    );
    return {
      ...row,
      maUuDai: matched?.maUuDai ?? 0,
      uuDaiSourceSheet: preferenceResult.sheetName,
      uuDaiSourceRow: matched?.preferenceSourceRow ?? null,
      uuDaiMatchMethod: matchMethod,
      uuDaiMatchStatus: matched ? (matched.preferenceWarnings?.length ? "conflict" : "matched") : "ambiguous",
      uuDaiSourcePayload: matched ? JSON.stringify({
        source12Sheet: goodsSheetName,
        source12Row: row.sourceRowNumber,
        source15Sheet: preferenceResult.sheetName,
        source15Row: matched.preferenceSourceRow,
        sttNguon: matched.sttNguon ?? "",
        danhMucHangHoa: matched.danhMucHangHoa,
        xuatXu: matched.xuatXu ?? "",
        maUuDai: matched.maUuDai,
        warnings,
      }) : JSON.stringify({
        source12Sheet: goodsSheetName,
        source12Row: row.sourceRowNumber,
        source15Sheet: preferenceResult.sheetName,
        source15Row: null,
        maUuDai: 0,
        warnings,
      }),
      preferenceWarnings: warnings,
    };
  });
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
  if (money && /^\d+$/.test(text)) {
    const normalizedInteger = text.replace(/^0+(?=\d)/, "");
    const integer = BigInt(normalizedInteger);
    return integer <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(integer)
      : normalizedInteger;
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
  const goods = parseBidderGoodsSheet(sheet, context);
  const preferenceSheet = findGoodsPreferenceSheet(sheets);
  const preference = preferenceSheet ? parseGoodsPreferenceSheet(preferenceSheet) : null;
  return {
    ...goods,
    rows: attachGoodsPreferences(
      goods.rows,
      preference,
      { goodsSheetName: goods.sheetName },
    ),
    preferenceSheetName: preference?.sheetName || "",
    preferenceHeaderRow: preference?.headerRow || null,
    has15C: sheets.some((item) => /(^|\D)15\s*\.?\s*c(\D|$)/.test(normalizeBidderGoodsText(item?.name))),
    preferenceNotice: preference ? "" : "Không có Mẫu số 15A — toàn bộ hàng hóa được coi là không thuộc đối tượng ưu đãi",
  };
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
    "Mã ưu đãi", "Mô tả ưu đãi", "Hệ số ưu đãi gốc (bp)",
    "Hệ số cộng khi so sánh (bp)", "Giá trị sau giảm giá",
    "Khoản cộng ưu đãi", "Giá dự thầu sau ưu đãi", "Thành tiền sau ưu đãi",
    "Nguồn sheet/dòng 15A", "Trạng thái override",
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
    Number(row.maUuDai) || 0,
    escapeSpreadsheetFormula({
      0: "Không thuộc đối tượng ưu đãi", 1: "Xuất xứ Việt Nam, chi phí trong nước dưới 50%",
      2: "Mã 1 và điều kiện lao động ưu tiên", 3: "Chi phí trong nước từ 50% trở lên",
      4: "Mã 3 và điều kiện lao động ưu tiên", 5: "Sản phẩm đổi mới sáng tạo",
    }[Number(row.maUuDai) || 0]),
    Number(row.heSoUuDaiGocBp) || 0,
    Number(row.heSoCongUuDaiBp) || 0,
    Number(row.giaTriCoSoSauGiamGia) || 0,
    Number(row.giaTriCongUuDai) || 0,
    Number(row.giaDuThauSauUuDai) || 0,
    Number(row.thanhTienSauUuDai) || 0,
    escapeSpreadsheetFormula(row.uuDaiSourceSheet ? `${row.uuDaiSourceSheet}/${row.uuDaiSourceRow || ""}` : "Không có 15A"),
    row.uuDaiManualOverride ? "Thủ công" : "Không",
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, values.length + 1)}` };
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(12, header.length + 2)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "HangHoaDuThau");
  XLSX.writeFile(workbook, `Hang_hoa_du_thau_${pkg?.maGoiThau || "goi_thau"}.xlsx`);
}
