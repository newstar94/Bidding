import { trustedHTML } from "../shared/trustedTypes.js";
import { apiFetch } from "../shared/apiClient.js";
import { captureWorkspaceLease, isWorkspaceLeaseCurrent } from "./workspaceLease.js";

export function setupInlineExcelControls(controller) {
  bindInlineExcelPair({
    templateButtonId: "btn-template-phanlo",
    importButtonId: "btn-import-excel-phanlo",
    inputId: "excel-file-input-phanlo",
    importType: "phanlo",
    exportTemplate: () => controller.exportEditPhanLoExcel(),
    upload: (file, type) => handleInlineExcelUpload(controller, file, type)
  });
  bindInlineExcelPair({
    templateButtonId: "btn-template-tuychonmuathem",
    importButtonId: "btn-import-excel-tuychonmuathem",
    inputId: "excel-file-input-tuychonmuathem",
    importType: "tuychonmuathem",
    exportTemplate: () => controller.exportEditTuyChonMuaThemExcel(),
    upload: (file, type) => handleInlineExcelUpload(controller, file, type)
  });
}
function bindInlineExcelPair({ templateButtonId, importButtonId, inputId, importType, exportTemplate, upload }) {
  const templateButton = document.getElementById(templateButtonId);
  const importButton = document.getElementById(importButtonId);
  const input = document.getElementById(inputId);
  if (templateButton && !templateButton._hasInlineExcelListener) {
    templateButton._hasInlineExcelListener = true;
    templateButton.addEventListener("click", exportTemplate);
  }
  if (importButton && input && !importButton._hasInlineExcelListener) {
    importButton._hasInlineExcelListener = true;
    input._hasInlineExcelListener = true;
    importButton.addEventListener("click", () => input.click());
    input.addEventListener("change", (event) => {
      if (event.target.files.length > 0) {
        upload(event.target.files[0], importType);
        input.value = "";
      }
    });
  }
}
function handleInlineExcelUpload(controller, file, type) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("type", type);
  const tbody = document.getElementById(`${type}-tbody`);
  if (!tbody) return;
  const workspace = captureWorkspaceLease(controller.model);
  const packageField = document.getElementById("form-goithau-id");
  const packageId = String(packageField?.value || "");
  const modal = tbody.closest(".modal-overlay");
  let closed = false;
  const lifetime = modal ? new MutationObserver((changes) => {
    if (changes.some((change) => !String(change.oldValue || "").split(/\s+/u).includes("active"))
        || !modal.classList.contains("active")) closed = true;
  }) : null;
  lifetime?.observe(modal, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  controller._inlineExcelRequests ||= new Map();
  const request = {};
  controller._inlineExcelRequests.set(type, request);
  const originalHTML = tbody.innerHTML;
  tbody.innerHTML = trustedHTML(`<tr><td colspan="${type === "phanlo" ? 5 : 6}" class="bf-s-d6ce8fac83">
        Đang tải dữ liệu và phân tích file Excel...
    </td></tr>`);
  const pendingHTML = tbody.innerHTML;
  const isCurrent = () => !closed && controller._inlineExcelRequests.get(type) === request
    && isWorkspaceLeaseCurrent(controller.model, workspace)
    && document.getElementById(`${type}-tbody`) === tbody && tbody.isConnected
    && document.getElementById("form-goithau-id") === packageField
    && String(packageField?.value || "") === packageId
    && (!modal || (modal.isConnected && modal.classList.contains("active")))
    && tbody.innerHTML === pendingHTML;
  return apiFetch("/api/import-excel", {
    method: "POST",
    body: fd
  }).then((res) => res.json()).then((data) => {
    if (!isCurrent()) return;
    if (data.success) {
      tbody.innerHTML = trustedHTML("");
      const validRows = data.rows.filter((r) => r._valid);
      if (validRows.length === 0) {
        controller.view.customAlert("Không có dữ liệu", "Không tìm thấy dòng dữ liệu hợp lệ nào trong tệp Excel!", "alert-triangle");
        tbody.innerHTML = trustedHTML(originalHTML);
        return;
      }
      validRows.forEach((row) => {
        delete row._valid;
        delete row._comment;
        if (type === "phanlo") {
          controller.addPhanLoRow(row);
        } else if (type === "tuychonmuathem") {
          controller.addTuyChonMuaThemRow(row);
        }
      });
      controller.view.customAlert("Nhập thành công", `Đã nhập thành công ${validRows.length} dòng dữ liệu từ Excel vào bảng!`, "check-circle");
    } else {
      controller.view.customAlert("Lỗi phân tích", "Lỗi phân tích Excel: " + (data.error || "Không rõ nguyên nhân"), "x-circle");
      tbody.innerHTML = trustedHTML(originalHTML);
    }
  }).catch((err) => {
    if (!isCurrent()) return;
    controller.view.customAlert("Lỗi kết nối", "Lỗi kết nối: " + err.message, "x-circle");
    tbody.innerHTML = trustedHTML(originalHTML);
  }).finally(() => {
    lifetime?.disconnect();
    if (controller._inlineExcelRequests.get(type) === request) controller._inlineExcelRequests.delete(type);
  });
}
