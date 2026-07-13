import { escapeHtml } from "../../../../views/subviews/view_helpers.js";

export function renderOpeningPanel(container, pkg, { isDirectOrSpecial = false } = {}) {
  if (!container) return;
  const packageId = escapeHtml(pkg?.id || "");
  const packageName = escapeHtml(pkg?.tenGoiThau || "");
  const title = isDirectOrSpecial ? "Danh sách Nhà thầu" : "Danh sách Nhà thầu tham dự &amp; Nộp hồ sơ";
  const addLabel = isDirectOrSpecial ? "Thêm nhà thầu" : "Thêm Nhà thầu nộp hồ sơ";
  const saveLabel = isDirectOrSpecial ? "Lưu thông tin" : "Lưu thông tin mở thầu";
  container.innerHTML = `
    <select id="mothau-goithau-select" class="is-hidden"><option value="${packageId}" selected>${packageName}</option></select>
    <div id="mothau-goithau-summary" class="is-hidden"></div>
    <div id="mothau-bid-container" class="is-hidden">
      <div class="package-section-header">
        <h4 id="mothau-table-title" class="package-section-title is-neutral">${title}</h4>
        <div class="compact-action-group">
          <button class="btn-excel-action btn-download-excel-template-direct" data-type="mothau" id="btn-mothau-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
          <button class="btn-excel-action btn-import-excel-direct" data-type="mothau" id="btn-mothau-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
          <button class="btn btn-outline btn-sm compact-action" id="btn-mothau-add-bid"><i data-lucide="plus"></i> ${addLabel}</button>
        </div>
      </div>
      <div class="table-container package-table-frame has-bottom-space">
        <table class="data-table table-full-width" id="mothau-table">
          <thead id="mothau-table-thead"></thead>
          <tbody id="mothau-table-tbody"></tbody>
        </table>
      </div>
      <div class="workflow-action-row">
        <button class="btn btn-primary workflow-primary-action" id="btn-mothau-save"><i data-lucide="save"></i> ${saveLabel}</button>
      </div>
    </div>
    <div id="mothau-empty-state" class="is-hidden"></div>
  `;
}
