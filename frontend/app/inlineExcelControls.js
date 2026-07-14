import { apiFetch } from "../shared/apiClient.js";

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
  const originalHTML = tbody.innerHTML;
  tbody.innerHTML = `<tr><td colspan="${type === "phanlo" ? 5 : 6}" style="text-align: center; padding: 20px; font-weight: bold; color: var(--primary);">
        Đang tải dữ liệu và phân tích file Excel...
    </td></tr>`;
  apiFetch("/api/import-excel", {
    method: "POST",
    body: fd
  }).then((res) => res.json()).then((data) => {
    if (data.success) {
      tbody.innerHTML = "";
      const validRows = data.rows.filter((r) => r._valid);
      if (validRows.length === 0) {
        controller.view.customAlert("Không có dữ liệu", "Không tìm thấy dòng dữ liệu hợp lệ nào trong tệp Excel!", "alert-triangle");
        tbody.innerHTML = originalHTML;
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
      tbody.innerHTML = originalHTML;
    }
  }).catch((err) => {
    controller.view.customAlert("Lỗi kết nối", "Lỗi kết nối: " + err.message, "x-circle");
    tbody.innerHTML = originalHTML;
  });
}
