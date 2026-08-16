import { readExcelWorkbookSheets } from "../documents/excelFileReader.js";
import { generateRecordId, generateUUID } from "../shared/idUtils.js";
import { beginExcelImportLoading } from "../shared/ExcelImportLoading.js";
import { persistAndSync, replaceTableProjection } from "../shared/MutationService.js";
import { workspaceDataStoreFor } from "../app/WorkspaceDataStore.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { TABLE_PAGE_SIZE } from "../shared/TablePagination.js";
import {
  downloadBidderGoodsTemplate,
  downloadBidderGoodsWorkbook,
  parseBidderGoodsWorkbookSheets,
} from "./BidderGoodsExcel.js";
import { mapBidderGoodsRows, applyManualBidderGoodsMapping } from "./bidderGoodsMapping.js";
import {
  withDerivedBidderGoodsFinancials,
} from "./bidderGoodsFinancials.js";
import {
  getBidderGoodsForBid,
  getBidderGoodsRequirements,
} from "./bidderGoodsSelectors.js";
import {
  bidderGoodsRowFieldErrors,
  summarizeBidderGoods,
  validateBidderGoodsRow,
  validateBidderGoodsSubmission,
} from "./bidderGoodsValidation.js";
import {
  calculateBidderGoodsPreference,
  INNOVATION_PREFERENCE_HELP,
  PREFERENCE_DESCRIPTIONS,
} from "./bidderGoodsPreference.js";

const PAGE_SIZE = TABLE_PAGE_SIZE;
const BIDDER_GOODS_EDITABLE_FIELDS = new Set([
  "kyMaHieu",
  "nhanHieu",
  "namSanXuat",
  "xuatXu",
  "hangSanXuat",
  "cauHinhTinhNangKyThuat",
  "maHs",
  "donGiaDuThau",
]);

function bidderGoodsPaginationPages(currentPage, totalPages, maxVisiblePages = 5) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage) || 1));
  const visibleCount = Math.max(1, Number(maxVisiblePages) || 1);
  let startPage = Math.max(1, safeCurrent - Math.floor(visibleCount / 2));
  const endPage = Math.min(safeTotal, startPage + visibleCount - 1);
  startPage = Math.max(1, endPage - visibleCount + 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
}

function currency(value) {
  const integerText = String(value ?? "").trim();
  if (/^-?\d+$/.test(integerText)) {
    try {
      return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(BigInt(integerText))} đ`;
    } catch {
      return "--";
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(numeric)} đ`
    : "--";
}

function quantity(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(numeric)
    : "—";
}

export function sanitizeBidderGoodsMoneyInput(value) {
  const text = String(value ?? "").trim();
  if (/^\d*$/.test(text)) return text;
  return /^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replaceAll(".", "") : "";
}

export function formatBidderGoodsMoneyInput(value) {
  const digits = sanitizeBidderGoodsMoneyInput(value);
  if (!digits) return "";
  try {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 })
      .format(BigInt(digits));
  } catch {
    return "";
  }
}

function caretAfterDigits(formatted, digitCount) {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) seen += 1;
    if (seen === digitCount) return index + 1;
  }
  return formatted.length;
}

export function formatBidderGoodsMoneyEdit(value, selectionStart) {
  const text = String(value ?? "");
  const safeCaret = Math.max(0, Math.min(text.length, Number(selectionStart) || 0));
  if (!/^[\d.]*$/.test(text)) return { digits: "", formatted: "", caret: 0 };
  const digitCountBeforeCaret = text.slice(0, safeCaret).replace(/\D/g, "").length;
  const digits = text.replaceAll(".", "");
  const formatted = formatBidderGoodsMoneyInput(digits);
  return {
    digits,
    formatted,
    caret: caretAfterDigits(formatted, digitCountBeforeCaret),
  };
}

function lotForBid(pkg, bid) {
  const code = String(bid?.maPhanLo || "").trim().toLocaleLowerCase("vi");
  return (pkg?.phanLoList || []).find(
    (item) => String(item.maPhanLo || "").trim().toLocaleLowerCase("vi") === code,
  ) || null;
}

function requirementSequence(pkg, lot, index) {
  if (String(pkg?.phanLo || "") !== "Có") return String(index + 1);
  const lotIndex = (pkg?.phanLoList || []).findIndex(
    (item) => String(item.id || "") === String(lot?.id || ""),
  );
  return `${lotIndex >= 0 ? lotIndex + 1 : 1}.${index + 1}`;
}

function invalidateOpeningPreference(bid) {
  if (!bid) return;
  bid.trangThaiTinhUuDai = bid.trangThaiTinhUuDai === "ready"
    ? "stale"
    : "draft";
}

export function initializeBidderGoodsFromRequirements(controller, detailedState) {
  if (!controller?.model?.state || !detailedState?.bid || detailedState.readOnly) return 0;
  const requirements = getBidderGoodsRequirements(
    controller.model,
    detailedState.pkg,
    detailedState.bid,
  );
  if (!requirements.length) return 0;
  const lot = lotForBid(detailedState.pkg, detailedState.bid);
  const requirementById = new Map(requirements.map((item, index) => [
    String(item.id),
    { item, index },
  ]));
  let changed = false;
  const allRows = controller.model.state.hanghoaduthaunhathau || [];
  const hydratedRows = allRows.map((row) => {
    if (String(row.goiThauId || "") !== String(detailedState.pkg.id || "")
      || String(row.thongTinMoThauId || "") !== String(detailedState.bid.id || "")) return row;
    const matched = requirementById.get(String(row.goiThauHangHoaId || ""));
    if (!matched) return row;
    const { item, index } = matched;
    const next = {
      ...row,
      phanLoId: row.phanLoId || item.phanLoId || null,
      sttNguon: row.sttNguon || requirementSequence(detailedState.pkg, lot, index),
      maPhanLoNguon: row.maPhanLoNguon || lot?.maPhanLo || "",
      tenPhanLoNguon: row.tenPhanLoNguon || lot?.tenPhanLo || "",
      danhMucHangHoa: String(row.danhMucHangHoa || "").trim() ? row.danhMucHangHoa : item.tenHangHoa || "",
      donViTinh: String(row.donViTinh || "").trim() ? row.donViTinh : item.donViTinh || "",
      khoiLuong: row.khoiLuong === null || row.khoiLuong === undefined || row.khoiLuong === ""
        ? item.soLuong ?? null
        : row.khoiLuong,
    };
    if (["phanLoId", "sttNguon", "maPhanLoNguon", "tenPhanLoNguon", "danhMucHangHoa", "donViTinh", "khoiLuong"]
      .some((field) => String(next[field] ?? "") !== String(row[field] ?? ""))) changed = true;
    return next;
  });
  const coveredRequirementIds = new Set(hydratedRows.filter((row) => (
    String(row.goiThauId || "") === String(detailedState.pkg.id || "")
    && String(row.thongTinMoThauId || "") === String(detailedState.bid.id || "")
  )).map((row) => String(row.goiThauHangHoaId || "")).filter(Boolean));
  const additions = requirements.flatMap((item, index) => {
    if (coveredRequirementIds.has(String(item.id))) return [];
    return [{
      id: generateRecordId("hanghoaduthaunhathau"),
      goiThauId: detailedState.pkg.id,
      thongTinMoThauId: detailedState.bid.id,
      phanLoId: item.phanLoId || null,
      goiThauHangHoaId: item.id,
      sttNguon: requirementSequence(detailedState.pkg, lot, index),
      maPhanLoNguon: lot?.maPhanLo || "",
      tenPhanLoNguon: lot?.tenPhanLo || "",
      danhMucHangHoa: item.tenHangHoa || "",
      kyMaHieu: "",
      nhanHieu: "",
      namSanXuat: "",
      xuatXu: "",
      hangSanXuat: "",
      cauHinhTinhNangKyThuat: "",
      donViTinh: item.donViTinh || "",
      khoiLuong: item.soLuong ?? null,
      maHs: "",
      donGiaDuThau: null,
      thanhTienDuThau: null,
      maUuDai: 0,
      mappingMethod: "auto",
      mappingStatus: "matched",
      sortOrder: Number(item.sortOrder ?? index),
      importBatchId: "",
      isDraft: true,
      trangThaiUuDai: "draft",
    }];
  });
  if (!changed && !additions.length) return 0;
  replaceTableProjection(controller.model, "hanghoaduthaunhathau", [...hydratedRows, ...additions]);
  invalidateOpeningPreference(detailedState.bid);
  return additions.length;
}

export function updateBidderGoodsPreferenceCode(rows, rowId, code, {
  actorId = "",
  updatedAt = new Date().toISOString(),
} = {}) {
  return (rows || []).map((row) => String(row.id) === String(rowId) ? {
    ...row,
    maUuDai: Number(code),
    uuDaiMatchMethod: "manual",
    uuDaiMatchStatus: "matched",
    uuDaiManualOverride: true,
    uuDaiManualActorId: actorId,
    uuDaiManualUpdatedAt: updatedAt,
    uuDaiManualReason: "",
    preferenceWarnings: [],
    trangThaiUuDai: "draft",
    isDraft: true,
  } : row);
}

export function buildBidderGoodsPanelState(controller, detailedState) {
  const { pkg, bid } = detailedState;
  const requirements = bid ? getBidderGoodsRequirements(controller.model, pkg, bid) : [];
  const rows = bid
    ? getBidderGoodsForBid(controller.model, pkg, bid).map(withDerivedBidderGoodsFinancials)
    : [];
  let preferenceCalculation = null;
  try {
    preferenceCalculation = rows.length ? calculateBidderGoodsPreference(rows, {
      discountRatePercent: String(bid?.tyLeGiamGia ?? 0),
      scopeAfterDiscount: bid?.giaSauGiamGia ?? null,
      evaluationBase: bid?.giaXepHang ?? null,
    }) : null;
  } catch {
    preferenceCalculation = null;
  }
  const displayRows = preferenceCalculation?.lines || rows;
  const summary = summarizeBidderGoods({ rows, requirements, bidPrice: bid?.giaDuThau });
  const filter = String(controller._bidderGoodsSearch || "");
  const normalizedFilter = filter.trim().toLocaleLowerCase("vi");
  const filteredRows = normalizedFilter
    ? displayRows.filter((row) => [row.sttNguon, row.danhMucHangHoa, row.kyMaHieu, row.nhanHieu, row.maHs]
      .some((value) => String(value || "").toLocaleLowerCase("vi").includes(normalizedFilter)))
    : displayRows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  controller._bidderGoodsPage = Math.min(Math.max(1, Number(controller._bidderGoodsPage) || 1), pageCount);
  const pageRows = filteredRows.slice(
    (controller._bidderGoodsPage - 1) * PAGE_SIZE,
    controller._bidderGoodsPage * PAGE_SIZE,
  );
  return {
    ...detailedState,
    lot: lotForBid(pkg, bid),
    requirements,
    rows,
    summary,
    preferenceCalculation,
    pageRows,
    filteredCount: filteredRows.length,
    pageCount,
    page: controller._bidderGoodsPage,
    filter,
    editingId: detailedState.readOnly ? "" : String(controller._bidderGoodsEditingId || ""),
    validationAttempted: controller._bidderGoodsValidationScopeId === String(bid?.id || ""),
    validationOfficial: controller._bidderGoodsValidationScopeId === String(bid?.id || "")
      && controller._bidderGoodsValidationOfficial === true,
    importPreview: controller._bidderGoodsImportPreview || null,
    busy: controller._bidderGoodsBusy || "",
    error: controller._bidderGoodsError || "",
    savedAt: controller._bidderGoodsSavedAt || "",
  };
}

function bidderGoodsMoneyStateValue(digits) {
  if (!digits) return null;
  const value = BigInt(digits);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(digits) : digits;
}

export function applyBidderGoodsUnitPriceInput(
  controller, detailedState, rowId, rawValue,
) {
  const digits = sanitizeBidderGoodsMoneyInput(rawValue);
  const value = bidderGoodsMoneyStateValue(digits);
  const records = controller.model.state.hanghoaduthaunhathau;
  if (!Array.isArray(records)) return null;
  const recordIndex = records.findIndex((row) => String(row.id) === String(rowId));
  if (recordIndex < 0) return null;
  records.splice(recordIndex, 1, withDerivedBidderGoodsFinancials({
    ...records[recordIndex],
    donGiaDuThau: value,
    isDraft: true,
  }));
  invalidateOpeningPreference(detailedState.bid);
  controller._detailedEvaluationDirty = true;
  const preview = buildBidderGoodsPanelState(controller, detailedState);
  let previewRow = (preview.preferenceCalculation?.lines || preview.rows).find(
    (row) => String(row.id) === String(rowId),
  ) || null;
  if (previewRow?.thanhTienDuThau == null || previewRow.giaDuThauSauUuDai != null) {
    return { row: previewRow, state: preview };
  }
  try {
    const calculationRows = preview.rows.map((row) => row.thanhTienDuThau == null
      ? { ...row, khoiLuong: 1, donGiaDuThau: 0, thanhTienDuThau: "0" }
      : row);
    previewRow = calculateBidderGoodsPreference(calculationRows, {
      discountRatePercent: String(detailedState.bid?.tyLeGiamGia ?? 0),
      scopeAfterDiscount: detailedState.bid?.giaSauGiamGia ?? null,
      evaluationBase: detailedState.bid?.giaXepHang ?? null,
    }).lines.find((row) => String(row.id) === String(rowId)) || previewRow;
  } catch {
    // The row-level derived total remains usable even when preference inputs are incomplete.
  }
  return { row: previewRow, state: preview };
}

function updateBidderGoodsDerivedCells(rowElement, row) {
  if (!rowElement || !row) return;
  for (const field of [
    "thanhTienDuThau", "giaDuThauSauUuDai", "thanhTienSauUuDai",
  ]) {
    const output = rowElement.querySelector(`[data-bidder-goods-derived="${field}"]`);
    if (output) output.textContent = row[field] == null ? "—" : currency(row[field]);
  }
}

export function bidderGoodsSummaryPresentation(state) {
  const difference = state.summary.difference;
  const priceComparisonReady = state.rows.length > 0
    && state.summary.invalidRows === 0
    && typeof state.summary.matchesBidPrice === "boolean";
  return {
    totalLabel: currency(state.summary.total),
    differenceLabel: !priceComparisonReady
      ? "Chưa đủ dữ liệu để đối chiếu"
      : difference === null
        ? "Chưa có giá dự thầu"
        : state.summary.matchesBidPrice
          ? "Khớp giá dự thầu"
          : `Chênh lệch ${String(difference).startsWith("-") ? "" : "+"}${currency(difference)}`,
    comparisonClass: !priceComparisonReady
      ? ""
      : state.summary.matchesBidPrice ? "text-success" : "text-warning",
  };
}

function updateBidderGoodsSummary(root, state) {
  const presentation = bidderGoodsSummaryPresentation(state);
  const total = root.querySelector("[data-bidder-goods-summary-total]");
  const comparison = root.querySelector("[data-bidder-goods-summary-comparison]");
  if (total) total.textContent = presentation.totalLabel;
  if (!comparison) return;
  comparison.textContent = presentation.differenceLabel;
  comparison.classList.remove("text-success", "text-warning");
  if (presentation.comparisonClass) comparison.classList.add(presentation.comparisonClass);
}

function mappingLabel(status) {
  return {
    matched: "Đã ghép",
    unmatched: "Chưa ghép",
    duplicate: "Trùng hàng hóa",
    wrong_lot: "Sai phần lô",
    lot_not_found: "Không tìm thấy lô",
  }[status] || "Chưa ghép";
}

function mappingBadge(status) {
  const className = status === "matched" ? "badge-success" : status === "unmatched" ? "badge-warning" : "badge-danger";
  return `<span class="badge ${className}">${mappingLabel(status)}</span>`;
}

function preferenceStatus(status, hasCalculation) {
  const normalized = String(status || "").trim().toLocaleLowerCase("vi");
  const labels = {
    draft: ["Bản nháp", "badge-warning"],
    stale: ["Cần tính lại", "badge-warning"],
    ready: ["Đã tính", "badge-success"],
  };
  return labels[normalized]
    || (hasCalculation ? ["Xem trước", "badge-info"] : ["Chưa tính", "badge-warning"]);
}

function rowMarkup(row, state, { hasLotColumns = false } = {}) {
  const isEditing = !state.readOnly && String(state.editingId || "") === String(row.id || "");
  const fieldErrors = state.validationAttempted
    ? bidderGoodsRowFieldErrors(row, { official: state.validationOfficial })
    : {};
  const rowErrors = Object.values(fieldErrors).flat();
  const fieldError = (field) => fieldErrors[field]?.[0] || "";
  const errorId = (field) => `bidder-goods-error-${String(row.id || "row").replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}`;
  const validationAttributes = (field) => fieldError(field)
    ? ` aria-invalid="true" aria-describedby="${errorId(field)}"`
    : ' aria-invalid="false"';
  const validationMessage = (field) => fieldError(field)
    ? `<div id="${errorId(field)}" class="field-error field-error-sm bidder-goods-field-error" role="alert">${escapeHtml(fieldError(field))}</div>`
    : "";
  const displayValue = (field, { money = false, multiline = false } = {}) => {
    const rawValue = row[field];
    const value = money
      ? rawValue === null || rawValue === undefined || rawValue === "" ? "—" : currency(rawValue)
      : escapeHtml(rawValue ?? "") || "—";
    const className = `bidder-goods-readonly-value bidder-goods-offered-value ${fieldError(field) ? "is-invalid" : ""}`;
    const content = multiline
      ? `<div class="${className} bidder-goods-technical-copy">${value}</div>`
      : `<span class="${className}">${value}</span>`;
    return `${content}${validationMessage(field)}`;
  };
  const textValue = (field, label, { multiline = false } = {}) => {
    const value = escapeHtml(row[field] ?? "");
    if (!isEditing) return displayValue(field, { multiline });
    return multiline
      ? `<textarea class="form-control ${fieldError(field) ? "is-invalid" : ""}" data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}"${validationAttributes(field)}>${value}</textarea>${validationMessage(field)}`
      : `<input class="form-control ${fieldError(field) ? "is-invalid" : ""}" data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}" value="${value}"${validationAttributes(field)}>${validationMessage(field)}`;
  };
  const numberValue = (field, label, { money = false } = {}) => {
    if (!isEditing) return displayValue(field, { money });
    if (money) {
      return `<input class="form-control numeric-input ${fieldError(field) ? "is-invalid" : ""}" type="text" inputmode="numeric" pattern="[0-9.]*" autocomplete="off" spellcheck="false" data-bidder-goods-nonnegative-money data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}" value="${escapeHtml(formatBidderGoodsMoneyInput(row[field]))}"${validationAttributes(field)}>${validationMessage(field)}`;
    }
    return `<input class="form-control numeric-input ${fieldError(field) ? "is-invalid" : ""}" type="number" min="0" step="any" data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}" value="${escapeHtml(row[field] ?? "")}"${validationAttributes(field)}>${validationMessage(field)}`;
  };
  const needsMapping = row.mappingStatus !== "matched";
  const preferenceTooltip = Number(row.maUuDai ?? 0) === 5
    ? `${PREFERENCE_DESCRIPTIONS[5]}. ${INNOVATION_PREFERENCE_HELP}`
    : PREFERENCE_DESCRIPTIONS[row.maUuDai ?? 0];
  const preferenceControl = !isEditing
    ? `<span class="bidder-goods-readonly-value bidder-goods-offered-value" title="${escapeHtml(preferenceTooltip)}">${row.maUuDai ?? 0} – ${escapeHtml(PREFERENCE_DESCRIPTIONS[row.maUuDai ?? 0] || "Chưa xác định")}</span>${validationMessage("maUuDai")}`
    : `<select class="form-control ${fieldError("maUuDai") ? "is-invalid" : ""}" data-bidder-goods-preference title="${escapeHtml(preferenceTooltip)}" aria-label="Mã ưu đãi cho ${escapeHtml(row.danhMucHangHoa)}"${validationAttributes("maUuDai")}>${Object.keys(PREFERENCE_DESCRIPTIONS).map((code) => `<option value="${code}" ${Number(code) === Number(row.maUuDai ?? 0) ? "selected" : ""}>${code} – ${escapeHtml(PREFERENCE_DESCRIPTIONS[code])}</option>`).join("")}</select>${validationMessage("maUuDai")}`;
  return `
    <tr data-bidder-goods-id="${escapeHtml(row.id)}" class="bidder-goods-item-row ${rowErrors.length ? "has-validation-error" : ""}">
      <td class="bidder-goods-sticky-stt"><strong>${escapeHtml(row.sttNguon || "—")}</strong></td>
      ${hasLotColumns ? '<td class="bidder-goods-lot-spacer" aria-label="Thuộc phần lô ở dòng phía trên"></td><td class="bidder-goods-lot-spacer" aria-label="Thuộc phần lô ở dòng phía trên"></td>' : ""}
      <td class="bidder-goods-sticky-name">
        <strong>${escapeHtml(row.danhMucHangHoa || "—")}</strong>
        ${needsMapping && !state.readOnly ? `<button type="button" class="btn btn-sm btn-outline bidder-goods-mapping-trigger ${fieldError("goiThauHangHoaId") ? "is-invalid" : ""}" data-bidder-goods-open-mapping title="Chọn danh mục yêu cầu tương ứng"${validationAttributes("goiThauHangHoaId")}><i data-lucide="link-2" aria-hidden="true"></i> Chọn đối chiếu</button>` : ""}
        ${validationMessage("danhMucHangHoa")}
        ${validationMessage("goiThauHangHoaId")}
      </td>
      <td>${textValue("kyMaHieu", "Ký mã hiệu")}</td>
      <td>${textValue("nhanHieu", "Nhãn hiệu")}</td>
      <td>${textValue("namSanXuat", "Năm sản xuất")}</td>
      <td>${textValue("xuatXu", "Xuất xứ")}</td>
      <td>${textValue("hangSanXuat", "Hãng sản xuất")}</td>
      <td class="bidder-goods-item-technical">${textValue("cauHinhTinhNangKyThuat", "Cấu hình, tính năng kỹ thuật", { multiline: true })}</td>
      <td class="bidder-goods-item-unit"><span class="bidder-goods-readonly-value bidder-goods-prefilled-value" title="Tự điền từ danh mục hàng hóa của gói thầu">${escapeHtml(row.donViTinh || "—")}</span></td>
      <td class="bidder-goods-item-quantity numeric-cell"><span class="bidder-goods-readonly-value bidder-goods-prefilled-value" title="Tự điền từ danh mục hàng hóa của gói thầu">${quantity(row.khoiLuong)}</span>${validationMessage("khoiLuong")}</td>
      <td>${textValue("maHs", "Mã HS")}</td>
      <td class="numeric-cell">${numberValue("donGiaDuThau", "Đơn giá dự thầu", { money: true })}</td>
      <td class="numeric-cell"><span class="bidder-goods-calculated-value" data-bidder-goods-derived="thanhTienDuThau" title="Tự tính bằng khối lượng × đơn giá">${row.thanhTienDuThau == null ? "—" : currency(row.thanhTienDuThau)}</span>${fieldError("donGiaDuThau") ? "" : validationMessage("thanhTienDuThau")}</td>
      <td class="bidder-goods-preference-cell">${preferenceControl}</td>
      <td class="numeric-cell"><span class="bidder-goods-calculated-value" data-bidder-goods-derived="giaDuThauSauUuDai" title="Tự tính từ đơn giá dự thầu của mặt hàng và hệ số ưu đãi">${row.giaDuThauSauUuDai == null ? "—" : currency(row.giaDuThauSauUuDai)}</span></td>
      <td class="numeric-cell"><span class="bidder-goods-calculated-value" data-bidder-goods-derived="thanhTienSauUuDai" title="Hệ thống tự tính theo kết quả ưu đãi">${row.thanhTienSauUuDai == null ? "—" : currency(row.thanhTienSauUuDai)}</span></td>
      <td class="bidder-goods-item-actions">${state.readOnly ? "" : `<button type="button" class="action-btn btn-edit ${isEditing ? "is-active" : ""}" data-bidder-goods-edit="${escapeHtml(row.id)}" aria-label="Sửa ${escapeHtml(row.danhMucHangHoa)}" title="${isEditing ? "Đang chỉnh sửa" : "Sửa hàng hóa"}" aria-pressed="${isEditing}"><i data-lucide="pencil" aria-hidden="true"></i></button>`}</td>
    </tr>`;
}

export function buildBidderGoodsMappingModalMarkup(row, requirements = []) {
  return `
    <div class="modal-card bidder-goods-mapping-modal">
      <div class="modal-header">
        <div><h3>Đối chiếu danh mục yêu cầu</h3><p>Chỉ cần chọn khi hệ thống không thể tự ghép chính xác.</p></div>
        <button type="button" class="modal-close" data-bidder-goods-mapping-close aria-label="Đóng"><i data-lucide="x" aria-hidden="true"></i></button>
      </div>
      <div class="modal-body">
        <div class="bidder-goods-mapping-subject"><span>Hàng hóa dự thầu</span><strong>${escapeHtml(row.danhMucHangHoa || "—")}</strong><small>${escapeHtml([row.kyMaHieu, row.nhanHieu].filter(Boolean).join(" · ") || "Chưa có ký mã hiệu, nhãn hiệu")}</small></div>
        ${requirements.length ? `
          <div class="form-group">
            <label for="bidder-goods-mapping-choice">Danh mục hàng hóa trong E-HSMT</label>
            <select id="bidder-goods-mapping-choice" class="form-control">
              <option value="">— Chọn danh mục tương ứng —</option>
              ${requirements.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(row.goiThauHangHoaId || "") ? "selected" : ""}>${escapeHtml(`${item.maHangHoa ? `${item.maHangHoa} – ` : ""}${item.tenHangHoa || "Chưa có tên"}`)}</option>`).join("")}
            </select>
            <small class="form-hint">Danh sách đã được giới hạn theo phần lô đang đánh giá.</small>
          </div>`
          : '<div class="alert alert-warning" role="alert">Không có danh mục yêu cầu phù hợp trong phần lô đang đánh giá.</div>'}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-bidder-goods-mapping-close>Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-bidder-goods-mapping-confirm" ${requirements.length ? "" : "disabled"}>Xác nhận đối chiếu</button>
      </div>
    </div>`;
}

function openBidderGoodsMappingModal(controller, state, row) {
  if (typeof document === "undefined") return false;
  const modalId = "modal-bidder-goods-mapping";
  const returnFocus = document.activeElement;
  document.getElementById(modalId)?.remove();
  const modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal-overlay";
  modal.innerHTML = trustedHTML(buildBidderGoodsMappingModalMarkup(row, state.requirements));
  document.body.appendChild(modal);
  const select = modal.querySelector("#bidder-goods-mapping-choice");
  const confirm = modal.querySelector("#btn-bidder-goods-mapping-confirm");
  const close = () => {
    controller.view.closeModal?.(modalId);
    modal.remove();
    if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
  };
  const syncConfirm = () => { if (confirm) confirm.disabled = !select?.value; };
  select?.addEventListener("change", syncConfirm);
  syncConfirm();
  modal.querySelectorAll("[data-bidder-goods-mapping-close]").forEach((button) => button.addEventListener("click", close));
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  confirm?.addEventListener("click", () => {
    const requirementId = select?.value || "";
    if (!requirementId) return;
    const requirement = state.requirements.find((item) => String(item.id) === String(requirementId));
    replaceTableProjection(controller.model, "hanghoaduthaunhathau", applyManualBidderGoodsMapping(
      controller.model.state.hanghoaduthaunhathau.map((item) => (
        String(item.id) === String(row.id)
          ? { ...item, phanLoId: requirement?.phanLoId || item.phanLoId || null }
          : item
      )),
      row.id,
      requirementId,
    ));
    invalidateOpeningPreference(state.bid);
    controller._detailedEvaluationDirty = true;
    close();
    controller.renderDetailedEvaluation();
  });
  controller.view.openModal?.(modalId);
  if (!modal.classList.contains("active")) modal.classList.add("active");
  controller.makeSearchableSelect?.(select, "Tìm danh mục hàng hóa...");
  controller.view.createIconsScoped?.(modal);
  return true;
}

function previewMarkup(preview) {
  if (!preview) return "";
  const errors = preview.rows.filter((row) => (
    row.mappingStatus !== "matched"
    || row.uuDaiMatchStatus !== "matched"
    || row.preferenceWarnings?.length
    || validateBidderGoodsRow(row).length
  )).length;
  const preferenceCounts = Array.from({ length: 6 }, (_value, code) => (
    preview.rows.filter((row) => Number(row.maUuDai ?? 0) === code).length
  ));
  const confident = preview.rows.filter((row) => row.uuDaiMatchStatus === "matched").length;
  const ambiguous = preview.rows.filter((row) => row.uuDaiMatchStatus === "ambiguous").length;
  const conflicts = preview.rows.filter((row) => row.uuDaiMatchStatus === "conflict").length;
  return `
    <section class="bidder-goods-preview" aria-label="Xem trước nhập Excel">
      <div class="bidder-goods-preview-header">
        <div><strong>Xem trước nhập Excel</strong><span>12.1B: ${escapeHtml(preview.sheetName)} · dòng tiêu đề ${preview.headerRow}</span></div>
        <div class="bidder-goods-preview-metrics">
          <span>${preview.rows.length} dòng</span>
          <span>15A: ${escapeHtml(preview.preferenceSheetName || "Không có")}</span>
          <span>15C: ${preview.has15C ? "Có" : "Không"}</span>
          <span>Mã 0–5: ${preferenceCounts.join("/")}</span>
          <span>Ghép chắc chắn/mơ hồ/mâu thuẫn: ${confident}/${ambiguous}/${conflicts}</span>
          <span>${currency(preview.total)}</span>
          <span class="${errors ? "text-danger" : "text-success"}">${errors} lỗi/cảnh báo</span>
        </div>
      </div>
      ${preview.preferenceNotice ? `<div class="alert alert-info" role="status">${escapeHtml(preview.preferenceNotice)}</div>` : ""}
      <div class="table-container package-table-frame">
        <table class="data-table bidder-goods-preview-table" data-no-sort="true" data-row-pagination="true" aria-label="Xem trước hàng hóa dự thầu nhập từ Excel">
          <thead><tr><th>Dòng 12.1B</th><th>Dòng 15A</th><th>STT</th><th>Phần lô</th><th>Danh mục hàng hóa</th><th>Ưu đãi</th><th>Thành tiền</th><th>Trạng thái ghép</th></tr></thead>
          <tbody>${preview.rows.map((row) => `<tr><td>${row.sourceRowNumber}</td><td>${row.uuDaiSourceRow || "—"}</td><td>${escapeHtml(row.sttNguon)}</td><td>${escapeHtml(row.maPhanLoNguon || "Không phân lô")}</td><td>${escapeHtml(row.danhMucHangHoa)}</td><td>${row.maUuDai ?? 0}</td><td class="numeric-cell">${currency(row.thanhTienDuThau)}</td><td>${mappingBadge(row.mappingStatus)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="workflow-action-row">
        <button type="button" class="btn btn-outline" id="btn-bidder-goods-preview-cancel">Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-bidder-goods-preview-confirm" ${preview.rows.length ? "" : "disabled"}>Xác nhận nhập</button>
      </div>
    </section>`;
}

export function renderBidderGoodsPanelMarkup(state) {
  if (!state.bid) return '<div class="package-panel-empty">Chưa có hồ sơ dự thầu phù hợp.</div>';
  if (!state.requirements.length) {
    return `
      <div class="package-panel-empty bidder-goods-empty-required">
        <i data-lucide="package-x" aria-hidden="true"></i>
        <strong>Gói thầu chưa có danh mục hàng hóa yêu cầu.</strong>
        <span>Vui lòng nhập danh mục hàng hóa của gói/phần lô trước khi nhập hàng hóa dự thầu của nhà thầu.</span>
      </div>`;
  }
  const { differenceLabel, comparisonClass } = bidderGoodsSummaryPresentation(state);
  const detectedIssueCount = state.summary.invalidRows
    + state.summary.missing.length
    + state.summary.unmatched
    + state.summary.duplicate;
  const issueCount = state.validationAttempted ? detectedIssueCount : 0;
  const [calculationStatus, calculationStatusClass] = preferenceStatus(
    state.bid.trangThaiTinhUuDai,
    Boolean(state.preferenceCalculation),
  );
  const busyAttributes = state.busy ? 'disabled aria-disabled="true"' : "";
  const filteredCount = Number.isFinite(state.filteredCount) ? state.filteredCount : state.rows.length;
  const pageStart = filteredCount ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(state.page * PAGE_SIZE, filteredCount);
  const paginationPages = bidderGoodsPaginationPages(state.page, state.pageCount);
  const hasLotColumns = String(state.pkg?.phanLo || "") === "Có";
  const tableColumnCount = hasLotColumns ? 19 : 17;
  const firstVisibleRow = state.pageRows[0] || state.rows[0] || null;
  const visibleLot = state.lot || (firstVisibleRow ? {
    id: firstVisibleRow.phanLoId,
    maPhanLo: firstVisibleRow.maPhanLoNguon,
    tenPhanLo: firstVisibleRow.tenPhanLoNguon,
  } : null);
  const lotIndex = (state.pkg?.phanLoList || []).findIndex((item) => (
    String(item.id || "") === String(visibleLot?.id || "")
    || String(item.maPhanLo || "").trim().toLocaleLowerCase("vi") === String(visibleLot?.maPhanLo || "").trim().toLocaleLowerCase("vi")
  ));
  const lotSequence = lotIndex >= 0
    ? String(lotIndex + 1)
    : String(firstVisibleRow?.sttNguon || "").split(".")[0] || "—";
  const lotHeadingMarkup = hasLotColumns && state.pageRows.length ? `
    <tr class="bidder-goods-lot-row">
      <td>${escapeHtml(lotSequence)}</td>
      <td>${escapeHtml(visibleLot?.maPhanLo || firstVisibleRow?.maPhanLoNguon || "—")}</td>
      <td>${escapeHtml(visibleLot?.tenPhanLo || firstVisibleRow?.tenPhanLoNguon || "—")}</td>
      <td colspan="${tableColumnCount - 3}"></td>
    </tr>` : "";
  const exportMenu = `
    <details class="bidder-goods-export-menu">
      <summary class="btn btn-outline" id="btn-bidder-goods-export-menu"><i data-lucide="file-spreadsheet" aria-hidden="true"></i><span>Xuất Excel</span><i class="bidder-goods-export-chevron" data-lucide="chevron-down" aria-hidden="true"></i></summary>
      <div class="bidder-goods-export-popover" aria-label="Tùy chọn xuất Excel">
        <button type="button" class="bidder-goods-export-option" id="btn-bidder-goods-template"><i data-lucide="download" aria-hidden="true"></i><span><strong>Tải file mẫu</strong><small>File trống theo đúng cấu trúc nhập liệu</small></span></button>
        <button type="button" class="bidder-goods-export-option" id="btn-bidder-goods-export"><i data-lucide="file-spreadsheet" aria-hidden="true"></i><span><strong>Xuất dữ liệu hiện tại</strong><small>Xuất hàng hóa trong phạm vi đang chọn</small></span></button>
      </div>
    </details>`;
  const mutationControls = state.readOnly ? "" : `
    <input id="bidder-goods-excel-input" type="file" accept=".xlsx,.xls" ${busyAttributes} hidden>`;
  const addControl = state.readOnly ? "" : `<button type="button" class="btn btn-primary" id="btn-bidder-goods-add" ${busyAttributes}><i data-lucide="plus" aria-hidden="true"></i> Thêm hàng hóa</button>`;
  const fileActions = `<div class="bidder-goods-file-actions">${state.readOnly ? "" : `<button type="button" class="btn btn-outline" id="btn-bidder-goods-import" ${busyAttributes}><i data-lucide="upload" aria-hidden="true"></i> Nhập Excel</button>`}${exportMenu}${addControl}</div>`;
  return `
    <div class="bidder-goods-panel">
      <header class="bidder-goods-context" role="status">
        <div class="bidder-goods-context-main">
          <span class="bidder-goods-context-label">Danh mục hàng hóa dự thầu</span>
          <strong>${escapeHtml(state.pkg.tenGoiThau || state.pkg.maGoiThau || "—")}</strong>
        </div>
        <dl class="bidder-goods-context-meta">
          ${state.lot ? `<div><dt>Phần lô</dt><dd>${escapeHtml(`${state.lot.maPhanLo || ""} – ${state.lot.tenPhanLo || ""}`)}</dd></div>` : ""}
          <div><dt>Phương thức</dt><dd>${escapeHtml(state.roundType === "financial" ? "1G2T – Tài chính" : "1G1T")}</dd></div>
        </dl>
      </header>
      <section class="bidder-goods-commandbar" aria-label="Công cụ danh mục hàng hóa">
        <div class="bidder-goods-command-main">${mutationControls}
          <label class="bidder-goods-search" for="bidder-goods-search"><i data-lucide="search" aria-hidden="true"></i><span class="visually-hidden">Tìm kiếm hàng hóa dự thầu</span><input id="bidder-goods-search" data-bidder-goods-filter class="form-control" type="search" value="${escapeHtml(state.filter)}" placeholder="Tìm tên, ký mã hiệu, mã HS…" autocomplete="off"></label>
        </div>
        <div class="bidder-goods-command-tools">${fileActions}</div>
      </section>
      ${state.busy ? '<div class="alert alert-info bidder-goods-operation-state" role="status" aria-live="polite" aria-busy="true"><span class="loading-spinner" aria-hidden="true"></span> Đang đọc và kiểm tra file Excel…</div>' : ""}
      ${state.error ? `<div class="alert alert-danger bidder-goods-operation-state" role="alert">${escapeHtml(state.error)}</div>` : ""}
      ${state.savedAt ? `<div class="bidder-goods-operation-state text-success" role="status" aria-live="polite">Đã lưu lúc ${escapeHtml(state.savedAt)}</div>` : ""}
      <section class="bidder-goods-summary" aria-label="Tổng hợp hàng hóa dự thầu">
        <div class="bidder-goods-summary-primary">
          <div><strong class="bidder-goods-summary-label">Danh mục</strong><span class="bidder-goods-summary-value">${state.rows.length}/${state.requirements.length} mặt hàng</span></div>
          <div><strong class="bidder-goods-summary-label">Tổng thành tiền</strong><span class="bidder-goods-summary-value" data-bidder-goods-summary-total>${currency(state.summary.total)}</span></div>
          <div><strong class="bidder-goods-summary-label">Đối chiếu giá dự thầu</strong><span class="bidder-goods-summary-value ${comparisonClass}" data-bidder-goods-summary-comparison>${escapeHtml(differenceLabel)}</span></div>
          <div><strong class="bidder-goods-summary-label">Lỗi cần xử lý</strong><span class="bidder-goods-summary-value ${issueCount ? "text-danger" : "text-success"}">${issueCount}</span></div>
        </div>
        <div class="bidder-goods-summary-preference ${state.preferenceCalculation ? "has-calculation" : "is-empty"}">
          <div class="bidder-goods-summary-preference-title"><strong>Ưu đãi</strong><span class="badge ${calculationStatusClass}">${escapeHtml(calculationStatus)}</span></div>
          ${state.preferenceCalculation ? `
            <dl>
              <div><dt>Hệ số cao nhất</dt><dd>${state.preferenceCalculation.heSoUuDaiCaoNhatBp / 100}%</dd></div>
              <div><dt>Tổng khoản cộng</dt><dd>${currency(state.preferenceCalculation.tongGiaTriCongUuDai)}</dd></div>
              <div><dt>Giá sau ưu đãi</dt><dd>${currency(state.preferenceCalculation.giaSoSanhSauUuDai)}</dd></div>
            </dl>` : '<p>Hoàn thiện đơn giá và mã ưu đãi để hệ thống tính giá so sánh.</p>'}
        </div>
      </section>
      ${previewMarkup(state.importPreview)}
      <div class="table-container package-table-frame has-bottom-space bidder-goods-table-frame">
        <table class="data-table bidder-goods-table ${hasLotColumns ? "has-lot-columns" : ""}" data-no-sort="true" data-density="comfortable" aria-label="Danh mục hàng hóa dự thầu">
          <thead><tr><th>STT</th>${hasLotColumns ? "<th>Mã phần (lô)</th><th>Tên phần lô</th>" : ""}<th>Danh mục hàng hóa</th><th>Ký mã hiệu</th><th>Nhãn hiệu</th><th>Năm sản xuất</th><th>Xuất xứ</th><th>Hãng sản xuất</th><th>Cấu hình, tính năng kỹ thuật</th><th>Đơn vị tính</th><th>Khối lượng</th><th>Mã HS</th><th>Đơn giá dự thầu</th><th>Thành tiền</th><th>Ưu đãi</th><th>Đơn giá sau ưu đãi</th><th>Thành tiền sau ưu đãi</th><th>Thao tác</th></tr></thead>
          <tbody>${state.pageRows.length ? `${lotHeadingMarkup}${state.pageRows.map((row) => rowMarkup(row, state, { hasLotColumns })).join("")}` : `<tr><td colspan="${tableColumnCount}"><div class="package-panel-empty">Chưa có hàng hóa dự thầu trong phạm vi này.</div></td></tr>`}</tbody>
        </table>
      </div>
      <footer class="bidder-goods-footer">
        <span class="pagination-info bidder-goods-pagination-info">Hiển thị <strong>${pageStart}-${pageEnd}</strong> trên tổng số <strong>${filteredCount}</strong> bản ghi</span>
        <nav class="pagination-container bidder-goods-pagination" aria-label="Phân trang hàng hóa dự thầu">
          <div class="pagination-buttons">
            <button type="button" class="pagination-btn" data-bidder-goods-page="1" title="Trang đầu" aria-label="Trang đầu" ${state.page <= 1 ? "disabled" : ""}><i data-lucide="chevrons-left" aria-hidden="true"></i></button>
            <button type="button" class="pagination-btn" data-bidder-goods-page="${Math.max(1, state.page - 1)}" title="Trang trước" aria-label="Trang trước" ${state.page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button>
            ${paginationPages.map((pageNumber) => `<button type="button" class="pagination-btn ${pageNumber === state.page ? "active" : ""}" data-bidder-goods-page="${pageNumber}" ${pageNumber === state.page ? 'aria-current="page"' : ""} aria-label="Trang ${pageNumber}">${pageNumber}</button>`).join("")}
            <button type="button" class="pagination-btn" data-bidder-goods-page="${Math.min(state.pageCount, state.page + 1)}" title="Trang sau" aria-label="Trang sau" ${state.page >= state.pageCount ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>
            <button type="button" class="pagination-btn" data-bidder-goods-page="${state.pageCount}" title="Trang cuối" aria-label="Trang cuối" ${state.page >= state.pageCount ? "disabled" : ""}><i data-lucide="chevrons-right" aria-hidden="true"></i></button>
          </div>
        </nav>
        ${state.readOnly ? '<div class="bidder-goods-readonly-notice" role="status"><i data-lucide="lock" aria-hidden="true"></i> Dữ liệu đang ở chế độ chỉ đọc.</div>' : `<div class="workflow-action-row bidder-goods-save-actions"><button type="button" class="btn btn-outline" id="btn-bidder-goods-save-draft"><i data-lucide="save" aria-hidden="true"></i>Lưu nháp</button><button type="button" class="btn btn-primary" id="btn-bidder-goods-save-official"><i data-lucide="save" aria-hidden="true"></i>Lưu chính thức</button></div>`}
      </footer>
    </div>`;
}

export async function analyzeBidderGoodsExcel(
  controller,
  detailedState,
  file,
  { onWorkbookRead } = {},
) {
  const sheets = await readExcelWorkbookSheets(file);
  await onWorkbookRead?.();
  const parsed = parseBidderGoodsWorkbookSheets(sheets, { pkg: detailedState.pkg });
  const currentContractorId = String(detailedState.bid?.nhaThauId || "");
  const candidateBids = detailedState.rawBids.filter(
    (bid) => String(bid.nhaThauId || "") === currentContractorId,
  );
  const groups = new Map();
  parsed.rows.forEach((row) => {
    const targetBid = String(detailedState.pkg.phanLo || "") === "Có"
      ? candidateBids.find((bid) => String(bid.maPhanLo || "").trim().toLocaleLowerCase("vi") === String(row.maPhanLoNguon || "").trim().toLocaleLowerCase("vi"))
      : detailedState.bid;
    const key = targetBid?.id || detailedState.bid.id;
    if (!groups.has(key)) groups.set(key, { bid: targetBid || detailedState.bid, rows: [] });
    groups.get(key).rows.push(row);
  });
  const batchId = `bidder-goods-import:${generateUUID()}`;
  const previewRows = [];
  for (const group of groups.values()) {
    const requirements = getBidderGoodsRequirements(controller.model, detailedState.pkg, group.bid);
    const existing = getBidderGoodsForBid(controller.model, detailedState.pkg, group.bid);
    const mapped = mapBidderGoodsRows(group.rows, requirements, { existing });
    mapped.forEach((row) => previewRows.push(withDerivedBidderGoodsFinancials({
      ...row,
      id: generateRecordId("hanghoaduthaunhathau"),
      goiThauId: detailedState.pkg.id,
      thongTinMoThauId: group.bid.id,
      importBatchId: batchId,
      isDraft: true,
    })));
  }
  return {
    ...parsed,
    rows: previewRows,
    total: (() => {
      const total = previewRows.reduce(
        (sum, row) => sum + BigInt(String(row.thanhTienDuThau || 0)),
        0n,
      );
      return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : total.toString();
    })(),
    mode: "replace",
  };
}

export async function importBidderGoodsExcel(controller, detailedState, file) {
  if (!file || detailedState.readOnly) return false;
  controller._bidderGoodsBusy = "import";
  controller._bidderGoodsError = "";
  controller.renderDetailedEvaluation();
  const loading = await beginExcelImportLoading({ fileName: file.name });
  try {
    const preview = await analyzeBidderGoodsExcel(controller, detailedState, file, {
      onWorkbookRead: () => loading.update(
        "validate",
        "File đã được đọc. Hệ thống đang ghép hàng hóa với hồ sơ dự thầu.",
      ),
    });
    await loading.update(
      "preview",
      "Hàng hóa dự thầu đang được chuẩn bị để bạn xác nhận trước khi nhập.",
    );
    controller._bidderGoodsImportPreview = preview;
    controller._detailedEvaluationDirty = true;
    return true;
  } catch (error) {
    console.error(error);
    await loading.close();
    controller._bidderGoodsError = error?.message || "Vui lòng kiểm tra lại file Excel.";
    await controller.view.customAlert("Không thể đọc Excel", error?.message || "Vui lòng kiểm tra lại file Excel.", "alert-triangle");
    return false;
  } finally {
    await loading.close();
    controller._bidderGoodsBusy = "";
    controller.renderDetailedEvaluation();
  }
}

export async function confirmBidderGoodsImport(controller) {
  const preview = controller._bidderGoodsImportPreview;
  if (!preview) return false;
  const incomingScopes = new Set(preview.rows.map((row) => String(row.thongTinMoThauId)));
  const existingRows = controller.model.state.hanghoaduthaunhathau || [];
  const existingByKey = new Map(existingRows.map((row) => [
    `${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`,
    row,
  ]));
  const upsertGoods = preview.rows.map((row) => {
    const current = existingByKey.get(`${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`);
    return { ...row, id: current?.id || row.id, rowVersion: current?.rowVersion };
  });
  const upsertIds = new Set(upsertGoods.map((row) => String(row.id)));
  const deletedGoodsIds = existingRows
    .filter((row) => incomingScopes.has(String(row.thongTinMoThauId)))
    .filter((row) => !upsertIds.has(String(row.id)))
    .map((row) => row.id);
  const updatedOpenings = (controller.model.state.thongtinmothau || [])
    .filter((opening) => incomingScopes.has(String(opening.id)))
    .map((opening) => {
      const updated = { ...opening };
      invalidateOpeningPreference(updated);
      return updated;
    });
  const mutationIdentity = preview.rows[0]?.importBatchId
    || preview.rows.map((row) => String(row.id || "")).sort().join(",");
  const mutationId = `bidder-goods-import:${String(mutationIdentity)}`;
  const outcome = await workspaceDataStoreFor(controller).patch({
    mutationId,
    upserts: {
      hanghoaduthaunhathau: upsertGoods,
      thongtinmothau: updatedOpenings,
    },
    deletions: {
      hanghoaduthaunhathau: deletedGoodsIds,
    },
  });
  if (!["committed", "offlineQueued", "transportFailed"].includes(outcome.status)) {
    controller._bidderGoodsError = "Không thể lưu bản nháp nhập Excel.";
    controller.renderDetailedEvaluation();
    return false;
  }
  controller._bidderGoodsImportPreview = null;
  controller._bidderGoodsEditingId = "";
  controller._bidderGoodsError = "";
  controller._bidderGoodsSavedAt = new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  controller._detailedEvaluationDirty = false;
  controller.renderDetailedEvaluation();
  await controller.view.customAlert("Đã nhập dữ liệu", "Dữ liệu đã được lưu ở trạng thái bản nháp. Hãy kiểm tra đối chiếu trước khi lưu chính thức.", "check-circle");
  return true;
}

export async function saveBidderGoods(controller, detailedState, { official = false } = {}) {
  const rows = getBidderGoodsForBid(controller.model, detailedState.pkg, detailedState.bid)
    .map(withDerivedBidderGoodsFinancials);
  const requirements = getBidderGoodsRequirements(controller.model, detailedState.pkg, detailedState.bid);
  const invalidRowIndex = rows.findIndex((row) => validateBidderGoodsRow(row, { official }).length > 0);
  if (invalidRowIndex >= 0) {
    controller._bidderGoodsValidationScopeId = String(detailedState.bid.id || "");
    controller._bidderGoodsValidationOfficial = official;
    controller._bidderGoodsPage = Math.floor(invalidRowIndex / PAGE_SIZE) + 1;
    controller._bidderGoodsEditingId = String(rows[invalidRowIndex].id || "");
    await controller.renderDetailedEvaluation();
    const validationRoot = controller.view.getActiveElement?.("danhgiahsdt-detail-view");
    const firstInvalidControl = validationRoot?.querySelector?.('[aria-invalid="true"]');
    if (firstInvalidControl) {
      if (typeof controller.view.focusInvalidControl === "function") {
        controller.view.focusInvalidControl(firstInvalidControl);
      } else {
        firstInvalidControl.focus?.();
      }
    }
    return false;
  }
  if (official) {
    const validation = validateBidderGoodsSubmission({ rows, requirements, bidPrice: detailedState.bid.giaDuThau });
    if (!validation.valid) {
      await controller.view.customAlert("Chưa thể lưu chính thức", validation.errors[0], "alert-triangle");
      return false;
    }
  }
  let calculation = null;
  if (official) {
    try {
      calculation = calculateBidderGoodsPreference(rows, {
        discountRatePercent: String(detailedState.bid.tyLeGiamGia ?? 0),
        scopeAfterDiscount: detailedState.bid.giaSauGiamGia ?? null,
        evaluationBase: detailedState.bid.giaXepHang ?? null,
      });
    } catch (error) {
      await controller.view.customAlert("Chưa thể tính ưu đãi", error.message, "alert-triangle");
      return false;
    }
  }
  const scopeIds = new Set(rows.map((row) => String(row.id)));
  const snapshot = (controller.model.state.hanghoaduthaunhathau || []).map((row) => ({ ...row }));
  const bidPreferenceSnapshot = Object.fromEntries([
    "tongGiaTriCongUuDai",
    "giaSoSanhSauUuDai",
    "giaDanhGiaSauUuDai",
    "trangThaiTinhUuDai",
    "uuDaiTinhLuc",
    "uuDaiInputHash",
  ].map((field) => [field, detailedState.bid[field]]));
  if (!official) invalidateOpeningPreference(detailedState.bid);
  const derivedById = new Map(rows.map((row) => [String(row.id), row]));
  const calculatedById = new Map((calculation?.lines || []).map((row) => [String(row.id), row]));
  replaceTableProjection(controller.model, "hanghoaduthaunhathau", snapshot.map((row) => {
    if (!scopeIds.has(String(row.id))) return row;
    const derivedRow = derivedById.get(String(row.id));
    return {
      ...row,
      ...(derivedRow ? {
        thanhTienDuThau: derivedRow.thanhTienDuThau,
        giaDuThauSauUuDai: derivedRow.giaDuThauSauUuDai,
        thanhTienSauUuDai: derivedRow.thanhTienSauUuDai,
      } : {}),
      ...(calculatedById.get(String(row.id)) || {}),
      isDraft: !official,
      trangThaiUuDai: official
        ? "ready"
        : (
          ["ready", "stale"].includes(row.trangThaiUuDai)
          || ["ready", "stale"].includes(bidPreferenceSnapshot.trangThaiTinhUuDai)
        )
          ? "stale"
          : "draft",
    };
  }));
  if (official && calculation) {
    Object.assign(detailedState.bid, {
      tongGiaTriCongUuDai: calculation.tongGiaTriCongUuDai,
      giaSoSanhSauUuDai: calculation.giaSoSanhSauUuDai,
      giaDanhGiaSauUuDai: calculation.giaDanhGiaSauUuDai,
      trangThaiTinhUuDai: "ready",
      uuDaiTinhLuc: new Date().toISOString(),
    });
  }
  await controller.model.markRecordDirty?.(
    "hanghoaduthaunhathau",
    controller.model.state.hanghoaduthaunhathau.filter(
      (row) => scopeIds.has(String(row.id)),
    ),
  );
  await controller.model.markRecordDirty?.("thongtinmothau", detailedState.bid);
  const buttons = controller.view.getActiveElement?.("danhgiahsdt-detail-view")?.querySelectorAll?.("#btn-bidder-goods-save-draft, #btn-bidder-goods-save-official") || [];
  buttons.forEach((button) => { button.disabled = true; });
  const result = await persistAndSync(
    controller,
    ["hanghoaduthaunhathau", "thongtinmothau"],
    {
      changes: {
        upserts: {
          hanghoaduthaunhathau: controller.model.state.hanghoaduthaunhathau.filter(
            (row) => scopeIds.has(String(row.id)),
          ),
          thongtinmothau: [detailedState.bid],
        },
      },
    },
  );
  if (result?.ok === false) {
    replaceTableProjection(controller.model, "hanghoaduthaunhathau", snapshot);
    Object.assign(detailedState.bid, bidPreferenceSnapshot);
    await controller.model.db?.putTableData?.("hanghoaduthaunhathau", snapshot);
    await controller.model.db?.putTableData?.(
      "thongtinmothau",
      controller.model.state.thongtinmothau || [],
    );
    controller._bidderGoodsError = "Không thể đồng bộ hàng hóa dự thầu. Dữ liệu trước khi lưu đã được khôi phục.";
    buttons.forEach((button) => { button.disabled = false; });
    controller.renderDetailedEvaluation();
    return false;
  }
  controller._bidderGoodsError = "";
  controller._detailedEvaluationDirty = false;
  controller._bidderGoodsValidationScopeId = "";
  controller._bidderGoodsValidationOfficial = false;
  controller._bidderGoodsEditingId = "";
  controller._bidderGoodsSavedAt = new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  controller.renderDetailedEvaluation();
  return true;
}

export function bindBidderGoodsPanel(controller, detailedState, root) {
  const state = buildBidderGoodsPanelState(controller, detailedState);
  root.querySelector("#btn-bidder-goods-import")?.addEventListener("click", () => root.querySelector("#bidder-goods-excel-input")?.click());
  root.querySelector("#bidder-goods-excel-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await importBidderGoodsExcel(controller, detailedState, file);
    event.target.value = "";
  });
  root.querySelector("#btn-bidder-goods-preview-confirm")?.addEventListener("click", () => confirmBidderGoodsImport(controller));
  root.querySelector("#btn-bidder-goods-preview-cancel")?.addEventListener("click", () => {
    controller._bidderGoodsImportPreview = null;
    controller._bidderGoodsError = "";
    controller._detailedEvaluationDirty = false;
    controller.renderDetailedEvaluation();
  });
  const exportMenu = root.querySelector(".bidder-goods-export-menu");
  root.querySelector("#btn-bidder-goods-template")?.addEventListener("click", () => {
    exportMenu?.removeAttribute("open");
    downloadBidderGoodsTemplate(state.pkg, state.requirements);
  });
  root.querySelector("#btn-bidder-goods-export")?.addEventListener("click", () => {
    exportMenu?.removeAttribute("open");
    downloadBidderGoodsWorkbook(state.pkg, state.rows);
  });
  exportMenu?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    exportMenu.removeAttribute("open");
    exportMenu.querySelector("summary")?.focus();
  });
  root.addEventListener?.("click", (event) => {
    if (exportMenu?.open && !exportMenu.contains(event.target)) {
      exportMenu.removeAttribute("open");
    }
  });
  root.querySelector("#btn-bidder-goods-add")?.addEventListener("click", () => {
    const used = new Set(state.rows.map((row) => String(row.goiThauHangHoaId || "")));
    const requirement = state.requirements.find((item) => !used.has(String(item.id))) || state.requirements[0];
    if (!requirement) return;
    const rowId = generateRecordId("hanghoaduthaunhathau");
    controller.model.state.hanghoaduthaunhathau.push({
      id: rowId,
      goiThauId: state.pkg.id,
      thongTinMoThauId: state.bid.id,
      phanLoId: requirement.phanLoId || null,
      goiThauHangHoaId: requirement.id,
      sttNguon: String((requirement.sortOrder ?? state.rows.length) + 1),
      maPhanLoNguon: state.lot?.maPhanLo || "",
      tenPhanLoNguon: state.lot?.tenPhanLo || "",
      danhMucHangHoa: requirement.tenHangHoa || "",
      kyMaHieu: "", nhanHieu: "", namSanXuat: "", xuatXu: "", hangSanXuat: "",
      cauHinhTinhNangKyThuat: "", donViTinh: requirement.donViTinh || "",
      khoiLuong: Number(requirement.soLuong) || null, maHs: "",
      donGiaDuThau: null, thanhTienDuThau: null,
      mappingMethod: "manual", mappingStatus: "matched",
      sortOrder: state.rows.length, importBatchId: "", isDraft: true,
    });
    invalidateOpeningPreference(state.bid);
    controller._bidderGoodsEditingId = rowId;
    controller._detailedEvaluationDirty = true;
    controller.renderDetailedEvaluation();
  });
  root.querySelectorAll("[data-bidder-goods-open-mapping]").forEach((button) => {
    button.addEventListener("click", () => {
      const rowId = button.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      const row = state.rows.find((item) => String(item.id) === String(rowId));
      if (row) openBidderGoodsMappingModal(controller, state, row);
    });
  });
  root.querySelectorAll("[data-bidder-goods-edit]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.getAttribute("data-bidder-goods-edit") || "";
      if (!rowId || String(controller._bidderGoodsEditingId || "") === rowId) return;
      controller._bidderGoodsEditingId = rowId;
      await controller.renderDetailedEvaluation();
      const nextRoot = controller.view.getActiveElement?.("danhgiahsdt-detail-view");
      const editingRow = Array.from(nextRoot?.querySelectorAll?.("[data-bidder-goods-id]") || [])
        .find((candidate) => String(candidate.getAttribute("data-bidder-goods-id") || "") === rowId);
      editingRow?.querySelector?.("[data-bidder-goods-field]")?.focus?.();
    });
  });
  root.querySelectorAll("[data-bidder-goods-preference]").forEach((select) => {
    select.addEventListener("change", () => {
      const rowId = select.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      const actorId = controller.model.state.activeuser?.id || "";
      replaceTableProjection(controller.model, "hanghoaduthaunhathau", updateBidderGoodsPreferenceCode(
        controller.model.state.hanghoaduthaunhathau,
        rowId,
        select.value,
        { actorId },
      ));
      invalidateOpeningPreference(state.bid);
      controller._detailedEvaluationDirty = true;
      controller.renderDetailedEvaluation();
    });
  });
  root.querySelectorAll("[data-bidder-goods-nonnegative-money]").forEach((input) => {
    input.addEventListener("beforeinput", (event) => {
      if (event.data && /[^0-9]/.test(event.data)) event.preventDefault();
    });
    input.addEventListener("keydown", (event) => {
      if (["-", "+", "e", "E", ".", ","].includes(event.key)) event.preventDefault();
    });
    input.addEventListener("input", () => {
      const edit = formatBidderGoodsMoneyEdit(
        input.value, input.selectionStart ?? input.value.length,
      );
      if (input.value !== edit.formatted) input.value = edit.formatted;
      input.setSelectionRange?.(edit.caret, edit.caret);
      const rowElement = input.closest("[data-bidder-goods-id]");
      const rowId = rowElement?.getAttribute("data-bidder-goods-id") || "";
      const realtime = applyBidderGoodsUnitPriceInput(
        controller, detailedState, rowId, edit.digits,
      );
      updateBidderGoodsDerivedCells(rowElement, realtime?.row);
      if (realtime?.state) updateBidderGoodsSummary(root, realtime.state);
    });
  });
  root.querySelectorAll("[data-bidder-goods-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const rowId = input.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      const field = input.getAttribute("data-bidder-goods-field");
      if (!BIDDER_GOODS_EDITABLE_FIELDS.has(field)) return;
      const numeric = ["khoiLuong", "donGiaDuThau"].includes(field);
      const money = field === "donGiaDuThau";
      const rawValue = money ? sanitizeBidderGoodsMoneyInput(input.value) : input.value;
      const numericValue = Number(rawValue);
      const value = numeric
        ? rawValue === "" ? null
          : money && Number.isInteger(numericValue) && !Number.isSafeInteger(numericValue)
            ? rawValue
            : numericValue
        : rawValue;
      replaceTableProjection(controller.model, "hanghoaduthaunhathau", controller.model.state.hanghoaduthaunhathau.map(
        (row) => {
          if (String(row.id) !== String(rowId)) return row;
          const updated = { ...row, [field]: value, isDraft: true };
          return ["khoiLuong", "donGiaDuThau"].includes(field)
            ? withDerivedBidderGoodsFinancials(updated)
            : updated;
        },
      ));
      invalidateOpeningPreference(state.bid);
      controller._detailedEvaluationDirty = true;
      controller.renderDetailedEvaluation();
    });
  });
  const search = root.querySelector("#bidder-goods-search");
  const applySearch = async () => {
    if (search.value === String(controller._bidderGoodsSearch || "")) return;
    controller._bidderGoodsSearch = search.value;
    controller._bidderGoodsPage = 1;
    controller._detailedEvaluationDirty = false;
    const cursorPosition = search.selectionStart ?? search.value.length;
    await controller.renderDetailedEvaluation();
    const nextSearch = controller.view.getActiveElement?.("danhgiahsdt-detail-view")
      ?.querySelector?.("#bidder-goods-search");
    nextSearch?.focus?.({ preventScroll: true });
    nextSearch?.setSelectionRange?.(cursorPosition, cursorPosition);
  };
  search?.addEventListener("input", (event) => {
    if (event.isComposing) return;
    void applySearch();
  });
  search?.addEventListener("compositionend", () => { void applySearch(); });
  root.querySelectorAll("[data-bidder-goods-page]").forEach((button) => button.addEventListener("click", () => {
    const requestedPage = Number(button.dataset.bidderGoodsPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > state.pageCount || requestedPage === state.page) return;
    controller._bidderGoodsPage = requestedPage;
    controller.renderDetailedEvaluation();
  }));
  root.querySelector("#btn-bidder-goods-save-draft")?.addEventListener("click", () => saveBidderGoods(controller, detailedState));
  root.querySelector("#btn-bidder-goods-save-official")?.addEventListener("click", () => saveBidderGoods(controller, detailedState, { official: true }));
  controller.view.createIconsScoped?.(root);
}
