import { authFetchDownload } from "../utils/workflow_helpers.js";
import { triggerExcelTemplateDownload as triggerTemplateDownload } from "./excelTemplateAdapter.js";
import { ensureXlsxLoaded } from "../utils/externalAssets.js";
import { readExcelRows, showExcelImportSaveButton } from "./excelFileReader.js";
import {
  parseAwardResultImport,
  parseBidEvaluationImport,
  parseOpeningFinancialImport,
  parseOpeningImport
} from "./excelImportAdapters.js";
import { isBasicExcelImportType, saveBasicExcelImport, saveBusinessExcelImport } from "./excelSaveAdapters.js";
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
      if (file) this.handleExcelUpload(file);
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
        this.handleExcelUpload(file);
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
      authFetchDownload(`/api/export-excel-template/${type}`, `Mau_nhap_lieu_${type}.xlsx`);
    });
  }
}
export function triggerExcelImport(type) {
  if (type === "mothau" || type === "danhgiahsdt") {
    const select = document.getElementById(type + "-goithau-select");
    if (!select || !select.value) {
      this.view.customAlert("Chưa chọn gói thầu", "Vui lòng chọn một gói thầu trước khi nhập file Excel!", "alert-triangle");
      return;
    }
  }
  if (type === "ketquaqd") {
    const select = document.getElementById("result-goithau-select") || document.getElementById("danhgiahsdt-goithau-select") || document.getElementById("mothau-goithau-select");
    this._currentResultPackageId = select ? select.value : "";
  }
  this._excelImportType = type;
  let fileInput = document.getElementById("excel-file-input-temp");
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.id = "excel-file-input-temp";
    fileInput.type = "file";
    fileInput.accept = ".xlsx, .xls";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleExcelUpload(file);
      }
    });
  }
  fileInput.value = "";
  fileInput.click();
}
export function triggerExcelTemplateDownload(type) {
  triggerTemplateDownload(this, type);
}
async function renderClientExcelImport(controller, file, parser) {
  try {
    const rows = await readExcelRows(file);
    const parsedRows = await parser(controller, rows);
    if (!parsedRows) return;
    controller._excelImportData = parsedRows;
    controller.view.renderExcelPreview(controller._excelImportData, controller._excelImportType);
    showExcelImportSaveButton();
  } catch (err) {
    console.error(err);
    await controller.view.customAlert("Lỗi", "Không thể đọc tệp tin Excel này. Vui lòng kiểm tra lại!", "alert-triangle");
  }
}
export async function handleExcelUpload(file) {
  const fileInfo = document.getElementById("excel-file-info");
  if (fileInfo) {
    document.getElementById("excel-filename").textContent = file.name;
    document.getElementById("excel-filesize").textContent = (file.size / 1024).toFixed(2) + " KB";
    fileInfo.style.display = "flex";
  }
  if (this._excelImportType === "opening_fin") {
    await renderClientExcelImport(this, file, parseOpeningFinancialImport);
    return;
  }
  if (this._excelImportType === "danhgiahsdt") {
    await renderClientExcelImport(this, file, parseBidEvaluationImport);
    return;
  }
  if (this._excelImportType === "ketquaqd") {
    await renderClientExcelImport(this, file, parseAwardResultImport);
    return;
  }
  if (this._excelImportType === "mothau") {
    await renderClientExcelImport(this, file, parseOpeningImport);
    return;
  }
  let apiType = this._excelImportType;
  if (apiType === "plan") apiType = "kehoach";
  if (apiType === "package") apiType = "goithau";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", apiType);
  try {
    const res = await fetch("/api/import-excel", {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      const rawRows = data.rows || data.data || [];
      const seenKeys = /* @__PURE__ */ new Set();
      this._excelImportData = rawRows.map((row) => {
        const item = row.data || row;
        let isValid = true;
        let comment = "Hợp lệ";
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
            isValid = false;
            comment = "Dòng đã tồn tại trong hệ thống (trùng mã định danh/CCCD/số hợp đồng)";
          }
        }
        return {
          ...item,
          _valid: isValid,
          _comment: comment
        };
      });
      this.view.renderExcelPreview(this._excelImportData, this._excelImportType);
      const saveBtn = document.getElementById("btn-save-excel-import");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.display = "inline-flex";
      }
    } else {
      await this.view.customAlert("Thất bại", data.error || "Không thể đọc tệp tin Excel này.", "alert-triangle");
    }
  } catch (err) {
    await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
  }
}
export async function saveExcelImport() {
  if (!this._excelImportData || this._excelImportData.length === 0) return;
  const type = this._excelImportType;
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
  const basicImportCount = await saveBasicExcelImport(this, type, validRows);
  if (basicImportCount !== null) {
    count = basicImportCount;
    const stateKey = IMPORT_STATE_KEY[type];
    if (stateKey && this.model.currentPage) {
      this.model.currentPage[stateKey] = 1;
    }
  } else {
    const businessImportCount = await saveBusinessExcelImport(this, type, validRows);
    if (businessImportCount !== null) {
      count = businessImportCount;
    }
  }
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) return;
  this.view.closeModal("modal-excel-preview");
  await this.view.customAlert("Nhập khẩu thành công", `Đã nhập khẩu thành công ${count} dòng dữ liệu vào hệ thống!`, "check-circle");
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
  fetch("/api/export-phanlo-excel", {
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
  fetch("/api/export-phanlo-excel", {
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
  fetch("/api/export-tuychonmuathem-excel", {
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
  const XLSX = await ensureXlsxLoaded();
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = e.target.result;
      const workbook = XLSX.read(data, { type: "binary" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);
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
        this.view.customAlert("Nhập thành công", `Đã cập nhật/ghi đè giá trị bảo đảm cho ${count} phần lô từ file Excel!`, "check-circle");
      } else {
        this.view.customAlert("Không nhập được dữ liệu", "Không thể đồng bộ dữ liệu phần lô nào từ file Excel!", "alert-triangle");
      }
    } catch (err) {
      this.view.customAlert("Lỗi đọc file", "Không thể đọc file Excel: " + err.message, "x-circle");
    }
  };
  reader.readAsBinaryString(file);
}
export function revalidateExcelImportData() {
  const apiType = this._excelImportType;
  if (!this._excelImportData || this._excelImportData.length === 0) return;
  const seenKeys = /* @__PURE__ */ new Set();
  this._excelImportData.forEach((item) => {
    let isValid = true;
    let comment = "Hợp lệ";
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
        isValid = false;
        comment = "Dòng đã tồn tại trong hệ thống (trùng mã định danh/CCCD/số hợp đồng)";
      }
    }
    item._valid = isValid;
    item._comment = comment;
  });
}
