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
        <button type="button" class="btn btn-outline" data-award-excel-reconciliation disabled>
          <i data-lucide="list-checks"></i> Tải báo cáo đối chiếu
        </button>
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

function previewTable(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const filters = result?.previewFilters || {};
  const displayValue = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  };
  const selected = (actual, expected) => String(actual ?? "") === expected ? " selected" : "";
  const tableRows = rows.flatMap((row) => {
    const changes = Array.isArray(row.changes) && row.changes.length
      ? row.changes
      : [{ field: "-", oldValue: null, newValue: null, source: "-" }];
    return changes.map((change) => `<tr>
      <td>${escapeHtml(row.excelRow ?? "")}</td>
      <td>${escapeHtml(row.lotCode || "")}</td>
      <td>${escapeHtml(row.bidderName || "")}</td>
      <td>${escapeHtml(row.matchMethod || "-")}</td>
      <td>${escapeHtml(change.field || "-")}</td>
      <td>${escapeHtml(displayValue(change.oldValue))}</td>
      <td>${escapeHtml(displayValue(change.newValue))}</td>
      <td>${escapeHtml(change.source || "-")}</td>
      <td>${escapeHtml((row.warnings || []).map((item) => item.code).join(", ") || "-")}</td>
    </tr>`);
  }).join("");
  return `
    <div class="award-result-excel-preview">
      <div class="award-result-excel-preview-filters" aria-label="Bộ lọc đối chiếu">
        <label>Trạng thái
          <select data-award-preview-filter="status">
            <option value="">Tất cả</option>
            <option value="matched"${selected(filters.status, "matched")}>Đã khớp</option>
            <option value="unmatched"${selected(filters.status, "unmatched")}>Chưa khớp</option>
          </select>
        </label>
        <label>Phương pháp khớp
          <select data-award-preview-filter="matchMethod">
            <option value="">Tất cả</option>
            <option value="lot_code_and_bidder_identifier"${selected(filters.matchMethod, "lot_code_and_bidder_identifier")}>Mã định danh</option>
            <option value="lot_code_and_tax_code"${selected(filters.matchMethod, "lot_code_and_tax_code")}>Mã số thuế</option>
          </select>
        </label>
        <label>Dòng sẽ ghi
          <select data-award-preview-filter="writable">
            <option value="">Tất cả</option>
            <option value="true"${selected(filters.writable, "true")}>Có</option>
            <option value="false"${selected(filters.writable, "false")}>Không</option>
          </select>
        </label>
        <label>Mã cảnh báo
          <input data-award-preview-filter="warning" value="${escapeHtml(filters.warning || "")}" maxlength="100" placeholder="Ví dụ RESULT_NOT_FOUND">
        </label>
      </div>
      <table>
        <thead><tr>
          <th>Dòng</th><th>Phần/lô</th><th>Nhà thầu</th><th>Match</th>
          <th>Cột</th><th>Giá trị cũ</th><th>Giá trị mới</th><th>Nguồn</th><th>Cảnh báo</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="9">Không có dòng phù hợp bộ lọc.</td></tr>`}</tbody>
      </table>
      <div class="award-result-excel-pagination" aria-label="Phân trang đối chiếu">
        <button type="button" class="btn btn-outline btn-sm" data-award-preview-page="previous"
          ${result.hasPreviousPage ? "" : "disabled"}>Trang trước</button>
        <span>Trang ${escapeHtml(result.page || 1)} / ${escapeHtml(result.totalPages || 1)} · ${escapeHtml(result.filteredRows ?? rows.length)} dòng</span>
        <button type="button" class="btn btn-outline btn-sm" data-award-preview-page="next"
          ${result.hasNextPage ? "" : "disabled"}>Trang sau</button>
      </div>
      ${Number(result.remainingRows) > 0
        ? `<p class="text-muted">Còn ${escapeHtml(result.remainingRows)} dòng.</p>`
        : ""}
    </div>`;
}

export function buildAwardResultValidationMarkup(result = {}) {
  const metrics = [
    ["Tổng dòng", result.totalRows],
    ["Đã đối chiếu", result.matchedRows],
    ["Đã phê duyệt", result.approvedRows],
    ["Sẽ cập nhật", result.writableRows],
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
    ${previewTable(result)}
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
  const reconciliationButton = panel.querySelector("[data-award-excel-reconciliation]");
  const status = panel.querySelector("[data-award-excel-status]");
  const summary = panel.querySelector("[data-award-excel-summary]");
  let validationToken = "";
  let selectedFile = null;
  let busy = false;
  let currentResult = null;
  let previewFilters = {
    status: "", warning: "", matchMethod: "", writable: "",
  };

  const setBusy = (value, message = "") => {
    busy = value;
    input.disabled = value;
    validateButton.disabled = value || !selectedFile;
    confirmButton.disabled = value || !validationToken;
    if (reconciliationButton) reconciliationButton.disabled = value || !validationToken;
    status.textContent = message;
  };

  const clearValidation = ({ cancel = true } = {}) => {
    const previousToken = validationToken;
    validationToken = "";
    currentResult = null;
    previewFilters = { status: "", warning: "", matchMethod: "", writable: "" };
    confirmButton.disabled = true;
    if (reconciliationButton) reconciliationButton.disabled = true;
    setMarkupImpl(summary, "");
    if (cancel && previousToken) {
      void apiFetchImpl(
        `/api/packages/${encodeURIComponent(packageId)}/award-result-excel/validation`,
        {
          method: "DELETE",
          body: JSON.stringify({ validationToken: previousToken }),
          headers: { "Content-Type": "application/json" },
          retries: 0,
        },
      ).catch(() => {});
    }
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
      currentResult = { ...result, previewFilters };
      setMarkupImpl(summary, buildAwardResultValidationMarkup(currentResult));
      const blocked = Array.isArray(result?.blockingErrors) && result.blockingErrors.length > 0;
      const noWritableRows = Number(result?.writableRows) === 0;
      validationToken = blocked || noWritableRows
        ? ""
        : String(result?.validationToken || "");
      status.textContent = blocked
        ? "File có lỗi chặn xuất. Vui lòng sửa các dòng được nêu bên dưới."
        : noWritableRows
          ? "Không có dòng kết quả đã phê duyệt có thể ghi vào file."
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

  const loadPreview = async ({ page, ...filterChanges } = {}) => {
    if (!validationToken || busy) return null;
    previewFilters = { ...previewFilters, ...filterChanges };
    const targetPage = Math.max(1, Number(page || 1));
    const query = new URLSearchParams({
      validationToken,
      page: String(targetPage),
      pageSize: "100",
    });
    for (const [key, value] of Object.entries(previewFilters)) {
      if (value !== "" && value !== null && value !== undefined) query.set(key, String(value));
    }
    setBusy(true, "Đang tải trang đối chiếu...");
    try {
      const result = await requestJsonImpl(
        `/api/packages/${encodeURIComponent(packageId)}/award-result-excel/preview?${query}`,
        { method: "GET", retries: 0, timeoutMs: 120_000 },
      );
      currentResult = { ...result, previewFilters };
      setMarkupImpl(summary, buildAwardResultValidationMarkup(currentResult));
      status.textContent = `Đang xem trang ${result.page || 1}/${result.totalPages || 1}; ${result.filteredRows || 0} dòng phù hợp.`;
      return result;
    } catch (error) {
      status.textContent = "Không thể tải trang đối chiếu.";
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
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      clearValidation({ cancel: false });
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

  const downloadReconciliation = async () => {
    if (!validationToken || busy) return false;
    setBusy(true, "Đang tạo báo cáo đối chiếu...");
    try {
      const response = await apiFetchImpl(
        `/api/packages/${encodeURIComponent(packageId)}/award-result-excel/reconciliation`,
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
        `${packageCode}_bao_cao_doi_chieu.xlsx`,
      );
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      status.textContent = "Đã tạo và tải báo cáo đối chiếu.";
      return true;
    } catch (error) {
      status.textContent = "Không thể tạo báo cáo đối chiếu.";
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
    clearValidation();
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
  reconciliationButton?.addEventListener("click", downloadReconciliation);
  summary.addEventListener?.("click", (event) => {
    const control = event.target?.closest?.("[data-award-preview-page]");
    if (!control || control.disabled) return;
    const direction = control.dataset.awardPreviewPage;
    const currentPage = Number(currentResult?.page || 1);
    void loadPreview({ page: direction === "previous" ? currentPage - 1 : currentPage + 1 });
  });
  summary.addEventListener?.("change", (event) => {
    const control = event.target?.closest?.("[data-award-preview-filter]");
    if (!control) return;
    void loadPreview({ page: 1, [control.dataset.awardPreviewFilter]: control.value });
  });

  return {
    validateSelectedFile,
    loadPreview,
    downloadReconciliation,
    exportValidatedFile,
  };
}
