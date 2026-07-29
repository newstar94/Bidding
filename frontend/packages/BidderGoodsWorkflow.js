import { readExcelWorkbookSheets } from "../documents/excelFileReader.js";
import { generateRecordId, generateUUID } from "../shared/idUtils.js";
import { persistAndSync } from "../shared/MutationService.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  downloadBidderGoodsTemplate,
  downloadBidderGoodsWorkbook,
  parseBidderGoodsWorkbookSheets,
} from "./BidderGoodsExcel.js";
import { mapBidderGoodsRows, applyManualBidderGoodsMapping } from "./bidderGoodsMapping.js";
import {
  getBidderGoodsForBid,
  getBidderGoodsRequirements,
} from "./bidderGoodsSelectors.js";
import {
  summarizeBidderGoods,
  validateBidderGoodsRow,
  validateBidderGoodsSubmission,
} from "./bidderGoodsValidation.js";

const PAGE_SIZE = 20;

function currency(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(numeric)} đ`
    : "--";
}

function lotForBid(pkg, bid) {
  const code = String(bid?.maPhanLo || "").trim().toLocaleLowerCase("vi");
  return (pkg?.phanLoList || []).find(
    (item) => String(item.maPhanLo || "").trim().toLocaleLowerCase("vi") === code,
  ) || null;
}

export function buildBidderGoodsPanelState(controller, detailedState) {
  const { pkg, bid } = detailedState;
  const requirements = bid ? getBidderGoodsRequirements(controller.model, pkg, bid) : [];
  const rows = bid ? getBidderGoodsForBid(controller.model, pkg, bid) : [];
  const summary = summarizeBidderGoods({ rows, requirements, bidPrice: bid?.giaDuThau });
  const filter = String(controller._bidderGoodsSearch || "").trim().toLocaleLowerCase("vi");
  const filteredRows = filter
    ? rows.filter((row) => [row.sttNguon, row.danhMucHangHoa, row.kyMaHieu, row.nhanHieu, row.maHs]
      .some((value) => String(value || "").toLocaleLowerCase("vi").includes(filter)))
    : rows;
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
    pageRows,
    pageCount,
    page: controller._bidderGoodsPage,
    filter,
    importPreview: controller._bidderGoodsImportPreview || null,
    busy: controller._bidderGoodsBusy || "",
    error: controller._bidderGoodsError || "",
  };
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

function rowMarkup(row, state) {
  const disabled = state.readOnly ? "disabled" : "";
  const rowErrors = validateBidderGoodsRow(row, { official: false });
  const textValue = (field, label, { multiline = false } = {}) => {
    const value = escapeHtml(row[field] ?? "");
    if (state.readOnly) return value || "--";
    return multiline
      ? `<textarea class="form-control" data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}">${value}</textarea>`
      : `<input class="form-control" data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}" value="${value}">`;
  };
  const numberValue = (field, label, { money = false } = {}) => {
    if (state.readOnly) return money ? currency(row[field]) : escapeHtml(row[field] ?? "--");
    return `<input class="form-control numeric-input" type="number" min="0" ${money ? "step=\"1\"" : "step=\"any\""} data-bidder-goods-field="${field}" aria-label="${escapeHtml(label)}" value="${escapeHtml(row[field] ?? "")}">`;
  };
  const requirements = state.requirements.filter(
    (item) => String(item.phanLoId || "") === String(row.phanLoId || ""),
  );
  return `
    <tr data-bidder-goods-id="${escapeHtml(row.id)}" class="${rowErrors.length ? "has-validation-error" : ""}">
      <td class="bidder-goods-sticky-stt">${escapeHtml(row.sttNguon || "--")}</td>
      <td class="bidder-goods-sticky-name"><strong>${escapeHtml(row.danhMucHangHoa || "--")}</strong></td>
      <td>${textValue("kyMaHieu", "Ký mã hiệu")}</td>
      <td>${textValue("nhanHieu", "Nhãn hiệu")}</td>
      <td>${textValue("namSanXuat", "Năm sản xuất")}</td>
      <td>${textValue("xuatXu", "Xuất xứ")}</td>
      <td>${textValue("hangSanXuat", "Hãng sản xuất")}</td>
      <td>${state.readOnly ? `<details class="bidder-goods-technical"><summary>Xem thông số</summary><div>${escapeHtml(row.cauHinhTinhNangKyThuat || "Chưa có thông số")}</div></details>` : textValue("cauHinhTinhNangKyThuat", "Cấu hình, tính năng kỹ thuật", { multiline: true })}</td>
      <td>${textValue("donViTinh", "Đơn vị tính")}</td>
      <td class="numeric-cell">${numberValue("khoiLuong", "Khối lượng")}</td>
      <td>${textValue("maHs", "Mã HS")}</td>
      <td class="numeric-cell">${numberValue("donGiaDuThau", "Đơn giá dự thầu", { money: true })}</td>
      <td class="numeric-cell">${numberValue("thanhTienDuThau", "Thành tiền", { money: true })}${rowErrors.length ? `<div class="field-error" title="${escapeHtml(rowErrors.join(" "))}">${escapeHtml(rowErrors[0])}</div>` : ""}</td>
      <td>
        <select class="form-control bidder-goods-mapping-select" data-bidder-goods-mapping ${disabled} aria-label="Ghép hàng hóa yêu cầu cho ${escapeHtml(row.danhMucHangHoa)}">
          <option value="">-- Chưa ghép --</option>
          ${requirements.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(row.goiThauHangHoaId || "") ? "selected" : ""}>${escapeHtml(`${item.maHangHoa || ""} – ${item.tenHangHoa || ""}`)}</option>`).join("")}
        </select>
        ${mappingBadge(row.mappingStatus)}
      </td>
      <td>${state.readOnly ? "" : `<button type="button" class="btn btn-text compact-action" data-bidder-goods-delete aria-label="Xóa ${escapeHtml(row.danhMucHangHoa)}"><i data-lucide="trash-2" aria-hidden="true"></i></button>`}</td>
    </tr>`;
}

function previewMarkup(preview) {
  if (!preview) return "";
  const errors = preview.rows.filter((row) => row.mappingStatus !== "matched" || validateBidderGoodsRow(row).length).length;
  return `
    <section class="bidder-goods-preview" aria-label="Xem trước nhập Excel">
      <div class="bidder-goods-preview-header">
        <div><strong>Xem trước nhập Excel</strong><span>${escapeHtml(preview.sheetName)} · dòng tiêu đề ${preview.headerRow}</span></div>
        <div class="bidder-goods-preview-metrics"><span>${preview.rows.length} dòng</span><span>${currency(preview.total)}</span><span class="${errors ? "text-danger" : "text-success"}">${errors} lỗi/cảnh báo</span></div>
      </div>
      <div class="table-container package-table-frame">
        <table class="data-table bidder-goods-preview-table" data-no-sort="true">
          <thead><tr><th>Dòng</th><th>STT</th><th>Phần lô</th><th>Danh mục hàng hóa</th><th>Thành tiền</th><th>Trạng thái ghép</th></tr></thead>
          <tbody>${preview.rows.map((row) => `<tr><td>${row.sourceRowNumber}</td><td>${escapeHtml(row.sttNguon)}</td><td>${escapeHtml(row.maPhanLoNguon || "Không phân lô")}</td><td>${escapeHtml(row.danhMucHangHoa)}</td><td class="numeric-cell">${currency(row.thanhTienDuThau)}</td><td>${mappingBadge(row.mappingStatus)}</td></tr>`).join("")}</tbody>
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
  const difference = state.summary.difference;
  const differenceLabel = difference === null
    ? "Chưa có giá dự thầu"
    : Math.abs(difference) <= 1
      ? "Khớp giá dự thầu"
      : `Chênh lệch ${difference > 0 ? "+" : ""}${currency(difference)}`;
  const busyAttributes = state.busy ? 'disabled aria-disabled="true"' : "";
  const controls = state.readOnly ? "" : `
    <input id="bidder-goods-excel-input" type="file" accept=".xlsx,.xls" ${busyAttributes} hidden>
    <button type="button" class="btn btn-primary" id="btn-bidder-goods-import" ${busyAttributes}><i data-lucide="upload" aria-hidden="true"></i> Chọn file Excel</button>
    <button type="button" class="btn btn-outline" id="btn-bidder-goods-add" ${busyAttributes}><i data-lucide="plus" aria-hidden="true"></i> Thêm thủ công</button>
    <label class="bidder-goods-mode"><span>Chế độ nhập</span><select id="bidder-goods-import-mode" class="form-control" ${busyAttributes}><option value="merge">Gộp dữ liệu</option><option value="replace">Thay thế phạm vi</option></select></label>`;
  return `
    <div class="bidder-goods-panel">
      <div class="bidder-goods-context" role="status">
        <span><strong>Gói thầu:</strong> ${escapeHtml(state.pkg.tenGoiThau || state.pkg.maGoiThau || "--")}</span>
        ${state.lot ? `<span><strong>Phần lô:</strong> ${escapeHtml(`${state.lot.maPhanLo || ""} – ${state.lot.tenPhanLo || ""}`)}</span>` : ""}
        <span><strong>Phương thức:</strong> ${escapeHtml(state.roundType === "financial" ? "1G2T – Tài chính" : "1G1T")}</span>
      </div>
      <div class="bidder-goods-toolbar">
        <div class="bidder-goods-primary-actions">${controls}</div>
        <div class="bidder-goods-secondary-actions">
          <label class="visually-hidden" for="bidder-goods-search">Tìm kiếm hàng hóa dự thầu</label>
          <input id="bidder-goods-search" data-bidder-goods-filter class="form-control" type="search" value="${escapeHtml(state.filter)}" placeholder="Tìm hàng hóa, ký mã hiệu, mã HS…">
          <button type="button" class="btn btn-outline" id="btn-bidder-goods-template"><i data-lucide="file-spreadsheet" aria-hidden="true"></i> Tải file mẫu</button>
          <button type="button" class="btn btn-outline" id="btn-bidder-goods-export"><i data-lucide="download" aria-hidden="true"></i> Xuất Excel</button>
        </div>
      </div>
      ${state.busy ? '<div class="alert alert-info bidder-goods-operation-state" role="status" aria-live="polite" aria-busy="true"><span class="loading-spinner" aria-hidden="true"></span> Đang đọc và kiểm tra file Excel…</div>' : ""}
      ${state.error ? `<div class="alert alert-danger bidder-goods-operation-state" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="bidder-goods-summary" aria-label="Tổng hợp hàng hóa dự thầu">
        <div><span>Đã nhập</span><strong>${state.rows.length}/${state.requirements.length}</strong></div>
        <div><span>Tổng thành tiền</span><strong>${currency(state.summary.total)}</strong></div>
        <div class="${difference !== null && Math.abs(difference) <= 1 ? "is-success" : "is-warning"}"><span>Đối chiếu</span><strong>${escapeHtml(differenceLabel)}</strong></div>
        <div><span>Lỗi đối chiếu</span><strong>${state.summary.invalidRows + state.summary.missing.length + state.summary.unmatched + state.summary.duplicate}</strong></div>
      </div>
      ${previewMarkup(state.importPreview)}
      <div class="table-container package-table-frame has-bottom-space bidder-goods-table-frame">
        <table class="data-table bidder-goods-table" data-no-sort="true" data-density="comfortable">
          <thead><tr><th>STT</th><th>Danh mục hàng hóa</th><th>Ký mã hiệu</th><th>Nhãn hiệu</th><th>Năm sản xuất</th><th>Xuất xứ</th><th>Hãng sản xuất</th><th>Cấu hình, tính năng kỹ thuật</th><th>ĐVT</th><th>Khối lượng</th><th>Mã HS</th><th>Đơn giá dự thầu</th><th>Thành tiền</th><th>Trạng thái ghép</th><th>Thao tác</th></tr></thead>
          <tbody>${state.pageRows.length ? state.pageRows.map((row) => rowMarkup(row, state)).join("") : '<tr><td colspan="15"><div class="package-panel-empty">Chưa có hàng hóa dự thầu trong phạm vi này.</div></td></tr>'}</tbody>
        </table>
      </div>
      <div class="bidder-goods-pagination" aria-label="Phân trang hàng hóa dự thầu">
        <button type="button" class="btn btn-outline compact-action" id="btn-bidder-goods-prev" ${state.page <= 1 ? "disabled" : ""}>Trang trước</button>
        <span>Trang ${state.page}/${state.pageCount}</span>
        <button type="button" class="btn btn-outline compact-action" id="btn-bidder-goods-next" ${state.page >= state.pageCount ? "disabled" : ""}>Trang sau</button>
      </div>
      ${state.readOnly ? '<div class="alert alert-info" role="status">Dữ liệu đang ở chế độ chỉ đọc.</div>' : `<div class="workflow-action-row bidder-goods-save-actions with-divider"><button type="button" class="btn btn-secondary" id="btn-bidder-goods-save-draft">Lưu nháp</button><button type="button" class="btn btn-primary" id="btn-bidder-goods-save-official">Lưu chính thức</button></div>`}
    </div>`;
}

export async function analyzeBidderGoodsExcel(controller, detailedState, file) {
  const sheets = await readExcelWorkbookSheets(file);
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
    mapped.forEach((row) => previewRows.push({
      ...row,
      id: generateRecordId("hanghoaduthaunhathau"),
      goiThauId: detailedState.pkg.id,
      thongTinMoThauId: group.bid.id,
      importBatchId: batchId,
      isDraft: true,
    }));
  }
  return {
    ...parsed,
    rows: previewRows,
    total: previewRows.reduce((sum, row) => sum + (Number(row.thanhTienDuThau) || 0), 0),
    mode: controller.view.getActiveElement?.("bidder-goods-import-mode")?.value || "merge",
  };
}

export async function importBidderGoodsExcel(controller, detailedState, file) {
  if (!file || detailedState.readOnly) return false;
  controller._bidderGoodsBusy = "import";
  controller._bidderGoodsError = "";
  controller.renderDetailedEvaluation();
  try {
    const preview = await analyzeBidderGoodsExcel(controller, detailedState, file);
    controller._bidderGoodsImportPreview = preview;
    controller._detailedEvaluationDirty = true;
    return true;
  } catch (error) {
    console.error(error);
    controller._bidderGoodsError = error?.message || "Vui lòng kiểm tra lại file Excel.";
    await controller.view.customAlert("Không thể đọc Excel", error?.message || "Vui lòng kiểm tra lại file Excel.", "alert-triangle");
    return false;
  } finally {
    controller._bidderGoodsBusy = "";
    controller.renderDetailedEvaluation();
  }
}

export async function confirmBidderGoodsImport(controller) {
  const preview = controller._bidderGoodsImportPreview;
  if (!preview) return false;
  if (preview.mode === "replace") {
    const accepted = await controller.view.customConfirm(
      "Thay thế hàng hóa dự thầu",
      `Thao tác sẽ thay thế ${preview.rows.length} dòng trong phạm vi nhà thầu/phần lô có trong file. Bạn có muốn tiếp tục?`,
      "alert-triangle",
    );
    if (!accepted) return false;
  }
  const incomingScopes = new Set(preview.rows.map((row) => String(row.thongTinMoThauId)));
  const incomingByKey = new Map(preview.rows.map((row) => [
    `${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`,
    row,
  ]));
  const retained = (controller.model.state.hanghoaduthaunhathau || []).filter((row) => {
    if (!incomingScopes.has(String(row.thongTinMoThauId))) return true;
    if (preview.mode === "replace") return false;
    const key = `${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`;
    return !incomingByKey.has(key);
  });
  const existingByKey = new Map((controller.model.state.hanghoaduthaunhathau || []).map((row) => [
    `${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`,
    row,
  ]));
  controller.model.state.hanghoaduthaunhathau = [
    ...retained,
    ...preview.rows.map((row) => {
      const current = existingByKey.get(`${row.thongTinMoThauId}::${row.goiThauHangHoaId || row.sttNguon}`);
      return { ...row, id: current?.id || row.id, rowVersion: current?.rowVersion };
    }),
  ];
  controller._bidderGoodsImportPreview = null;
  controller._bidderGoodsError = "";
  controller._detailedEvaluationDirty = true;
  controller.renderDetailedEvaluation();
  await controller.view.customAlert("Đã nhập dữ liệu", "Dữ liệu đang ở bản nháp. Hãy kiểm tra đối chiếu và lưu.", "check-circle");
  return true;
}

export async function saveBidderGoods(controller, detailedState, { official = false } = {}) {
  const rows = getBidderGoodsForBid(controller.model, detailedState.pkg, detailedState.bid);
  const requirements = getBidderGoodsRequirements(controller.model, detailedState.pkg, detailedState.bid);
  if (official) {
    const validation = validateBidderGoodsSubmission({ rows, requirements, bidPrice: detailedState.bid.giaDuThau });
    if (!validation.valid) {
      await controller.view.customAlert("Chưa thể lưu chính thức", validation.errors[0], "alert-triangle");
      return false;
    }
  }
  const scopeIds = new Set(rows.map((row) => String(row.id)));
  const snapshot = (controller.model.state.hanghoaduthaunhathau || []).map((row) => ({ ...row }));
  controller.model.state.hanghoaduthaunhathau = snapshot.map((row) => (
    scopeIds.has(String(row.id)) ? { ...row, isDraft: !official } : row
  ));
  const buttons = controller.view.getActiveElement?.("danhgiahsdt-detail-view")?.querySelectorAll?.("#btn-bidder-goods-save-draft, #btn-bidder-goods-save-official") || [];
  buttons.forEach((button) => { button.disabled = true; });
  const result = await persistAndSync(controller, "hanghoaduthaunhathau");
  if (result?.ok === false) {
    controller.model.state.hanghoaduthaunhathau = snapshot;
    await controller.model.db?.putTableData?.("hanghoaduthaunhathau", snapshot);
    controller._bidderGoodsError = "Không thể đồng bộ hàng hóa dự thầu. Dữ liệu trước khi lưu đã được khôi phục.";
    buttons.forEach((button) => { button.disabled = false; });
    controller.renderDetailedEvaluation();
    return false;
  }
  controller._bidderGoodsError = "";
  controller._detailedEvaluationDirty = false;
  await controller.view.customAlert(
    "Lưu thành công",
    official ? "Hàng hóa dự thầu đã được lưu chính thức." : "Đã lưu bản nháp hàng hóa dự thầu.",
    "check-circle",
  );
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
  root.querySelector("#btn-bidder-goods-template")?.addEventListener("click", () => (
    downloadBidderGoodsTemplate(state.pkg, state.requirements)
  ));
  root.querySelector("#btn-bidder-goods-export")?.addEventListener("click", () => downloadBidderGoodsWorkbook(state.pkg, state.rows));
  root.querySelector("#btn-bidder-goods-add")?.addEventListener("click", () => {
    const used = new Set(state.rows.map((row) => String(row.goiThauHangHoaId || "")));
    const requirement = state.requirements.find((item) => !used.has(String(item.id))) || state.requirements[0];
    if (!requirement) return;
    controller.model.state.hanghoaduthaunhathau.push({
      id: generateRecordId("hanghoaduthaunhathau"),
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
    controller._detailedEvaluationDirty = true;
    controller.renderDetailedEvaluation();
  });
  root.querySelectorAll("[data-bidder-goods-mapping]").forEach((select) => {
    select.addEventListener("change", () => {
      const rowId = select.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      controller.model.state.hanghoaduthaunhathau = applyManualBidderGoodsMapping(
        controller.model.state.hanghoaduthaunhathau,
        rowId,
        select.value,
      );
      controller._detailedEvaluationDirty = true;
      controller.renderDetailedEvaluation();
    });
  });
  root.querySelectorAll("[data-bidder-goods-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const rowId = input.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      const field = input.getAttribute("data-bidder-goods-field");
      const numeric = ["khoiLuong", "donGiaDuThau", "thanhTienDuThau"].includes(field);
      const value = numeric ? (input.value === "" ? null : Number(input.value)) : input.value;
      controller.model.state.hanghoaduthaunhathau = controller.model.state.hanghoaduthaunhathau.map(
        (row) => String(row.id) === String(rowId) ? { ...row, [field]: value, isDraft: true } : row,
      );
      controller._detailedEvaluationDirty = true;
      controller.renderDetailedEvaluation();
    });
  });
  root.querySelectorAll("[data-bidder-goods-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const rowId = button.closest("[data-bidder-goods-id]")?.getAttribute("data-bidder-goods-id");
      if (!await controller.view.customConfirm("Xóa hàng hóa dự thầu", "Bạn có chắc muốn xóa dòng này?", "trash-2")) return;
      controller.model.state.hanghoaduthaunhathau = controller.model.state.hanghoaduthaunhathau.filter((row) => String(row.id) !== String(rowId));
      controller._detailedEvaluationDirty = true;
      controller.renderDetailedEvaluation();
    });
  });
  const search = root.querySelector("#bidder-goods-search");
  search?.addEventListener("change", () => {
    controller._bidderGoodsSearch = search.value;
    controller._bidderGoodsPage = 1;
    controller._detailedEvaluationDirty = false;
    controller.renderDetailedEvaluation();
  });
  root.querySelector("#btn-bidder-goods-prev")?.addEventListener("click", () => { controller._bidderGoodsPage = Math.max(1, state.page - 1); controller.renderDetailedEvaluation(); });
  root.querySelector("#btn-bidder-goods-next")?.addEventListener("click", () => { controller._bidderGoodsPage = Math.min(state.pageCount, state.page + 1); controller.renderDetailedEvaluation(); });
  root.querySelector("#btn-bidder-goods-save-draft")?.addEventListener("click", () => saveBidderGoods(controller, detailedState));
  root.querySelector("#btn-bidder-goods-save-official")?.addEventListener("click", () => saveBidderGoods(controller, detailedState, { official: true }));
  controller.view.createIconsScoped?.(root);
}
