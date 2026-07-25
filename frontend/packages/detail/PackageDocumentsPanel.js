import { apiFetch, getJson, requestJson } from "../../shared/apiClient.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx"]);

export function formatPackageDocumentBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) return "Không rõ thời gian";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function slotMarkup(slot) {
  const type = escapeHtml(slot?.type || "");
  const label = escapeHtml(slot?.label || "Tài liệu");
  const icon = escapeHtml(slot?.icon || "file-text");
  const document = slot?.document;
  const canUpload = slot?.canUpload === true;
  const canDelete = slot?.canDelete === true;
  const fileMarkup = document
    ? `
      <div class="package-document-file">
        <div class="package-document-file-icon" aria-hidden="true">
          <i data-lucide="file-check-2"></i>
        </div>
        <div class="package-document-file-copy">
          <strong title="${escapeHtml(document.originalFilename || "")}">${escapeHtml(document.originalFilename || "Tài liệu")}</strong>
          <span>${formatPackageDocumentBytes(document.sizeBytes)} · ${escapeHtml(document.uploadedByName || "Người dùng")} · ${escapeHtml(formatUploadedAt(document.uploadedAt))}</span>
        </div>
      </div>`
    : `
      <div class="package-document-empty">
        <span>Chưa có tài liệu</span>
        <small>PDF, DOCX hoặc XLSX · tối đa 25 MB</small>
      </div>`;
  const uploadLabel = document ? "Thay file" : "Chọn file";
  return `
    <article class="package-document-card" data-document-card="${type}" role="row">
      <div class="package-document-type-cell" role="cell">
        <span class="package-document-cell-label">Loại tài liệu</span>
        <div class="package-document-card-header">
          <span class="package-document-type-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span>
          <div>
            <h4>${label}</h4>
            <span class="package-document-status ${document ? "is-ready" : ""}">${document ? "Đã tải lên" : "Chưa đính kèm"}</span>
          </div>
        </div>
      </div>
      <div class="package-document-card-body" role="cell">
        <span class="package-document-cell-label">Tài liệu</span>
        ${fileMarkup}
      </div>
      <div class="package-document-action-cell" role="cell">
        <span class="package-document-cell-label">Thao tác</span>
        <footer class="package-document-actions">
          ${document ? `<button type="button" class="btn btn-outline" data-document-download="${type}"><i data-lucide="download"></i> Tải xuống</button>` : ""}
          ${canUpload ? `
            <input class="package-document-input" type="file" id="package-document-${type}" data-document-input="${type}" accept=".pdf,.docx,.xlsx" hidden>
            <button type="button" class="btn ${document ? "btn-outline-primary" : "btn-primary"}" data-document-upload="${type}">
              <i data-lucide="${document ? "refresh-cw" : "upload-cloud"}"></i> ${uploadLabel}
            </button>` : ""}
          ${document && canDelete ? `<button type="button" class="btn package-document-delete" data-document-delete="${type}" aria-label="Xóa ${label}"><i data-lucide="trash-2"></i> Xóa</button>` : ""}
        </footer>
        <p class="package-document-live-status" data-document-status="${type}" aria-live="polite"></p>
      </div>
    </article>`;
}

export function buildPackageDocumentsMarkup(data) {
  const slots = Array.isArray(data?.slots) ? data.slots : [];
  const content = slots.length
    ? `
      <div class="package-documents-table" role="table" aria-label="Danh sách tài liệu gói thầu">
        <div class="package-documents-table-head" role="rowgroup">
          <div class="package-documents-table-header" role="row">
            <span role="columnheader">Loại tài liệu</span>
            <span role="columnheader">Tài liệu</span>
            <span role="columnheader">Thao tác</span>
          </div>
        </div>
        <div class="package-documents-table-body" role="rowgroup">
          ${slots.map(slotMarkup).join("")}
        </div>
      </div>`
    : `
      <div class="package-documents-empty-state">
        <span aria-hidden="true"><i data-lucide="folder-open"></i></span>
        <h4>Chưa có tài liệu ở bước này</h4>
        <p>Các tài liệu đã tải sẽ tiếp tục hiển thị tại đây khi gói thầu chuyển bước.</p>
      </div>`;
  return `
    <section class="package-documents-panel" aria-label="Tài liệu gói thầu">
      ${content}
    </section>`;
}

function loadingMarkup() {
  return `
    <div class="package-documents-loading" role="status">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>Đang tải danh sách tài liệu...</span>
    </div>`;
}

function errorMarkup(message) {
  return `
    <div class="package-documents-error" role="alert">
      <i data-lucide="circle-alert" aria-hidden="true"></i>
      <div><strong>Không tải được tài liệu</strong><p>${escapeHtml(message || "Vui lòng thử lại.")}</p></div>
      <button type="button" class="btn btn-outline" data-document-retry><i data-lucide="refresh-cw"></i> Thử lại</button>
    </div>`;
}

function currentPanelStillActive(view, packageId) {
  return String(view?._currentWorkflowPackageId || "") === String(packageId)
    && view?._currentWorkflowTab === "documents";
}

async function downloadDocument(view, packageId, slot) {
  const status = document.querySelector(`[data-document-status="${CSS.escape(slot.type)}"]`);
  if (status) status.textContent = "Đang chuẩn bị file tải xuống...";
  try {
    const response = await apiFetch(
      `/api/packages/${encodeURIComponent(packageId)}/documents/${encodeURIComponent(slot.type)}/download`,
      { timeoutMs: 120_000, retries: 0 },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "Không thể tải tài liệu.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = slot.document?.originalFilename || "tai-lieu";
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    if (status) status.textContent = "";
  } catch (error) {
    if (status) status.textContent = "";
    await view.customAlert("Không thể tải file", error?.message || "Vui lòng thử lại.", "circle-alert");
  }
}

async function uploadDocument(view, packageId, slot, file, contentWrapper) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (!file || !ALLOWED_EXTENSIONS.has(extension)) {
    await view.customAlert("Tệp không hợp lệ", "Chỉ hỗ trợ tệp PDF, DOCX hoặc XLSX.", "alert-triangle");
    return;
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    await view.customAlert("Tệp không hợp lệ", "Dung lượng tệp phải lớn hơn 0 và không vượt quá 25 MB.", "alert-triangle");
    return;
  }
  const card = contentWrapper.querySelector(`[data-document-card="${CSS.escape(slot.type)}"]`);
  const status = card?.querySelector("[data-document-status]");
  const buttons = card?.querySelectorAll("button");
  buttons?.forEach((button) => { button.disabled = true; });
  if (status) status.textContent = "Đang tải lên và kiểm tra tệp...";
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    await requestJson(
      `/api/packages/${encodeURIComponent(packageId)}/documents/${encodeURIComponent(slot.type)}`,
      {
        method: "PUT",
        body: form,
        retries: 0,
        timeoutMs: 120_000,
      },
    );
    await view.customAlert("Thành công", slot.document ? "Đã thay file tài liệu." : "Đã tải tài liệu lên.", "check-circle");
    await renderPackageDocumentsPanel(view, { contentWrapper, packageId });
  } catch (error) {
    buttons?.forEach((button) => { button.disabled = false; });
    if (status) status.textContent = "";
    await view.customAlert("Không thể tải file", error?.message || "Vui lòng thử lại.", "circle-alert");
  }
}

async function deleteDocument(view, packageId, slot, contentWrapper) {
  const confirmed = await view.customConfirm(
    "Xóa tài liệu",
    `Bạn có chắc chắn muốn xóa "${slot.label}"?`,
    "trash-2",
  );
  if (!confirmed) return;
  try {
    await requestJson(
      `/api/packages/${encodeURIComponent(packageId)}/documents/${encodeURIComponent(slot.type)}`,
      { method: "DELETE", retries: 0 },
    );
    await view.customAlert("Thành công", "Đã xóa tài liệu.", "check-circle");
    await renderPackageDocumentsPanel(view, { contentWrapper, packageId });
  } catch (error) {
    await view.customAlert("Không thể xóa", error?.message || "Vui lòng thử lại.", "circle-alert");
  }
}

function bindDocumentActions(view, packageId, data, contentWrapper) {
  const slotsByType = new Map((data.slots || []).map((slot) => [slot.type, slot]));
  contentWrapper.querySelectorAll("[data-document-upload]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.getAttribute("data-document-upload");
      contentWrapper.querySelector(`[data-document-input="${CSS.escape(type)}"]`)?.click();
    });
  });
  contentWrapper.querySelectorAll("[data-document-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const type = input.getAttribute("data-document-input");
      const slot = slotsByType.get(type);
      const file = input.files?.[0];
      if (slot && file) await uploadDocument(view, packageId, slot, file, contentWrapper);
      input.value = "";
    });
  });
  contentWrapper.querySelectorAll("[data-document-download]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = slotsByType.get(button.getAttribute("data-document-download"));
      if (slot) await downloadDocument(view, packageId, slot);
    });
  });
  contentWrapper.querySelectorAll("[data-document-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = slotsByType.get(button.getAttribute("data-document-delete"));
      if (slot) await deleteDocument(view, packageId, slot, contentWrapper);
    });
  });
}

export async function renderPackageDocumentsPanel(view, { contentWrapper, packageId }) {
  contentWrapper.innerHTML = trustedHTML(loadingMarkup());
  try {
    const data = await getJson(
      `/api/packages/${encodeURIComponent(packageId)}/documents`,
      { retries: 0 },
    );
    if (!currentPanelStillActive(view, packageId)) return;
    contentWrapper.innerHTML = trustedHTML(buildPackageDocumentsMarkup(data));
    bindDocumentActions(view, packageId, data, contentWrapper);
    globalThis.lucide?.createIcons?.();
  } catch (error) {
    if (!currentPanelStillActive(view, packageId)) return;
    contentWrapper.innerHTML = trustedHTML(errorMarkup(error?.message));
    contentWrapper.querySelector("[data-document-retry]")?.addEventListener("click", () => {
      renderPackageDocumentsPanel(view, { contentWrapper, packageId });
    });
    globalThis.lucide?.createIcons?.();
  }
}
