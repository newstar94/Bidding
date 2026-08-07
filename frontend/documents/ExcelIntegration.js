import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { beginExcelImportLoading } from "../shared/ExcelImportLoading.js";
import {
  authFetchDownloadWithAlert,
} from "../shared/workflow_helpers.js";
import { triggerExcelTemplateDownload as triggerTemplateDownload } from "./excelTemplateAdapter.js";
import { apiFetch } from "../shared/apiClient.js";
import { readExcelRows, showExcelImportSaveButton } from "./excelFileReader.js";
import {
  parseAwardResultImport,
  parseBidEvaluationImport,
  parseOpeningFinancialImport,
  parseOpeningImport
} from "./excelImportAdapters.js";
import { isBasicExcelImportType, saveBasicExcelImport, saveBusinessExcelImport } from "./excelSaveAdapters.js";
import { renderExcelPreview } from "../packages/GoiThauModals.js";
import {
  getActiveEvaluationLotScope,
} from "../packages/lotEvaluationScope.js";
const IMPORT_STATE_KEY = {
  plan: "kehoach",
  kehoach: "kehoach",
  package: "goithau",
  goithau: "goithau",
  chudautu: "chudautu",
  nhathau: "nhathau",
  chuyengia: "chuyengia",
  hopdong: "hopdong"
};
const PACKAGE_SELECT_IDS_BY_IMPORT = Object.freeze({
  mothau: ["mothau-goithau-select"],
  opening_fin: ["mothau-goithau-select", "danhgiahsdt-goithau-select"],
  danhgiahsdt: ["danhgiahsdt-goithau-select"],
  ketquaqd: ["result-goithau-select", "danhgiahsdt-goithau-select", "mothau-goithau-select"],
});

function selectedImportPackageId(controller, type) {
  for (const id of PACKAGE_SELECT_IDS_BY_IMPORT[type] || []) {
    const value = String(document.getElementById(id)?.value || "").trim();
    if (value) return value;
  }
  if (type === "ketquaqd") return String(controller._currentResultPackageId || "").trim();
  return "";
}

export function captureExcelImportContext(controller, type) {
  const epoch = Number(controller._excelImportEpoch || 0) + 1;
  controller._excelImportEpoch = epoch;
  const packageId = selectedImportPackageId(controller, type);
  const pkg = type === "danhgiahsdt"
    ? controller.model?.state?.goithau?.find((item) => String(item.id) === packageId)
    : null;
  const lotScope = pkg ? getActiveEvaluationLotScope(controller, pkg) : null;
  return Object.freeze({
    type: String(type || ""),
    packageId,
    evaluationTab: type === "danhgiahsdt"
      ? String(controller.currentDanhGiaTab || "technical")
      : "",
    evaluationLotIds: Object.freeze([...(lotScope?.lotIds || [])].map(String).sort()),
    workspaceToken: String(controller.model?.getWorkspaceToken?.() || ""),
    epoch,
  });
}

export function excelImportContextIsCurrent(controller, context) {
  if (!context || controller._excelImportContext !== context) return false;
  if (String(controller._excelImportType || "") !== context.type) return false;
  if (
    context.workspaceToken
    && controller.model?.isWorkspaceCurrent?.(context.workspaceToken) === false
  ) return false;
  if (
    context.packageId
    && selectedImportPackageId(controller, context.type) !== context.packageId
  ) return false;
  if (
    context.evaluationTab
    && String(controller.currentDanhGiaTab || "technical") !== context.evaluationTab
  ) return false;
  if (context.type === "danhgiahsdt") {
    const pkg = controller.model?.state?.goithau?.find(
      (item) => String(item.id) === String(context.packageId || ""),
    );
    const currentLotIds = [...(getActiveEvaluationLotScope(controller, pkg)?.lotIds || [])]
      .map(String)
      .sort();
    if (currentLotIds.join("\u0000") !== (context.evaluationLotIds || []).join("\u0000")) {
      return false;
    }
  }
  return true;
}

async function rejectStaleExcelImport(controller) {
  await controller.view.customAlert(
    "Ngữ cảnh nhập Excel đã thay đổi",
    "Gói thầu, tab đánh giá hoặc không gian làm việc đã thay đổi. Dữ liệu chưa được áp dụng; vui lòng chọn lại file Excel.",
    "alert-triangle",
  );
  return false;
}

const BASIC_IMPORT_VIEW = {
  plan: { tab: "kehoach", render: "renderKeHoachTable" },
  kehoach: { tab: "kehoach", render: "renderKeHoachTable" },
  package: { tab: "goithau", render: "renderGoiThauTable" },
  goithau: { tab: "goithau", render: "renderGoiThauTable" },
  chudautu: { tab: "chudautu", render: "renderChuDauTuTable" },
  nhathau: { tab: "nhathau", render: "renderNhaThauTable" },
  chuyengia: { tab: "chuyengia", render: "renderChuyenGiaTable" },
  hopdong: { tab: "hopdong", render: "renderHopDongTable" }
};

export async function renderBasicImportResult(controller, type, { useLocalSnapshot = false } = {}) {
  const config = BASIC_IMPORT_VIEW[type];
  if (!config || !controller?.view) return;
  await controller.view.ensureViewModules?.(config.tab);
  const render = controller.view[config.render];
  if (typeof render !== "function") return;
  const restoreServerPagination = Boolean(useLocalSnapshot && controller.model?.useServerSidePagination);
  if (restoreServerPagination) controller.model.useServerSidePagination = false;
  try {
    await render.call(controller.view);
  } finally {
    if (restoreServerPagination) controller.model.useServerSidePagination = true;
  }
}
export function setupExcelImportEvents() {
  document.querySelectorAll(".btn-download-excel-template-direct").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const type = btn.getAttribute("data-type");
      this.triggerExcelTemplateDownload(type);
    });
  });
  document.querySelectorAll(".btn-import-excel-direct").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const type = btn.getAttribute("data-type");
      this.triggerExcelImport(type);
    });
  });
  document.querySelectorAll(".btn-import-excel").forEach((btn) => {
    if (btn._hasExcelListener) return;
    btn._hasExcelListener = true;
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-type");
      this.triggerExcelImport(type);
    });
  });
  const fileInput = document.getElementById("excel-file-input");
  if (fileInput && !fileInput._hasExcelListener) {
    fileInput._hasExcelListener = true;
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this.handleExcelUpload(file, this._excelImportContext);
    });
  }
  const dragDropZone = document.getElementById("excel-drag-drop-zone");
  if (dragDropZone && !dragDropZone._hasExcelListener && fileInput) {
    dragDropZone._hasExcelListener = true;
    dragDropZone.addEventListener("click", () => fileInput.click());
    dragDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragDropZone.classList.add("dragover");
    });
    dragDropZone.addEventListener("dragleave", () => {
      dragDropZone.classList.remove("dragover");
    });
    dragDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) {
        fileInput.files = e.dataTransfer.files;
        this.handleExcelUpload(file, this._excelImportContext);
      }
    });
  }
  const saveImportBtn = document.getElementById("btn-save-excel-import");
  if (saveImportBtn && !saveImportBtn._hasExcelListener) {
    saveImportBtn._hasExcelListener = true;
    saveImportBtn.addEventListener("click", () => this.saveExcelImport());
  }
  const downloadTemplateBtn = document.getElementById("btn-download-excel-template");
  if (downloadTemplateBtn && !downloadTemplateBtn._hasExcelListener) {
    downloadTemplateBtn._hasExcelListener = true;
    downloadTemplateBtn.addEventListener("click", () => {
      const type = this._excelImportType || "kehoach";
      void authFetchDownloadWithAlert(
        this.view,
        `/api/export-excel-template/${type}`,
        `Mau_nhap_lieu_${type}.xlsx`,
      );
    });
  }
}
export function triggerExcelImport(type) {
  if (type === "mothau" || type === "danhgiahsdt") {
    const select = document.getElementById(type + "-goithau-select");
    if (!select || !select.value) {
      this.view.customAlert("Chưa chọn gói thầu", "Vui lòng chọn một gói thầu trước khi nhập file Excel!", "alert-triangle", select);
      return;
    }
  }
  if (type === "ketquaqd") {
    const select = document.getElementById("result-goithau-select") || document.getElementById("danhgiahsdt-goithau-select") || document.getElementById("mothau-goithau-select");
    this._currentResultPackageId = select ? select.value : "";
  }
  this._excelImportType = type;
  this._excelImportContext = captureExcelImportContext(this, type);
  if (type === "ketquaqd") {
    this._currentResultPackageId = this._excelImportContext.packageId;
  }
  let fileInput = document.getElementById("excel-file-input-temp");
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.id = "excel-file-input-temp";
    fileInput.type = "file";
    fileInput.accept = ".xlsx, .xls";
    setRuntimeStyle(fileInput, "display", "none");
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleExcelUpload(file, this._excelImportContext);
      }
    });
  }
  fileInput.value = "";
  fileInput.click();
}
export function triggerExcelTemplateDownload(type) {
  return Promise.resolve(triggerTemplateDownload(this, type)).catch((error) => (
    this.view.customAlert(
      "Lỗi tải mẫu",
      "Không thể tải Excel mẫu: " + error.message,
      "x-circle",
    )
  ));
}
async function renderClientExcelImport(controller, file, parser, context, loading) {
  try {
    if (!excelImportContextIsCurrent(controller, context)) {
      return await rejectStaleExcelImport(controller);
    }
    const rows = await readExcelRows(file);
    await loading?.update(
      "validate",
      "File đã được đọc. Hệ thống đang kiểm tra cấu trúc và dữ liệu.",
    );
    if (!excelImportContextIsCurrent(controller, context)) {
      return await rejectStaleExcelImport(controller);
    }
    const parsedRows = await parser(controller, rows, context);
    if (!parsedRows) return;
    if (!excelImportContextIsCurrent(controller, context)) {
      return await rejectStaleExcelImport(controller);
    }
    await loading?.update(
      "preview",
      "Dữ liệu hợp lệ đang được sắp xếp để hiển thị bản xem trước.",
    );
    controller._excelImportData = parsedRows;
    renderExcelPreview(controller._excelImportData, controller._excelImportType);
    showExcelImportSaveButton();
  } catch (err) {
    console.error(err);
    await controller.view.customAlert("Lỗi", "Không thể đọc tệp tin Excel này. Vui lòng kiểm tra lại!", "alert-triangle");
  }
}
export async function handleExcelUpload(file, context = null) {
  const importContext = context || this._excelImportContext
    || captureExcelImportContext(this, this._excelImportType);
  if (!this._excelImportContext) this._excelImportContext = importContext;
  if (!excelImportContextIsCurrent(this, importContext)) {
    return await rejectStaleExcelImport(this);
  }
  const loading = await beginExcelImportLoading({ fileName: file.name });
  const fileInfo = document.getElementById("excel-file-info");
  if (fileInfo) {
    document.getElementById("excel-filename").textContent = file.name;
    document.getElementById("excel-filesize").textContent = (file.size / 1024).toFixed(2) + " KB";
    setRuntimeStyle(fileInfo, "display", "flex");
  }
  if (this._excelImportType === "opening_fin") {
    try {
      await renderClientExcelImport(this, file, parseOpeningFinancialImport, importContext, loading);
    } finally {
      await loading.close();
    }
    return;
  }
  if (this._excelImportType === "danhgiahsdt") {
    try {
      await renderClientExcelImport(this, file, parseBidEvaluationImport, importContext, loading);
    } finally {
      await loading.close();
    }
    return;
  }
  if (this._excelImportType === "ketquaqd") {
    try {
      await renderClientExcelImport(this, file, parseAwardResultImport, importContext, loading);
    } finally {
      await loading.close();
    }
    return;
  }
  if (this._excelImportType === "mothau") {
    try {
      await renderClientExcelImport(this, file, parseOpeningImport, importContext, loading);
    } finally {
      await loading.close();
    }
    return;
  }
  let apiType = this._excelImportType;
  if (apiType === "plan") apiType = "kehoach";
  if (apiType === "package") apiType = "goithau";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", apiType);
  await loading.update(
    "validate",
    "File đã được nhận. Hệ thống đang tải lên và kiểm tra dữ liệu.",
  );
  try {
    const res = await apiFetch("/api/import-excel", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!excelImportContextIsCurrent(this, importContext)) {
      return await rejectStaleExcelImport(this);
    }
    if (res.ok && data.success) {
      await loading.update(
        "preview",
        "Dữ liệu đã được kiểm tra. Hệ thống đang chuẩn bị bản xem trước.",
      );
      const rawRows = data.rows || data.data || [];
      const seenKeys = /* @__PURE__ */ new Set();
      this._excelImportData = rawRows.map((row) => {
        const item = row.data || row;
        let isValid = true;
        let comment = "Hợp lệ";
        let operation = "create";
        if (apiType === "kehoach") {
          if (!item.maKeHoach) {
            isValid = false;
            comment = "Mã kế hoạch không được để trống";
          } else if (!item.tenKeHoach) {
            isValid = false;
            comment = "Tên kế hoạch không được để trống";
          }
        } else if (apiType === "goithau") {
          if (!item.maGoiThau) {
            isValid = false;
            comment = "Mã gói thầu không được để trống";
          } else if (!item.tenGoiThau) {
            isValid = false;
            comment = "Tên gói thầu không được để trống";
          }
        } else if (apiType === "chudautu") {
          if (!item.maChuDauTu) {
            isValid = false;
            comment = "Mã chủ đầu tư không được để trống";
          } else if (!item.tenChuDauTu) {
            isValid = false;
            comment = "Tên chủ đầu tư không được để trống";
          } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
            isValid = false;
            comment = "Email không hợp lệ";
          }
        } else if (apiType === "nhathau") {
          if (!item.maNhaThau) {
            isValid = false;
            comment = "Mã nhà thầu không được để trống";
          } else if (!item.tenNhaThau) {
            isValid = false;
            comment = "Tên nhà thầu không được để trống";
          } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
            isValid = false;
            comment = "Email không hợp lệ";
          }
        } else if (apiType === "chuyengia") {
          if (!item.hoTen) {
            isValid = false;
            comment = "Họ tên không được để trống";
          } else if (item.soCCCD && !/^\d{12}$/.test(String(item.soCCCD).trim())) {
            isValid = false;
            comment = "Số CCCD phải gồm đúng 12 chữ số";
          } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
            isValid = false;
            comment = "Email không hợp lệ";
          }
        } else if (apiType === "hopdong") {
          if (!item.soHopDong) {
            isValid = false;
            comment = "Số hợp đồng không được để trống";
          } else if (!item.tenHopDong) {
            isValid = false;
            comment = "Tên hợp đồng không được để trống";
          }
        }
        if (isValid) {
          let uniqueKey = "";
          let dbExists = false;
          let fileDuplicate = false;
          if (apiType === "kehoach") {
            uniqueKey = String(item.maKeHoach || "").trim().toLowerCase();
            if (uniqueKey) {
              fileDuplicate = seenKeys.has("kehoach_" + uniqueKey);
              seenKeys.add("kehoach_" + uniqueKey);
              dbExists = (this.model.state.kehoach || []).some(
                (k) => k.isLatest === 1 && String(k.maKeHoach || "").trim().toLowerCase() === uniqueKey
              );
            }
          } else if (apiType === "goithau") {
            uniqueKey = String(item.maGoiThau || "").trim().toLowerCase();
            if (uniqueKey) {
              fileDuplicate = seenKeys.has("goithau_" + uniqueKey);
              seenKeys.add("goithau_" + uniqueKey);
              dbExists = (this.model.state.goithau || []).some(
                (g) => g.isLatest === 1 && String(g.maGoiThau || "").trim().toLowerCase() === uniqueKey
              );
            }
          } else if (apiType === "chudautu") {
            const maCDT = String(item.maChuDauTu || "").trim().toLowerCase();
            const mst = String(item.maSoThue || "").trim().toLowerCase();
            if (maCDT) {
              fileDuplicate = seenKeys.has("cdt_ma_" + maCDT);
              seenKeys.add("cdt_ma_" + maCDT);
              dbExists = (this.model.state.chudautu || []).some(
                (c) => c.isLatest === 1 && String(c.maChuDauTu || "").trim().toLowerCase() === maCDT
              );
            }
            if (!fileDuplicate && !dbExists && mst) {
              fileDuplicate = seenKeys.has("cdt_mst_" + mst);
              seenKeys.add("cdt_mst_" + mst);
              dbExists = (this.model.state.chudautu || []).some(
                (c) => c.isLatest === 1 && String(c.maSoThue || "").trim().toLowerCase() === mst
              );
            }
          } else if (apiType === "nhathau") {
            const maNT = String(item.maNhaThau || "").trim().toLowerCase();
            const mst = String(item.maSoThue || "").trim().toLowerCase();
            if (maNT) {
              fileDuplicate = seenKeys.has("nt_ma_" + maNT);
              seenKeys.add("nt_ma_" + maNT);
              dbExists = (this.model.state.nhathau || []).some(
                (n) => n.isLatest === 1 && String(n.maNhaThau || "").trim().toLowerCase() === maNT
              );
            }
            if (!fileDuplicate && !dbExists && mst) {
              fileDuplicate = seenKeys.has("nt_mst_" + mst);
              seenKeys.add("nt_mst_" + mst);
              dbExists = (this.model.state.nhathau || []).some(
                (n) => n.isLatest === 1 && String(n.maSoThue || "").trim().toLowerCase() === mst
              );
            }
          } else if (apiType === "chuyengia") {
            const cccd = String(item.soCCCD || "").trim().toLowerCase();
            const cc = String(item.soChungChi || "").trim().toLowerCase();
            if (cccd) {
              fileDuplicate = seenKeys.has("cg_cccd_" + cccd);
              seenKeys.add("cg_cccd_" + cccd);
              dbExists = (this.model.state.chuyengia || []).some(
                (c) => (c.isLatest == 1 || c.isLatest === true) && String(c.soCCCD || "").trim().toLowerCase() === cccd
              );
            }
            if (!fileDuplicate && !dbExists && cc) {
              fileDuplicate = seenKeys.has("cg_cc_" + cc);
              seenKeys.add("cg_cc_" + cc);
              dbExists = (this.model.state.chuyengia || []).some(
                (c) => (c.isLatest == 1 || c.isLatest === true) && String(c.soChungChi || "").trim().toLowerCase() === cc
              );
            }
          } else if (apiType === "hopdong") {
            uniqueKey = String(item.soHopDong || "").trim().toLowerCase();
            if (uniqueKey) {
              fileDuplicate = seenKeys.has("hd_" + uniqueKey);
              seenKeys.add("hd_" + uniqueKey);
              dbExists = (this.model.state.hopdong || []).some(
                (h) => h.isLatest === 1 && String(h.soHopDong || "").trim().toLowerCase() === uniqueKey
              );
            }
          }
          if (fileDuplicate) {
            isValid = false;
            comment = "Dòng trùng lặp trong file Excel đang nhập";
          } else if (dbExists) {
            operation = "update";
            comment = "Hợp lệ - sẽ cập nhật bản ghi hiện có";
          }
        }
        return {
          ...item,
          _valid: isValid,
          _comment: comment,
          _operation: operation
        };
      });
      renderExcelPreview(this._excelImportData, this._excelImportType);
      const saveBtn = document.getElementById("btn-save-excel-import");
      if (saveBtn) {
        saveBtn.disabled = false;
        setRuntimeStyle(saveBtn, "display", "inline-flex");
      }
    } else {
      await this.view.customAlert("Thất bại", data.error || "Không thể đọc tệp tin Excel này.", "alert-triangle");
    }
  } catch (err) {
    console.error("Excel import failed", err);
    await this.view.customAlert(
      "Lỗi nhập Excel",
      "Không thể xử lý tệp Excel: " + err.message,
      "alert-triangle"
    );
  } finally {
    await loading.close();
  }
}
export async function saveExcelImport() {
  if (!this._excelImportData || this._excelImportData.length === 0) return;
  const type = this._excelImportType;
  const importContext = this._excelImportContext;
  if (!excelImportContextIsCurrent(this, importContext)) {
    return await rejectStaleExcelImport(this);
  }
  let count = 0;
  const validRows = this._excelImportData.filter((r) => r._valid);
  if (validRows.length === 0 && isBasicExcelImportType(type)) {
    await this.view.customAlert("Thông báo", "Không có dòng dữ liệu nào hợp lệ để lưu vào hệ thống!", "warning");
    return;
  }
  const invalidCount = this._excelImportData.length - validRows.length;
  if (invalidCount > 0 && validRows.length > 0) {
    const proceed = await this.view.customConfirm(
      "Phát hiện dòng lỗi / trùng lặp",
      `Có ${invalidCount} dòng dữ liệu bị lỗi hoặc đã tồn tại trong hệ thống. Bạn có muốn bỏ qua các dòng này và tiếp tục lưu ${validRows.length} dòng hợp lệ không?`,
      "alert-triangle"
    );
    if (!proceed) return;
  }
  if (!excelImportContextIsCurrent(this, importContext)) {
    return await rejectStaleExcelImport(this);
  }
  const basicImportCount = await saveBasicExcelImport(this, type, validRows);
  const isBasicImport = basicImportCount !== null;
  if (basicImportCount !== null) {
    count = basicImportCount;
    const stateKey = IMPORT_STATE_KEY[type];
    if (stateKey && this.model.currentPage) {
      this.model.currentPage[stateKey] = 1;
    }
  } else {
    const businessImportCount = await saveBusinessExcelImport(
      this,
      type,
      validRows,
      importContext,
    );
    if (businessImportCount !== null) {
      count = businessImportCount;
    }
  }
  const syncResult = await this.autoSync();
  if (isBasicImport) {
    await renderBasicImportResult(this, type, { useLocalSnapshot: !syncResult?.ok });
  }
  const updatedCount = validRows.filter((row) => row._operation === "update").length;
  const createdCount = count - updatedCount;
  await this.closeModal("modal-excel-preview", { restoreRoute: false });
  this._excelImportData = null;
  this._excelImportContext = null;
  const summary = `Đã xử lý ${count} dòng: thêm mới ${createdCount}, cập nhật ${updatedCount}, bỏ qua ${invalidCount}.`;
  if (syncResult?.ok) {
    this.view.showToast("Thành công", summary, "success");
  } else if (syncResult?.error && !syncResult?.status && !syncResult?.validation && !syncResult?.conflict) {
    this.view.showToast(
      "Thất bại",
      "Không thể hoàn tất nhập dữ liệu. Vui lòng kiểm tra kết nối và thử lại.",
      "error"
    );
  }
}
export function exportPhatHanhPhanLoExcel(gt) {
  const rows = [];
  document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr").forEach((tr) => {
    const ma = tr.querySelector(".phathanh-pl-code-input")?.value || "";
    const ten = tr.querySelector(".phathanh-pl-name-input")?.value || "";
    const gia = tr.querySelector(".phathanh-pl-price-input")?.value || "";
    const baodam = tr.querySelector(".phathanh-pl-baodam-input")?.value || "";
    const duration = tr.querySelector(".phathanh-pl-duration-input")?.value || "";
    rows.push({
      maPhanLo: ma,
      tenPhanLo: ten,
      giaTriPhanLo: this.model.parseVND(gia),
      baoDamDuThau: this.model.parseVND(baodam),
      thoiGianThucHien: duration
    });
  });
  const headers = {
    "Content-Type": "application/json"
  };
  apiFetch("/api/export-phanlo-excel", {
    method: "POST",
    headers,
    body: JSON.stringify({
      package_name: gt.maGoiThau || "GoiThau",
      rows
    })
  }).then((res) => {
    if (!res.ok) throw new Error("Không thể xuất Excel");
    return res.blob();
  }).then((blob) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mau_nhap_lieu_phan_lo_${gt.maGoiThau || "GoiThau"}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }).catch((err) => this.view.customAlert("Lỗi xuất Excel", "Không thể xuất Excel: " + err.message, "x-circle"));
}
export function exportEditPhanLoExcel() {
  const list = this._collectPhanLoRows();
  const pkgCodeInput = document.getElementById("gt-ma");
  const packageCode = pkgCodeInput ? pkgCodeInput.value.trim() : "";
  const finalName = packageCode || "GoiThau";
  const headers = {
    "Content-Type": "application/json"
  };
  apiFetch("/api/export-phanlo-excel", {
    method: "POST",
    headers,
    body: JSON.stringify({
      package_name: finalName,
      rows: list
    })
  }).then((res) => {
    if (!res.ok) throw new Error("Không thể tải Excel mẫu");
    return res.blob();
  }).then((blob) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mau_nhap_lieu_phan_lo_${finalName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }).catch((err) => this.view.customAlert("Lỗi tải mẫu", "Không thể tải Excel mẫu: " + err.message, "x-circle"));
}
export function exportEditTuyChonMuaThemExcel() {
  const list = this._collectTuyChonMuaThemRows();
  const pkgCodeInput = document.getElementById("gt-ma");
  const packageCode = pkgCodeInput ? pkgCodeInput.value.trim() : "";
  const finalName = packageCode || "GoiThau";
  const headers = {
    "Content-Type": "application/json"
  };
  apiFetch("/api/export-tuychonmuathem-excel", {
    method: "POST",
    headers,
    body: JSON.stringify({
      package_name: finalName,
      rows: list
    })
  }).then((res) => {
    if (!res.ok) throw new Error("Không thể tải Excel mẫu");
    return res.blob();
  }).then((blob) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mau_nhap_lieu_tuy_chon_mua_them_${finalName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }).catch((err) => this.view.customAlert("Lỗi tải mẫu", "Không thể tải Excel mẫu: " + err.message, "x-circle"));
}
export async function importPhatHanhPhanLoExcel(file) {
  const loading = await beginExcelImportLoading({ fileName: file?.name || "" });
  try {
      const json = await readExcelRows(file);
      await loading.update(
        "validate",
        "File đã được đọc. Hệ thống đang đối chiếu dữ liệu từng phần lô.",
      );
      let count = 0;
      const trList = document.querySelectorAll("#phathanh-phanlo-baodam-tbody tr");
      json.forEach((row, rowIndex) => {
        const maPhanLoExcel = String(row["Mã phần lô"] || row["Mã lô"] || "").trim();
        const tenPhanLoExcel = String(row["Tên phần lô"] || row["Tên lô"] || "").trim();
        const giaTriPhanLoExcelRaw = row["Giá trị phần lô (VND)"] || row["Giá trị phần lô"] || "";
        const baoDamExcelRaw = row["Bảo đảm dự thầu (VND)"] || row["Bảo đảm dự thầu"] || row["Giá trị bảo đảm"] || "";
        const thoiGianThucHienExcel = String(row["Thời gian thực hiện"] || row["Thời gian"] || "").trim();
        let matchedTr = null;
        for (let tr of trList) {
          const maInp = tr.querySelector(".phathanh-pl-code-input");
          const tenInp = tr.querySelector(".phathanh-pl-name-input");
          const maTr = maInp ? maInp.value.trim().toLowerCase() : "";
          const tenTr = tenInp ? tenInp.value.trim().toLowerCase() : "";
          if (maPhanLoExcel && maPhanLoExcel.toLowerCase() === maTr || tenPhanLoExcel && tenPhanLoExcel.toLowerCase() === tenTr) {
            matchedTr = tr;
            break;
          }
        }
        if (!matchedTr && rowIndex < trList.length) {
          matchedTr = trList[rowIndex];
        }
        if (matchedTr) {
          const codeInp = matchedTr.querySelector(".phathanh-pl-code-input");
          if (codeInp && maPhanLoExcel) codeInp.value = maPhanLoExcel;
          const nameInp = matchedTr.querySelector(".phathanh-pl-name-input");
          if (nameInp && tenPhanLoExcel) nameInp.value = tenPhanLoExcel;
          const parsedGiaTri = this.model.parseVND(String(giaTriPhanLoExcelRaw));
          const priceInp = matchedTr.querySelector(".phathanh-pl-price-input");
          if (priceInp && parsedGiaTri !== void 0) {
            priceInp.value = this.model.formatVND(parsedGiaTri);
          }
          const inp = matchedTr.querySelector(".phathanh-pl-baodam-input");
          if (inp) {
            const parsedVal = this.model.parseVND(String(baoDamExcelRaw));
            inp.value = this.model.formatVND(parsedVal);
          }
          const durationInp = matchedTr.querySelector(".phathanh-pl-duration-input");
          if (durationInp && thoiGianThucHienExcel) durationInp.value = thoiGianThucHienExcel;
          count++;
        }
      });
      if (count > 0) {
        await loading.update("preview", "Dữ liệu phần lô đã được cập nhật vào biểu mẫu.");
        this.view.customAlert("Nhập thành công", `Đã cập nhật/ghi đè giá trị bảo đảm cho ${count} phần lô từ file Excel!`, "check-circle");
      } else {
        this.view.customAlert("Không nhập được dữ liệu", "Không thể đồng bộ dữ liệu phần lô nào từ file Excel!", "alert-triangle");
      }
  } catch (err) {
      this.view.customAlert("Lỗi đọc file", "Không thể đọc file Excel: " + err.message, "x-circle");
  } finally {
      await loading.close();
  }
}
export function revalidateExcelImportData() {
  const apiType = this._excelImportType;
  if (!this._excelImportData || this._excelImportData.length === 0) return;
  const seenKeys = /* @__PURE__ */ new Set();
  this._excelImportData.forEach((item) => {
    let isValid = true;
    let comment = "Hợp lệ";
    let operation = "create";
    if (apiType === "kehoach") {
      if (!item.maKeHoach) {
        isValid = false;
        comment = "Mã kế hoạch không được để trống";
      } else if (!item.tenKeHoach) {
        isValid = false;
        comment = "Tên kế hoạch không được để trống";
      }
    } else if (apiType === "goithau") {
      if (!item.maGoiThau) {
        isValid = false;
        comment = "Mã gói thầu không được để trống";
      } else if (!item.tenGoiThau) {
        isValid = false;
        comment = "Tên gói thầu không được để trống";
      }
    } else if (apiType === "chudautu") {
      if (!item.maChuDauTu) {
        isValid = false;
        comment = "Mã chủ đầu tư không được để trống";
      } else if (!item.tenChuDauTu) {
        isValid = false;
        comment = "Tên chủ đầu tư không được để trống";
      } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
        isValid = false;
        comment = "Email không hợp lệ";
      }
    } else if (apiType === "nhathau") {
      if (!item.maNhaThau) {
        isValid = false;
        comment = "Mã nhà thầu không được để trống";
      } else if (!item.tenNhaThau) {
        isValid = false;
        comment = "Tên nhà thầu không được để trống";
      } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
        isValid = false;
        comment = "Email không hợp lệ";
      }
    } else if (apiType === "chuyengia") {
      if (!item.hoTen) {
        isValid = false;
        comment = "Họ tên không được để trống";
      } else if (item.soCCCD && !/^\d{12}$/.test(String(item.soCCCD).trim())) {
        isValid = false;
        comment = "Số CCCD phải gồm đúng 12 chữ số";
      } else if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(item.email).trim())) {
        isValid = false;
        comment = "Email không hợp lệ";
      }
    } else if (apiType === "hopdong") {
      if (!item.soHopDong) {
        isValid = false;
        comment = "Số hợp đồng không được để trống";
      } else if (!item.tenHopDong) {
        isValid = false;
        comment = "Tên hợp đồng không được để trống";
      }
    }
    if (isValid) {
      let uniqueKey = "";
      let dbExists = false;
      let fileDuplicate = false;
      if (apiType === "kehoach") {
        uniqueKey = String(item.maKeHoach || "").trim().toLowerCase();
        if (uniqueKey) {
          fileDuplicate = seenKeys.has("kehoach_" + uniqueKey);
          seenKeys.add("kehoach_" + uniqueKey);
          dbExists = (this.model.state.kehoach || []).some(
            (k) => k.isLatest === 1 && String(k.maKeHoach || "").trim().toLowerCase() === uniqueKey
          );
        }
      } else if (apiType === "goithau") {
        uniqueKey = String(item.maGoiThau || "").trim().toLowerCase();
        if (uniqueKey) {
          fileDuplicate = seenKeys.has("goithau_" + uniqueKey);
          seenKeys.add("goithau_" + uniqueKey);
          dbExists = (this.model.state.goithau || []).some(
            (g) => g.isLatest === 1 && String(g.maGoiThau || "").trim().toLowerCase() === uniqueKey
          );
        }
      } else if (apiType === "chudautu") {
        const maCDT = String(item.maChuDauTu || "").trim().toLowerCase();
        const mst = String(item.maSoThue || "").trim().toLowerCase();
        if (maCDT) {
          fileDuplicate = seenKeys.has("cdt_ma_" + maCDT);
          seenKeys.add("cdt_ma_" + maCDT);
          dbExists = (this.model.state.chudautu || []).some(
            (c) => c.isLatest === 1 && String(c.maChuDauTu || "").trim().toLowerCase() === maCDT
          );
        }
        if (!fileDuplicate && !dbExists && mst) {
          fileDuplicate = seenKeys.has("cdt_mst_" + mst);
          seenKeys.add("cdt_mst_" + mst);
          dbExists = (this.model.state.chudautu || []).some(
            (c) => c.isLatest === 1 && String(c.maSoThue || "").trim().toLowerCase() === mst
          );
        }
      } else if (apiType === "nhathau") {
        const maNT = String(item.maNhaThau || "").trim().toLowerCase();
        const mst = String(item.maSoThue || "").trim().toLowerCase();
        if (maNT) {
          fileDuplicate = seenKeys.has("nt_ma_" + maNT);
          seenKeys.add("nt_ma_" + maNT);
          dbExists = (this.model.state.nhathau || []).some(
            (n) => n.isLatest === 1 && String(n.maNhaThau || "").trim().toLowerCase() === maNT
          );
        }
        if (!fileDuplicate && !dbExists && mst) {
          fileDuplicate = seenKeys.has("nt_mst_" + mst);
          seenKeys.add("nt_mst_" + mst);
          dbExists = (this.model.state.nhathau || []).some(
            (n) => n.isLatest === 1 && String(n.maSoThue || "").trim().toLowerCase() === mst
          );
        }
      } else if (apiType === "chuyengia") {
        const cccd = String(item.soCCCD || "").trim().toLowerCase();
        const cc = String(item.soChungChi || "").trim().toLowerCase();
        if (cccd) {
          fileDuplicate = seenKeys.has("cg_cccd_" + cccd);
          seenKeys.add("cg_cccd_" + cccd);
          dbExists = (this.model.state.chuyengia || []).some(
            (c) => c.isLatest === 1 && String(c.soCCCD || "").trim().toLowerCase() === cccd
          );
        }
        if (!fileDuplicate && !dbExists && cc) {
          fileDuplicate = seenKeys.has("cg_cc_" + cc);
          seenKeys.add("cg_cc_" + cc);
          dbExists = (this.model.state.chuyengia || []).some(
            (c) => c.isLatest === 1 && String(c.soChungChi || "").trim().toLowerCase() === cc
          );
        }
      } else if (apiType === "hopdong") {
        uniqueKey = String(item.soHopDong || "").trim().toLowerCase();
        if (uniqueKey) {
          fileDuplicate = seenKeys.has("hd_" + uniqueKey);
          seenKeys.add("hd_" + uniqueKey);
          dbExists = (this.model.state.hopdong || []).some(
            (h) => h.isLatest === 1 && String(h.soHopDong || "").trim().toLowerCase() === uniqueKey
          );
        }
      }
      if (fileDuplicate) {
        isValid = false;
        comment = "Dòng trùng lặp trong file Excel đang nhập";
      } else if (dbExists) {
        operation = "update";
        comment = "Hợp lệ - sẽ cập nhật bản ghi hiện có";
      }
    }
    item._valid = isValid;
    item._comment = comment;
    item._operation = operation;
  });
}
