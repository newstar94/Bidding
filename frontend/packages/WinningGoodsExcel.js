import { ensureXlsxLoaded } from "../shared/externalAssets.js";
import { escapeSpreadsheetFormula } from "./BidderGoodsExcel.js";

export const WINNING_GOODS_HEADERS = Object.freeze([
  "STT",
  "Danh mục hàng hóa",
  "Kỹ mã hiệu",
  "Nhãn hiệu",
  "Năm sản xuất",
  "Xuất xứ",
  "Hãng sản xuất",
  "Cấu hình, tính năng kỹ thuật cơ bản",
  "Đơn vị tính",
  "Khối lượng",
  "Mã HS",
  "Đơn giá trúng thầu",
]);

const LAST_COLUMN = WINNING_GOODS_HEADERS.length - 1;

function text(value) {
  return escapeSpreadsheetFormula(value ?? "");
}

function safeFilename(value) {
  return String(value || "goi_thau")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "goi_thau";
}

function numericCellValue(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return text(value);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return normalized;
  return parsed;
}

function appendMergedRow(rows, merges, value) {
  const rowIndex = rows.length;
  rows.push([text(value), ...Array(LAST_COLUMN).fill("")]);
  merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: LAST_COLUMN } });
  return rowIndex;
}

function appendHeader(rows) {
  const index = rows.length;
  rows.push([...WINNING_GOODS_HEADERS]);
  return index;
}

function appendGoodsRows(rows, goodsRows) {
  goodsRows.forEach((row) => rows.push([
    text(row.stt),
    text(row.danhMucHangHoa),
    text(row.kyMaHieu),
    text(row.nhanHieu),
    text(row.namSanXuat),
    text(row.xuatXu),
    text(row.hangSanXuat),
    text(row.cauHinhTinhNangKyThuat),
    text(row.donViTinh),
    numericCellValue(row.khoiLuong),
    text(row.maHs),
    numericCellValue(row.donGiaTrungThau),
  ]));
}

export function buildWinningGoodsWorkbook(XLSX, exportModel) {
  if (!XLSX?.utils?.aoa_to_sheet || !Array.isArray(exportModel?.groups) || exportModel.groups.length === 0) {
    throw new TypeError("Dữ liệu xuất hàng hóa trúng thầu không hợp lệ.");
  }
  const rows = [];
  const merges = [];
  const titleRows = [];
  const contractorRows = [];
  const lotRows = [];
  const headerRows = [];
  titleRows.push(appendMergedRow(rows, merges, "DANH SÁCH HÀNG HÓA TRÚNG THẦU"));
  if (exportModel.packageCode || exportModel.packageName) {
    titleRows.push(appendMergedRow(
      rows,
      merges,
      `GÓI THẦU: ${[exportModel.packageCode, exportModel.packageName].filter(Boolean).join(" - ")}`,
    ));
  }
  exportModel.groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) rows.push([]);
    contractorRows.push(appendMergedRow(rows, merges, `NHÀ THẦU: ${group.contractorName}`));
    group.lots.forEach((lot, lotIndex) => {
      if (exportModel.isLotted) {
        if (lotIndex > 0) rows.push([]);
        lotRows.push(appendMergedRow(
          rows,
          merges,
          `PHẦN (LÔ): ${[lot.lotCode, lot.lotName].filter(Boolean).join(" - ") || lot.lotId}`,
        ));
      }
      headerRows.push(appendHeader(rows));
      appendGoodsRows(rows, lot.rows);
    });
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!merges"] = merges;
  worksheet["!cols"] = [
    { wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 18 },
    { wch: 15 }, { wch: 18 }, { wch: 24 }, { wch: 45 },
    { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 22 },
  ];
  worksheet["!freeze"] = { xSplit: 0, ySplit: titleRows.length + 1 };
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[address];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        alignment: { vertical: "top", wrapText: true },
      };
    }
  }
  [...titleRows, ...contractorRows, ...lotRows].forEach((rowIndex) => {
    const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })];
    if (cell) cell.s = { ...(cell.s || {}), font: { bold: true } };
  });
  headerRows.forEach((rowIndex) => {
    for (let c = 0; c <= LAST_COLUMN; c += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
      if (cell) cell.s = { ...(cell.s || {}), font: { bold: true }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
    }
  });
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const priceCell = worksheet[XLSX.utils.encode_cell({ r, c: LAST_COLUMN })];
    if (priceCell?.t === "n") priceCell.z = "#,##0.######";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "HangHoaTrungThau");
  return workbook;
}

export async function downloadWinningGoodsWorkbook(exportModel) {
  const XLSX = await ensureXlsxLoaded();
  const workbook = buildWinningGoodsWorkbook(XLSX, exportModel);
  const filename = `Danh_sach_hang_hoa_trung_thau_${safeFilename(exportModel.packageCode)}.xlsx`;
  XLSX.writeFile(workbook, filename);
  return { workbook, filename };
}
