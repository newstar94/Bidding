import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { initAccessibleCombobox } from "../shared/accessibleCombobox.js";
import { getAppController } from "../app/controllerRef.js";
import { generateRecordId } from "../shared/idUtils.js";
import { beginExcelImportLoading } from "../shared/ExcelImportLoading.js";
import { downloadPackageGoodsWorkbook, buildPackageGoodsPreview, readPackageGoodsExcel } from "./PackageGoodsExcel.js";
import { isPackageGoodsDeletable, isPackageGoodsEditable, validatePackageGoodsItem } from "./packageGoodsValidation.js";
import { renderPackageSummary } from "./detail/PackageSummary.js";
import { TABLE_PAGE_SIZE } from "../shared/TablePagination.js";

function packageGoods(model, packageId) {
  return (model?.state?.goithauhanghoa || [])
    .filter((item) => String(item.goiThauId) === String(packageId))
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.id).localeCompare(String(right.id)));
}

function lotLabel(lot) {
  return [lot?.maPhanLo, lot?.tenPhanLo].filter(Boolean).join(" — ") || "Phần lô";
}

export function formatPackageGoodsQuantity(value) {
  if (value === "" || value == null || !Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(value));
}

export function refreshPackageGoodsIcons(view, root) {
  view?.createIconsScoped?.(root);
}

export function bindPackageGoodsLiveSearch(view, contentWrapper, rerender, { delay = 120 } = {}) {
  const searchInput = contentWrapper.querySelector("#package-goods-search");
  if (!searchInput) return;
  let composing = false;
  const scheduleSearch = () => {
    const value = searchInput.value;
    const cursorPosition = searchInput.selectionStart ?? value.length;
    view._packageGoodsSearch = value;
    view._packageGoodsPage = 1;
    clearTimeout(view._packageGoodsSearchTimer);
    view._packageGoodsSearchTimer = setTimeout(async () => {
      view._packageGoodsSearchTimer = null;
      if (searchInput.isConnected === false) return;
      const shouldRestoreFocus = searchInput.matches?.(":focus") === true;
      await rerender();
      if (!shouldRestoreFocus) return;
      const nextInput = contentWrapper.querySelector("#package-goods-search");
      nextInput?.focus?.({ preventScroll: true });
      const nextPosition = Math.min(cursorPosition, nextInput?.value?.length ?? 0);
      nextInput?.setSelectionRange?.(nextPosition, nextPosition);
    }, delay);
  };
  searchInput.addEventListener("compositionstart", () => { composing = true; });
  searchInput.addEventListener("compositionend", () => {
    composing = false;
    scheduleSearch();
  });
  searchInput.addEventListener("input", (event) => {
    if (composing || event.isComposing) return;
    scheduleSearch();
  });
}

export function buildPackageGoodsDisplayRows(goods, lots, { hasLots = true, allGoods = goods } = {}) {
  const items = Array.isArray(goods) ? goods : [];
  const completeItems = Array.isArray(allGoods) ? allGoods : items;
  const lotList = Array.isArray(lots) ? lots : [];
  if (!hasLots) {
    return items.map((item, index) => ({
      kind: "item",
      sequence: String(index + 1),
      item,
    }));
  }

  const lotById = new Map(lotList.map((lot) => [String(lot.id), lot]));
  const lotPosition = new Map(lotList.map((lot, index) => [String(lot.id), index + 1]));
  const grouped = new Map();
  items.forEach((item) => {
    const key = String(item.phanLoId || "");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });
  const completeGroupSizes = new Map();
  completeItems.forEach((item) => {
    const key = String(item.phanLoId || "");
    completeGroupSizes.set(key, (completeGroupSizes.get(key) || 0) + 1);
  });
  const orderedKeys = [
    ...lotList.map((lot) => String(lot.id)).filter((key) => grouped.has(key)),
    ...[...grouped.keys()].filter((key) => !lotById.has(key)),
  ];

  return orderedKeys.flatMap((key, groupIndex) => {
    const lot = lotById.get(key);
    const sequence = String(lotPosition.get(key) || groupIndex + 1);
    const groupItems = grouped.get(key) || [];
    const lotCode = String(lot?.maPhanLo || groupItems[0]?._lotCode || "").trim();
    const lotName = String(lot?.tenPhanLo || "Phần lô chưa xác định").trim();
    if ((completeGroupSizes.get(key) || groupItems.length) === 1 && groupItems.length === 1) {
      return [{
        kind: "item",
        sequence,
        item: groupItems[0],
        lotCode,
        lotName,
        lotId: key,
        singleItemLot: true,
      }];
    }
    return [
      {
        kind: "lot",
        sequence,
        lotCode,
        lotName,
        lotId: key,
      },
      ...groupItems.map((item, itemIndex) => ({
        kind: "item",
        sequence: `${sequence}.${itemIndex + 1}`,
        item,
      })),
    ];
  });
}

export function nextPackageGoodsSequence(goods, lots, { hasLots = true, lotId = "" } = {}) {
  const items = Array.isArray(goods) ? goods : [];
  if (!hasLots) return String(items.length + 1);
  const lotList = Array.isArray(lots) ? lots : [];
  const lotIndex = lotList.findIndex((lot) => String(lot.id) === String(lotId));
  if (lotIndex < 0) return "";
  const itemCount = items.filter((item) => String(item.phanLoId || "") === String(lotId)).length;
  return `${lotIndex + 1}.${itemCount + 1}`;
}

function nextPackageGoodsCode(goods, lotId, preferredCode) {
  const usedCodes = new Set((goods || [])
    .filter((item) => String(item.phanLoId || "") === String(lotId || ""))
    .map((item) => String(item.maHangHoa || "").trim().toLocaleLowerCase("vi")));
  const base = String(preferredCode || "1").trim();
  if (!usedCodes.has(base.toLocaleLowerCase("vi"))) return base;
  let suffix = 2;
  while (usedCodes.has(`${base}-${suffix}`.toLocaleLowerCase("vi"))) suffix += 1;
  return `${base}-${suffix}`;
}

export function renderPackageGoodsSummary(view, pkg, { editable = true } = {}) {
  const plan = view?.model?.getLatestPlan?.(pkg?.keHoachId) || null;
  const investor = plan
    ? (view?.model?.state?.chudautu || []).find(
      (item) => String(item.id) === String(plan.chuDauTuId),
    )
    : null;
  return renderPackageSummary({
    pkg,
    planName: plan?.tenKeHoach || "Không rõ",
    investorName: investor?.tenChuDauTu || "Không rõ",
    formatCurrency: (value) => view?.model?.formatCurrency?.(value) || "--",
    formatDateTime: (value) => view?.model?.formatDateWithTime?.(value) || "--",
    lockedMessage: editable
      ? ""
      : `Chỉ đọc vì gói thầu đang ở trạng thái ${pkg?.trangThai || "không cho phép sửa"}`,
  });
}

export function renderPackageGoodsMutationActions(editable, { creating = false } = {}) {
  if (!editable) return "";
  return `
    <input id="package-goods-file" type="file" accept=".xlsx,.xls" hidden>
    <button type="button" class="btn btn-outline" id="btn-package-goods-import-trigger"><i data-lucide="upload" aria-hidden="true"></i>Nhập Excel</button>
    <button type="button" class="btn btn-primary" id="btn-package-goods-add" aria-controls="package-goods-table-body" aria-expanded="${creating}"><i data-lucide="plus" aria-hidden="true"></i>Thêm hàng hóa</button>`;
}

export function renderPackageGoodsRowActions({ id, editable, canDelete }) {
  if (!editable) return "";
  return `<td class="package-goods-actions-cell"><div class="action-btn-group"><button type="button" class="action-btn btn-edit" data-edit-goods="${escapeHtml(id)}" title="Sửa hàng hóa" aria-label="Sửa hàng hóa"><i data-lucide="pencil" aria-hidden="true"></i></button>${canDelete ? `<button type="button" class="action-btn btn-delete" data-delete-goods="${escapeHtml(id)}" title="Xóa hàng hóa" aria-label="Xóa hàng hóa"><i data-lucide="trash-2" aria-hidden="true"></i></button>` : ""}</div></td>`;
}

export function packageGoodsLotComboboxConfig() {
  return {
    searchable: true,
    openOnFocus: false,
    placeholder: "Tìm mã hoặc tên phần lô",
    noResultsText: "Không tìm thấy phần lô phù hợp",
  };
}

export function renderPackageGoodsInlineEditRow(item, lots, { hasLotColumns = true, sequence = "" } = {}) {
  const lotOptions = (lots || []).map((lot) => `<option value="${escapeHtml(lot.id)}" ${String(item.phanLoId || "") === String(lot.id) ? "selected" : ""}>${escapeHtml(lotLabel(lot))}</option>`).join("");
  return `<tr class="package-goods-item-row package-goods-item-row--editing" data-inline-edit-row="${escapeHtml(item.id)}" aria-label="Chỉnh sửa hàng hóa ${escapeHtml(item.maHangHoa || "")}">
    <td class="package-goods-sequence" aria-label="Số thứ tự ${escapeHtml(sequence)}">${escapeHtml(sequence)}</td>
    ${hasLotColumns ? `<td colspan="2"><select id="package-goods-lot-edit-${escapeHtml(item.id)}" class="form-control package-goods-inline-control" name="phanLoId" data-no-custom="true" aria-label="Phần lô" required><option value="">Chọn phần lô</option>${lotOptions}</select></td>` : ""}
    <td><textarea class="form-control package-goods-inline-control package-goods-inline-name" name="tenHangHoa" aria-label="Danh mục hàng hóa" rows="2" required>${escapeHtml(item.tenHangHoa || "")}</textarea></td>
    <td class="package-goods-unit"><input class="form-control package-goods-inline-control package-goods-inline-unit" name="donViTinh" value="${escapeHtml(item.donViTinh || "")}" aria-label="Đơn vị tính" required></td>
    <td><input class="form-control package-goods-inline-control package-goods-inline-number" name="soLuong" type="number" min="0.0001" step="any" value="${escapeHtml(item.soLuong ?? "")}" aria-label="Khối lượng" required></td>
    <td class="package-goods-actions-cell"><div class="package-goods-inline-actions"><button type="button" class="action-btn btn-edit package-goods-inline-action package-goods-inline-action--save" data-save-goods="${escapeHtml(item.id)}" title="Lưu hàng hóa" aria-label="Lưu hàng hóa"><i data-lucide="save" aria-hidden="true"></i></button><button type="button" class="action-btn btn-delete package-goods-inline-action package-goods-inline-action--cancel" data-cancel-goods="${escapeHtml(item.id)}" title="Hủy chỉnh sửa" aria-label="Hủy chỉnh sửa"><i data-lucide="x" aria-hidden="true"></i></button></div></td>
  </tr>`;
}

export function renderPackageGoodsInlineCreateRow(lots, { hasLotColumns = true, selectedLotId = "", sequence = "" } = {}) {
  const lotOptions = (lots || []).map((lot) => `<option value="${escapeHtml(lot.id)}" ${String(selectedLotId) === String(lot.id) ? "selected" : ""}>${escapeHtml(lotLabel(lot))}</option>`).join("");
  return `<tr class="package-goods-item-row package-goods-item-row--editing package-goods-item-row--creating" data-inline-create-row aria-label="Thêm hàng hóa">
    <td class="package-goods-sequence" data-create-sequence aria-label="Số thứ tự ${escapeHtml(sequence)}">${escapeHtml(sequence)}</td>
    ${hasLotColumns ? `<td colspan="2"><select id="package-goods-lot-create" class="form-control package-goods-inline-control" name="phanLoId" data-no-custom="true" data-create-lot aria-label="Phần lô" required><option value="">Chọn phần lô</option>${lotOptions}</select></td>` : ""}
    <td><textarea class="form-control package-goods-inline-control package-goods-inline-name" name="tenHangHoa" aria-label="Danh mục hàng hóa" rows="2" required></textarea></td>
    <td class="package-goods-unit"><input class="form-control package-goods-inline-control package-goods-inline-unit" name="donViTinh" aria-label="Đơn vị tính" required></td>
    <td><input class="form-control package-goods-inline-control package-goods-inline-number" name="soLuong" type="number" min="0.0001" step="any" aria-label="Khối lượng" required></td>
    <td class="package-goods-actions-cell"><div class="package-goods-inline-actions"><button type="button" class="action-btn btn-edit package-goods-inline-action package-goods-inline-action--save" data-save-new-goods title="Lưu hàng hóa" aria-label="Lưu hàng hóa"><i data-lucide="save" aria-hidden="true"></i></button><button type="button" class="action-btn btn-delete package-goods-inline-action package-goods-inline-action--cancel" data-cancel-new-goods title="Hủy thêm mới" aria-label="Hủy thêm mới"><i data-lucide="x" aria-hidden="true"></i></button></div></td>
  </tr>`;
}

function operationLabel(value) {
  return { create: "Thêm mới", update: "Cập nhật", unchanged: "Không thay đổi", invalid: "Không hợp lệ" }[value] || value;
}

export function packageGoodsPaginationPages(currentPage, totalPages, maxVisiblePages = 5) {
  const safeTotal = Math.max(1, Number(totalPages) || 1);
  const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage) || 1));
  const visibleCount = Math.max(1, Number(maxVisiblePages) || 1);
  let startPage = Math.max(1, safeCurrent - Math.floor(visibleCount / 2));
  const endPage = Math.min(safeTotal, startPage + visibleCount - 1);
  startPage = Math.max(1, endPage - visibleCount + 1);
  return Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index);
}

async function persistImport(model, pkg, preview, { mode, selectedLotId }) {
  if (preview.some((item) => !item._valid)) throw new Error("Không thể lưu khi còn dòng không hợp lệ.");
  const current = packageGoods(model, pkg.id);
  const importedKeys = new Set(preview.map((item) => `${item.phanLoId || ""}::${String(item.maHangHoa || "").trim().toLocaleLowerCase("vi")}`));
  const replaceScope = mode === "replace";
  const deleted = replaceScope ? current.filter((item) => {
    if (selectedLotId && String(item.phanLoId) !== String(selectedLotId)) return false;
    const key = `${item.phanLoId || ""}::${String(item.maHangHoa || "").trim().toLocaleLowerCase("vi")}`;
    return !importedKeys.has(key);
  }) : [];
  const upserts = preview.filter((item) => item._operation !== "unchanged").map((item) => {
    const record = { ...item };
    ["_operation", "_valid", "_comment", "_rowNumber", "_lotCode"].forEach((key) => delete record[key]);
    return record;
  });
  const deletedIds = new Set(deleted.map((item) => String(item.id)));
  const upsertById = new Map(upserts.map((item) => [String(item.id), item]));
  model.replaceTableState("goithauhanghoa", (model.state.goithauhanghoa || [])
    .filter((item) => !deletedIds.has(String(item.id)))
    .map((item) => upsertById.get(String(item.id)) || item));
  upserts.forEach((item) => {
    if (!model.state.goithauhanghoa.some((currentItem) => String(currentItem.id) === String(item.id))) model.state.goithauhanghoa.push(item);
  });
  await model.db.applySyncChanges({ upserts: { goithauhanghoa: upserts }, deletions: { goithauhanghoa: [...deletedIds] } });
  if (upserts.length) model.markRecordDirty("goithauhanghoa", upserts);
  if (deleted.length) model.markDeleted("goithauhanghoa", deleted);
  return { upserts, deleted };
}

function renderPreview(container, rows, lots) {
  const hasLots = Array.isArray(lots) && lots.length > 0;
  const displayRows = buildPackageGoodsDisplayRows(rows, lots, { hasLots });
  const columnCount = (hasLots ? 6 : 4) + 4;
  container.innerHTML = trustedHTML(`
    <div class="table-responsive"><table class="data-table package-goods-hierarchy-table package-goods-preview-table" data-no-sort="true" data-row-pagination="true" aria-label="Xem trước danh mục hàng hóa nhập từ Excel">
      <thead><tr><th>STT</th>${hasLots ? "<th>Mã phần (lô)</th><th>Tên phần lô</th>" : ""}<th>Danh mục hàng hóa</th><th class="package-goods-unit">Đơn vị tính</th><th class="package-goods-quantity">Khối lượng</th><th>Dòng Excel</th><th>Thao tác dự kiến</th><th>Trạng thái</th><th>Chi tiết lỗi</th></tr></thead>
      <tbody>${displayRows.map((displayRow) => displayRow.kind === "lot" ? `<tr class="package-goods-lot-row">
        <td>${escapeHtml(displayRow.sequence)}</td><td>${escapeHtml(displayRow.lotCode)}</td><td>${escapeHtml(displayRow.lotName)}</td><td colspan="${columnCount - 3}"></td>
      </tr>` : `<tr class="package-goods-item-row">
        <td class="package-goods-sequence">${escapeHtml(displayRow.sequence)}</td>${hasLots ? `<td>${escapeHtml(displayRow.lotCode || "")}</td><td>${escapeHtml(displayRow.lotName || "")}</td>` : ""}
        <td>${escapeHtml(displayRow.item.tenHangHoa)}</td><td class="package-goods-unit">${escapeHtml(displayRow.item.donViTinh)}</td><td class="package-goods-quantity">${escapeHtml(formatPackageGoodsQuantity(displayRow.item.soLuong))}</td>
        <td>${displayRow.item._rowNumber || ""}</td><td>${escapeHtml(operationLabel(displayRow.item._operation))}</td><td>${displayRow.item._valid ? "Hợp lệ" : "Lỗi"}</td><td>${escapeHtml(displayRow.item._comment || "")}</td>
      </tr>`).join("")}</tbody>
    </table></div>`);
}

function bindEditor(view, root, pkg, lots, editable, rerender) {
  const addButton = root.querySelector("#btn-package-goods-add");
  addButton?.addEventListener("click", async () => {
    if (!editable) return;
    view._packageGoodsEditingId = null;
    view._packageGoodsCreating = true;
    if (pkg.phanLo === "Có") {
      view._packageGoodsCreateLotId = view._packageGoodsLotFilter || view._packageGoodsCreateLotId || lots[0]?.id || "";
    }
    await rerender();
  });
  root.querySelectorAll("[data-edit-goods]").forEach((button) => button.addEventListener("click", async () => {
    view._packageGoodsCreating = false;
    view._packageGoodsEditingId = button.dataset.editGoods;
    await rerender();
  }));
  root.querySelectorAll("[data-cancel-goods]").forEach((button) => button.addEventListener("click", async () => {
    const recordId = button.dataset.cancelGoods;
    view._packageGoodsEditingId = null;
    await rerender();
    root.querySelector(`[data-edit-goods="${CSS.escape(recordId)}"]`)?.focus();
  }));
  root.querySelector("[data-cancel-new-goods]")?.addEventListener("click", async () => {
    view._packageGoodsCreating = false;
    await rerender();
    root.querySelector("#btn-package-goods-add")?.focus();
  });
  root.querySelectorAll("[data-save-goods]").forEach((button) => button.addEventListener("click", async () => {
    const recordId = button.dataset.saveGoods;
    const row = button.closest("[data-inline-edit-row]");
    const current = (view.model.state.goithauhanghoa || []).find((item) => String(item.id) === String(recordId));
    if (!row || !current) return;
    const fieldValue = (name) => String(row.querySelector(`[name="${name}"]`)?.value ?? "").trim();
    const record = {
      ...current,
      phanLoId: pkg.phanLo === "Có" ? fieldValue("phanLoId") : null,
      tenHangHoa: fieldValue("tenHangHoa"),
      donViTinh: fieldValue("donViTinh"),
      soLuong: Number(fieldValue("soLuong")),
    };
    const errors = validatePackageGoodsItem(record, { pkg, lots });
    const duplicate = packageGoods(view.model, pkg.id).find((item) => item.id !== record.id && item.phanLoId === record.phanLoId && String(item.maHangHoa).trim().toLocaleLowerCase("vi") === record.maHangHoa.toLocaleLowerCase("vi"));
    if (duplicate) errors.push("Mã hàng hóa đã tồn tại trong cùng phạm vi.");
    if (errors.length) return view.customAlert("Dữ liệu không hợp lệ", errors.join(" "), "alert-triangle");
    await view.model.updateRecord("goithauhanghoa", record);
    const result = await getAppController()?.autoSync?.();
    if (!result?.ok) return view.customAlert("Lỗi đồng bộ", "Dữ liệu đã lưu cục bộ nhưng máy chủ chưa xác nhận. Hãy xử lý lỗi đồng bộ trước khi tiếp tục.", "alert-triangle");
    view._packageGoodsEditingId = null;
    await rerender();
    root.querySelector(`[data-edit-goods="${CSS.escape(recordId)}"]`)?.focus();
  }));
  const createRow = root.querySelector("[data-inline-create-row]");
  createRow?.querySelector("[data-create-lot]")?.addEventListener("change", (event) => {
    view._packageGoodsCreateLotId = event.target.value;
    const sequence = nextPackageGoodsSequence(packageGoods(view.model, pkg.id), lots, {
      hasLots: true,
      lotId: event.target.value,
    });
    const sequenceCell = createRow.querySelector("[data-create-sequence]");
    if (sequenceCell) {
      sequenceCell.textContent = sequence;
      sequenceCell.setAttribute("aria-label", `Số thứ tự ${sequence}`);
    }
  });
  createRow?.querySelector("[data-save-new-goods]")?.addEventListener("click", async () => {
    const fieldValue = (name) => String(createRow.querySelector(`[name="${name}"]`)?.value ?? "").trim();
    const allGoods = packageGoods(view.model, pkg.id);
    const phanLoId = pkg.phanLo === "Có" ? fieldValue("phanLoId") : null;
    const sequence = nextPackageGoodsSequence(allGoods, lots, { hasLots: pkg.phanLo === "Có", lotId: phanLoId });
    const record = {
      id: generateRecordId("goithauhanghoa"),
      goiThauId: pkg.id,
      phanLoId,
      maHangHoa: nextPackageGoodsCode(allGoods, phanLoId, sequence),
      tenHangHoa: fieldValue("tenHangHoa"),
      nhomHangHoa: "",
      donViTinh: fieldValue("donViTinh"),
      soLuong: Number(fieldValue("soLuong")),
      yeuCauKyThuat: "",
      kyMaHieuThamChieu: "",
      xuatXuYeuCau: "",
      diaDiemGiaoHang: "",
      thoiGianGiaoHang: "",
      donGiaDuToan: null,
      thanhTienDuToan: null,
      ghiChu: "",
      sortOrder: allGoods.length,
    };
    const errors = validatePackageGoodsItem(record, { pkg, lots });
    if (errors.length) return view.customAlert("Dữ liệu không hợp lệ", errors.join(" "), "alert-triangle");
    await view.model.addRecord("goithauhanghoa", record);
    const result = await getAppController()?.autoSync?.();
    if (!result?.ok) return view.customAlert("Lỗi đồng bộ", "Dữ liệu đã lưu cục bộ nhưng máy chủ chưa xác nhận. Hãy xử lý lỗi đồng bộ trước khi tiếp tục.", "alert-triangle");
    view._packageGoodsCreating = false;
    await rerender();
    root.querySelector("#btn-package-goods-add")?.focus();
  });
  const inlineRow = root.querySelector("[data-inline-edit-row], [data-inline-create-row]");
  const inlineLotSelect = inlineRow?.querySelector('[name="phanLoId"]');
  if (inlineLotSelect) {
    view._packageGoodsLotCombobox = initAccessibleCombobox(
      inlineLotSelect,
      packageGoodsLotComboboxConfig(),
    );
  }
  inlineRow?.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      inlineRow.querySelector("[data-cancel-goods], [data-cancel-new-goods]")?.click();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      inlineRow.querySelector("[data-save-goods], [data-save-new-goods]")?.click();
    }
  });
  inlineRow?.querySelector('[name="tenHangHoa"]')?.focus();
  root.querySelectorAll("[data-delete-goods]").forEach((button) => button.addEventListener("click", async () => {
    if (!editable || !await view.customConfirm("Xóa hàng hóa", "Bạn có chắc muốn xóa hàng hóa này?", "trash-2")) return;
    await view.model.deleteRecord("goithauhanghoa", button.dataset.deleteGoods);
    const result = await getAppController()?.autoSync?.();
    if (!result?.ok) await view.customAlert("Lỗi đồng bộ", "Hàng hóa đang chờ đồng bộ; máy chủ chưa xác nhận thao tác xóa.", "alert-triangle");
    await rerender();
  }));
}

export async function renderPackageGoodsPanel(view, { contentWrapper, pkg }) {
  view._packageGoodsLotCombobox?.destroy?.();
  view._packageGoodsLotCombobox = null;
  const lots = Array.isArray(pkg.phanLoList) ? pkg.phanLoList : [];
  const allGoods = packageGoods(view.model, pkg.id);
  const editable = isPackageGoodsEditable(pkg) && view.model.hasPermission?.(view.model.state.activeuser?.id, "goithau", "edit") !== false;
  const personalWorkspace = String(view.model.workspaceScope?.organizationId || view.model.workspaceScope?.key || "").includes("personal:");
  const canDelete = isPackageGoodsDeletable(pkg)
    && editable
    && (personalWorkspace || view.model.state.activerole !== "employee");
  const selected = String(view._packageGoodsLotFilter || "");
  const search = String(view._packageGoodsSearch || "").trim().toLocaleLowerCase("vi");
  const scoped = allGoods.filter((item) => !selected || String(item.phanLoId) === selected);
  const filtered = scoped.filter((item) => !search || [item.maHangHoa, item.tenHangHoa, item.nhomHangHoa, item.donViTinh].some((value) => String(value || "").toLocaleLowerCase("vi").includes(search)));
  const pageSize = TABLE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number(view._packageGoodsPage || 1)));
  const visibleGoods = filtered.slice((page - 1) * pageSize, page * pageSize);
  const hasLotColumns = pkg.phanLo === "Có";
  const displayRows = buildPackageGoodsDisplayRows(visibleGoods, lots, {
    hasLots: hasLotColumns,
    allGoods,
  });
  const editingId = editable ? String(view._packageGoodsEditingId || "") : "";
  const columnCount = (hasLotColumns ? 6 : 4) + (editable ? 1 : 0);
  const startIndex = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, filtered.length);
  const paginationPages = packageGoodsPaginationPages(page, pageCount);
  const creating = editable && Boolean(view._packageGoodsCreating);
  const createLotId = hasLotColumns
    ? String(view._packageGoodsCreateLotId || selected || lots[0]?.id || "")
    : "";
  const createSequence = nextPackageGoodsSequence(allGoods, lots, {
    hasLots: hasLotColumns,
    lotId: createLotId,
  });
  const tableRows = displayRows.map((displayRow) => ({
    displayRow,
    markup: displayRow.kind === "lot"
      ? `<tr class="package-goods-lot-row"><td>${escapeHtml(displayRow.sequence)}</td><td>${escapeHtml(displayRow.lotCode)}</td><td>${escapeHtml(displayRow.lotName)}</td><td colspan="${columnCount - 3}"></td></tr>`
      : String(displayRow.item.id) === editingId
        ? renderPackageGoodsInlineEditRow(displayRow.item, lots, { hasLotColumns, sequence: displayRow.sequence })
        : `<tr class="package-goods-item-row"><td class="package-goods-sequence">${escapeHtml(displayRow.sequence)}</td>${hasLotColumns ? `<td>${escapeHtml(displayRow.lotCode || "")}</td><td>${escapeHtml(displayRow.lotName || "")}</td>` : ""}<td class="package-goods-name">${escapeHtml(displayRow.item.tenHangHoa)}</td><td class="package-goods-unit">${escapeHtml(displayRow.item.donViTinh)}</td><td class="package-goods-quantity">${escapeHtml(formatPackageGoodsQuantity(displayRow.item.soLuong))}</td>${renderPackageGoodsRowActions({ id: displayRow.item.id, editable, canDelete })}</tr>`,
  }));
  if (creating) {
    const createMarkup = renderPackageGoodsInlineCreateRow(lots, {
      hasLotColumns,
      selectedLotId: createLotId,
      sequence: createSequence,
    });
    let insertionIndex = tableRows.length;
    if (hasLotColumns && createLotId) {
      const lastItemIndex = tableRows.findLastIndex(({ displayRow }) => displayRow.kind === "item" && String(displayRow.item.phanLoId || "") === createLotId);
      const lotHeadingIndex = tableRows.findIndex(({ displayRow }) => displayRow.kind === "lot" && String(displayRow.lotId || "") === createLotId);
      insertionIndex = lastItemIndex >= 0 ? lastItemIndex + 1 : lotHeadingIndex >= 0 ? lotHeadingIndex + 1 : tableRows.length;
    }
    tableRows.splice(insertionIndex, 0, { displayRow: null, markup: createMarkup });
  }
  const tableBodyMarkup = tableRows.length
    ? tableRows.map(({ markup }) => markup).join("")
    : `<tr class="package-goods-empty-row"><td colspan="${columnCount}"><div class="package-goods-empty"><i data-lucide="package-search" aria-hidden="true"></i><span>Chưa có hàng hóa trong phạm vi này.</span></div></td></tr>`;
  contentWrapper.innerHTML = trustedHTML(`
    <section class="package-goods-panel" aria-labelledby="package-goods-title">
      ${renderPackageGoodsSummary(view, pkg, { editable })}
      <header class="package-section-header package-goods-toolbar">
        <div class="package-goods-heading">
          <h4 class="package-section-title is-neutral package-goods-title" id="package-goods-title">Danh mục hàng hóa</h4>
          <p class="package-goods-summary">${allGoods.length} mặt hàng</p>
        </div>
        <div class="compact-action-group package-goods-actions">
          <label class="package-goods-search" for="package-goods-search">
            <span class="visually-hidden">Tìm hàng hóa</span><i data-lucide="search" aria-hidden="true"></i>
            <input class="form-control" id="package-goods-search" type="search" value="${escapeHtml(view._packageGoodsSearch || "")}" placeholder="Tìm mã hoặc tên hàng hóa">
          </label>
          ${pkg.phanLo === "Có" ? `<label class="package-goods-filter" for="package-goods-lot-filter"><span class="visually-hidden">Lọc theo phần lô</span><select class="form-control" id="package-goods-lot-filter" data-dropdown-inline="true"><option value="">Tất cả phần lô</option>${lots.map((lot) => `<option value="${escapeHtml(lot.id)}" ${selected === String(lot.id) ? "selected" : ""}>${escapeHtml(lotLabel(lot))}</option>`).join("")}</select></label>` : ""}
          <button type="button" class="btn btn-outline" id="btn-package-goods-template"><i data-lucide="download" aria-hidden="true"></i>Tải file mẫu</button>
          <button type="button" class="btn btn-outline" id="btn-package-goods-export"><i data-lucide="file-spreadsheet" aria-hidden="true"></i>Xuất Excel</button>
          ${renderPackageGoodsMutationActions(editable, { creating })}
        </div>
      </header>
      <div class="table-container package-goods-table"><table class="data-table package-goods-hierarchy-table" data-no-sort="true"><colgroup><col class="package-goods-col-sequence">${hasLotColumns ? '<col class="package-goods-col-lot-code"><col class="package-goods-col-lot-name">' : ""}<col class="package-goods-col-name"><col class="package-goods-col-unit"><col class="package-goods-col-quantity">${editable ? '<col class="package-goods-col-actions">' : ""}</colgroup><thead><tr><th>STT</th>${hasLotColumns ? "<th>Mã phần (lô)</th><th>Tên phần lô</th>" : ""}<th>Danh mục hàng hóa</th><th class="package-goods-unit">Đơn vị tính</th><th class="package-goods-quantity">Khối lượng</th>${editable ? "<th>Thao tác</th>" : ""}</tr></thead>
      <tbody id="package-goods-table-body">${tableBodyMarkup}</tbody></table></div>
      <nav class="pagination-container package-goods-pagination" aria-label="Phân trang danh mục hàng hóa"><span class="pagination-info">Hiển thị <strong>${startIndex}-${endIndex}</strong> trên tổng số <strong>${filtered.length}</strong> bản ghi</span><div class="pagination-buttons">
        <button type="button" class="pagination-btn" data-package-goods-page="1" title="Trang đầu" aria-label="Trang đầu" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevrons-left" aria-hidden="true"></i></button>
        <button type="button" class="pagination-btn" data-package-goods-page="${Math.max(1, page - 1)}" title="Trang trước" aria-label="Trang trước" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button>
        ${paginationPages.map((pageNumber) => `<button type="button" class="pagination-btn ${pageNumber === page ? "active" : ""}" data-package-goods-page="${pageNumber}" ${pageNumber === page ? 'aria-current="page"' : ""} aria-label="Trang ${pageNumber}">${pageNumber}</button>`).join("")}
        <button type="button" class="pagination-btn" data-package-goods-page="${Math.min(pageCount, page + 1)}" title="Trang sau" aria-label="Trang sau" ${page >= pageCount ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>
        <button type="button" class="pagination-btn" data-package-goods-page="${pageCount}" title="Trang cuối" aria-label="Trang cuối" ${page >= pageCount ? "disabled" : ""}><i data-lucide="chevrons-right" aria-hidden="true"></i></button>
      </div></nav>
      <section id="package-goods-import" hidden><div class="package-goods-import-controls"><label>Chế độ<select class="form-control" id="package-goods-import-mode"><option value="merge">Gộp dữ liệu</option><option value="replace">Thay thế toàn bộ phạm vi</option></select></label><button class="btn btn-primary" id="btn-package-goods-import-save">Lưu dữ liệu hợp lệ</button></div><div id="package-goods-preview"></div></section>
    </section>`);

  refreshPackageGoodsIcons(view, contentWrapper);

  const rerender = () => renderPackageGoodsPanel(view, { contentWrapper, pkg });
  contentWrapper.querySelector("#package-goods-lot-filter")?.addEventListener("change", async (event) => { view._packageGoodsLotFilter = event.target.value; view._packageGoodsPage = 1; await rerender(); });
  bindPackageGoodsLiveSearch(view, contentWrapper, rerender);
  contentWrapper.querySelectorAll("[data-package-goods-page]").forEach((button) => button.addEventListener("click", async () => {
    const requestedPage = Number(button.dataset.packageGoodsPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > pageCount || requestedPage === page) return;
    view._packageGoodsPage = requestedPage;
    await rerender();
  }));
  contentWrapper.querySelector("#btn-package-goods-template")?.addEventListener("click", () => downloadPackageGoodsWorkbook(pkg, [], { template: true, selectedLotId: selected }));
  contentWrapper.querySelector("#btn-package-goods-export")?.addEventListener("click", () => downloadPackageGoodsWorkbook(pkg, allGoods, { selectedLotId: selected }));
  bindEditor(view, contentWrapper, pkg, lots, editable, rerender);

  const fileInput = contentWrapper.querySelector("#package-goods-file");
  contentWrapper.querySelector("#btn-package-goods-import-trigger")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    const loading = await beginExcelImportLoading({ fileName: file.name });
    try {
      const imported = await readPackageGoodsExcel(file, { pkg, selectedLotId: selected });
      await loading.update(
        "validate",
        "File đã được đọc. Hệ thống đang kiểm tra mã hàng hóa và phạm vi phần lô.",
      );
      const preview = buildPackageGoodsPreview(imported, allGoods, { pkg });
      await loading.update(
        "preview",
        "Danh mục hàng hóa đang được chuẩn bị để bạn kiểm tra trước khi lưu.",
      );
      view._packageGoodsImportPreview = preview;
      const section = contentWrapper.querySelector("#package-goods-import"); section.hidden = false;
      renderPreview(contentWrapper.querySelector("#package-goods-preview"), preview, lots);
    } catch (error) {
      await view.customAlert("Không thể đọc Excel", error?.message || "Tệp Excel không hợp lệ.", "alert-triangle");
    } finally {
      fileInput.value = "";
      await loading.close();
    }
  });
  contentWrapper.querySelector("#btn-package-goods-import-save")?.addEventListener("click", async () => {
    const preview = view._packageGoodsImportPreview || [];
    if (!preview.length || preview.some((item) => !item._valid)) return view.customAlert("Chưa thể lưu", "Hãy sửa toàn bộ dòng lỗi trước khi lưu.", "alert-triangle");
    const mode = contentWrapper.querySelector("#package-goods-import-mode")?.value || "merge";
    if (mode === "replace" && !await view.customConfirm("Thay thế danh mục", "Các hàng hóa không có trong file ở đúng phạm vi đang nhập sẽ bị xóa. Tiếp tục?", "alert-triangle")) return;
    try {
      await persistImport(view.model, pkg, preview, { mode, selectedLotId: selected });
      const result = await getAppController()?.autoSync?.();
      if (!result?.ok) throw new Error("Máy chủ chưa xác nhận batch import; dữ liệu vẫn nằm trong hàng đợi đồng bộ.");
      view._packageGoodsImportPreview = null;
      await rerender();
      await view.customAlert("Thành công", "Danh mục hàng hóa đã được lưu và đồng bộ.", "check-circle");
    } catch (error) {
      await view.customAlert("Import chưa hoàn tất", error?.message || "Không thể lưu danh mục hàng hóa.", "alert-triangle");
    }
  });
}
