import { apiFetch, requestJson } from "../../shared/apiClient.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function buildAwardResultExcelButtonMarkup(enabled = false) {
  return `
    <button class="btn btn-outline action-strong" id="btn-export-award-result-excel"
      ${enabled ? "" : "disabled"}
      title="${enabled ? "Điền kết quả vào file Excel mẫu của muasamcong" : "Cần quyền truy cập và gói trả phí đang hoạt động để xuất Excel"}">
      <i data-lucide="sheet"></i> Xuất file nhập kết quả muasamcong
    </button>`;
}

export function buildAwardResultExcelPanelMarkup() {
  return `
    <section class="award-result-excel-panel" id="award-result-excel-panel" hidden
      aria-labelledby="award-result-excel-title">
      <div class="award-result-excel-panel-header">
        <div>
          <h5 id="award-result-excel-title">Điền file kết quả muasamcong</h5>
          <p class="text-muted">Chọn file .xlsx, kiểm tra đối chiếu rồi xác nhận tải file đã điền.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-award-excel-close
          aria-label="Đóng khu vực xuất Excel"><i data-lucide="x"></i></button>
      </div>
      <div class="award-result-excel-file-row">
        <label class="btn btn-outline" for="award-result-excel-file">
          <i data-lucide="upload"></i> Chọn file .xlsx
        </label>
        <input id="award-result-excel-file" type="file" accept=".xlsx,${XLSX_MIME}" hidden>
        <span class="award-result-excel-file-name" data-award-excel-file-name>Chưa chọn file</span>
        <button type="button" class="btn btn-primary" data-award-excel-validate disabled>
          Tải lên và kiểm tra
        </button>
      </div>
      <div class="award-result-excel-status" data-award-excel-status role="status" aria-live="polite"></div>
      <div data-award-excel-summary></div>
      <div class="award-result-excel-actions">
        <button type="button" class="btn btn-primary" data-award-excel-confirm disabled>
          <i data-lucide="download"></i> Xác nhận và tải file kết quả
        </button>
      </div>
    </section>`;
}

function issueList(title, issues, kind) {
  if (!Array.isArray(issues) || issues.length === 0) return "";
  return `
    <div class="award-result-excel-issues is-${kind}">
      <h6>${escapeHtml(title)} (${issues.length})</h6>
      <ul>${issues.map((issue) => `
        <li>${issue?.excelRow ? `<strong>Dòng ${escapeHtml(issue.excelRow)}:</strong> ` : ""}${escapeHtml(issue?.message || issue?.code || "Lỗi không xác định")}</li>
      `).join("")}</ul>
    </div>`;
}

export function buildAwardResultValidationMarkup(result = {}) {
  const metrics = [
    ["Tổng dòng", result.totalRows],
    ["Khớp mã định danh", result.exactMatches],
    ["Khớp mã số thuế", result.fallbackMatches],
    ["Không tìm thấy", result.unmatchedRows],
    ["Trùng khóa", result.duplicateRows],
    ["Xung đột", result.conflictRows],
    ["Thiếu mã phần/lô", result.missingLotRows],
    ["Thiếu định danh", result.missingBidderIdentityRows],
    ["Đã có dữ liệu kết quả", result.existingResultRows],
  ];
  return `
    <div class="award-result-excel-summary" aria-label="Báo cáo đối chiếu Excel">
      ${metrics.map(([label, value]) => `
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></div>
      `).join("")}
    </div>
    ${issueList("Lỗi chặn xuất file", result.blockingErrors, "error")}
    ${issueList("Cảnh báo", result.warnings, "warning")}
  `;
}

function readableFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function responseFilename(response, fallback) {
  const disposition = response?.headers?.get?.("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use fallback */ }
  }
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || fallback;
}

async function errorFromResponse(response) {
  try {
    const payload = await response.json();
    return new Error(payload?.error || payload?.message || "Không thể xuất file Excel.");
  } catch {
    return new Error("Không thể xuất file Excel.");
  }
}

function setTrustedMarkup(element, markup) {
  element.innerHTML = trustedHTML(markup);
}

export function bindAwardResultExcelExport(root, {
  packageId,
  packageCode = "GoiThau",
  requestJsonImpl = requestJson,
  apiFetchImpl = apiFetch,
  setMarkupImpl = setTrustedMarkup,
  onError,
  refreshIcons,
} = {}) {
  if (!root || !packageId) return null;
  const openButton = root.querySelector?.("#btn-export-award-result-excel");
  const panel = root.querySelector?.("#award-result-excel-panel");
  if (!openButton || !panel) return null;
  const input = panel.querySelector("#award-result-excel-file");
  const filename = panel.querySelector("[data-award-excel-file-name]");
  const validateButton = panel.querySelector("[data-award-excel-validate]");
  const confirmButton = panel.querySelector("[data-award-excel-confirm]");
  const status = panel.querySelector("[data-award-excel-status]");
  const summary = panel.querySelector("[data-award-excel-summary]");
  let validationToken = "";
  let selectedFile = null;
  let busy = false;

  const setBusy = (value, message = "") => {
    busy = value;
    input.disabled = value;
    validateButton.disabled = value || !selectedFile;
    confirmButton.disabled = value || !validationToken;
    status.textContent = message;
  };

  const clearValidation = () => {
    validationToken = "";
    confirmButton.disabled = true;
    setMarkupImpl(summary, "");
  };

  const validateSelectedFile = async () => {
    if (!selectedFile || busy) return null;
    clearValidation();
    setBusy(true, "Đang tải lên và kiểm tra file...");
    try {
      const form = new FormData();
      form.append("file", selectedFile, selectedFile.name);
      const result = await requestJsonImpl(
        `/api/packages/${encodeURIComponent(packageId)}/award-result-excel/validate`,
        { method: "POST", body: form, retries: 0, timeoutMs: 120_000 },
      );
      setMarkupImpl(summary, buildAwardResultValidationMarkup(result));
      const blocked = Array.isArray(result?.blockingErrors) && result.blockingErrors.length > 0;
      validationToken = blocked ? "" : String(result?.validationToken || "");
      status.textContent = blocked
        ? "File có lỗi chặn xuất. Vui lòng sửa các dòng được nêu bên dưới."
        : "Đã kiểm tra xong. Hãy xem cảnh báo trước khi xác nhận xuất file.";
      return result;
    } catch (error) {
      status.textContent = "Không thể kiểm tra file Excel.";
      await onError?.(error);
      return null;
    } finally {
      setBusy(false, status.textContent);
      refreshIcons?.();
    }
  };

  const exportValidatedFile = async () => {
    if (!validationToken || busy) return false;
    setBusy(true, "Đang điền dữ liệu và tạo file kết quả...");
    try {
      const response = await apiFetchImpl(
        `/api/packages/${encodeURIComponent(packageId)}/award-result-excel/export`,
        {
          method: "POST",
          body: JSON.stringify({ validationToken }),
          headers: { "Content-Type": "application/json" },
          retries: 0,
          timeoutMs: 120_000,
        },
      );
      if (!response.ok) throw await errorFromResponse(response);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = responseFilename(
        response,
        `${packageCode}_da_dien_ket_qua.xlsx`,
      );
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      validationToken = "";
      status.textContent = "Đã tạo và tải file Excel kết quả.";
      return true;
    } catch (error) {
      status.textContent = "Không thể tạo file Excel kết quả.";
      await onError?.(error);
      return false;
    } finally {
      setBusy(false, status.textContent);
      refreshIcons?.();
    }
  };

  openButton.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) input.focus?.();
    refreshIcons?.();
  });
  panel.querySelector("[data-award-excel-close]")?.addEventListener("click", () => {
    panel.hidden = true;
    openButton.focus?.();
  });
  input.addEventListener("change", () => {
    selectedFile = input.files?.[0] || null;
    clearValidation();
    if (!selectedFile) {
      filename.textContent = "Chưa chọn file";
      validateButton.disabled = true;
      return;
    }
    filename.textContent = `${selectedFile.name} · ${readableFileSize(selectedFile.size)}`;
    const valid = selectedFile.name.toLocaleLowerCase("vi-VN").endsWith(".xlsx")
      && selectedFile.size > 0
      && selectedFile.size <= MAX_FILE_BYTES;
    validateButton.disabled = !valid;
    status.textContent = valid
      ? "File đã sẵn sàng để kiểm tra."
      : "Chỉ chấp nhận file .xlsx có dung lượng từ 1 byte đến 10 MB.";
  });
  validateButton.addEventListener("click", validateSelectedFile);
  confirmButton.addEventListener("click", exportValidatedFile);

  return { validateSelectedFile, exportValidatedFile };
}
