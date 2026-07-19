import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";

export function renderEvaluationPanel(container, pkg, {
  mode = "technical",
  inviteComparisonLabel = "Ngày mời đối chiếu tài liệu",
  comparisonLabel = "Ngày đối chiếu tài liệu"
} = {}) {
  if (!container) return;
  const isTechnical = mode === "technical";
  const packageId = escapeHtml(pkg?.id || "");
  const packageName = escapeHtml(pkg?.tenGoiThau || "");
  const processOptions = isTechnical ? `
    <div id="danhgiahsdt-quytrinh-container" class="evaluation-process-options bf-s-6aa34d7432">
      <span class="evaluation-process-title">Quy trình đánh giá:</span>
      <label class="evaluation-process-choice">
        <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh1" checked class="evaluation-choice-input"> Quy trình 1
      </label>
      <label class="evaluation-process-choice">
        <input type="radio" name="danhgiahsdt-quytrinh" value="quytrinh2" class="evaluation-choice-input"> Quy trình 2
      </label>
      <label class="evaluation-process-choice is-separated">
        <input type="checkbox" id="eval-co-uu-dai" class="evaluation-choice-input"> Có nhà thầu được hưởng ưu đãi
      </label>
      <span id="quytrinh2-warning-msg" class="evaluation-warning bf-s-65d1f1c3d7"></span>
    </div>
  ` : "";
  container.innerHTML = trustedHTML(`
    <select id="danhgiahsdt-goithau-select" class="bf-s-6aa34d7432"><option value="${packageId}" selected>${packageName}</option></select>
    <div id="danhgiahsdt-goithau-summary" class="bf-s-6aa34d7432"></div>
    <div id="danhgiahsdt-container" class="bf-s-6aa34d7432">
      <div id="danhgiahsdt-tabs-header" class="bf-s-6aa34d7432">
        <button type="button" id="tab-btn-hsdxt-kt" class="${isTechnical ? "active" : ""}">KT</button>
        <button type="button" id="tab-btn-hsdxt-tc" class="${isTechnical ? "" : "active"}">TC</button>
      </div>
      <div id="danhgiahsdt-fields-row" class="form-grid evaluation-field-grid">
        <div class="form-group">
          <label class="evaluation-field-label">Số báo cáo đánh giá <span class="required">*</span></label>
          <input type="text" id="danhgiahsdt-so-baocao" class="form-control" required placeholder="Ví dụ: 12/BC-TCD">
          <span class="error-text">Vui lòng nhập số báo cáo đánh giá</span>
        </div>
        <div class="form-group">
          <label class="evaluation-field-label">Ngày báo cáo đánh giá <span class="required">*</span></label>
          <input type="text" id="danhgiahsdt-ngay-baocao" class="form-control flatpickr-date" required placeholder="dd/MM/yyyy">
          <span class="error-text">Vui lòng chọn ngày báo cáo đánh giá</span>
        </div>
        <div class="form-group evaluation-extra-field initially-hidden">
          <label class="evaluation-field-label">${escapeHtml(inviteComparisonLabel)}</label>
          <input type="text" id="danhgiahsdt-ngay-moi-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
        </div>
        <div class="form-group evaluation-extra-field initially-hidden">
          <label class="evaluation-field-label">${escapeHtml(comparisonLabel)}</label>
          <input type="text" id="danhgiahsdt-ngay-doichieu" class="form-control flatpickr-date" placeholder="dd/MM/yyyy">
        </div>
      </div>
      ${processOptions}
      <div class="package-section-header">
        <h4 id="danhgiahsdt-table-title" class="package-section-title is-neutral">Đánh giá chi tiết các HSDT nộp</h4>
        <div class="compact-action-group">
          <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
          <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
        </div>
      </div>
      <div class="table-container package-table-frame has-bottom-space">
        <table class="data-table" id="danhgiahsdt-table"><thead id="danhgiahsdt-table-thead"></thead><tbody id="danhgiahsdt-table-tbody"></tbody></table>
      </div>
      <div class="workflow-action-row">
        <button class="btn btn-primary workflow-primary-action" id="btn-danhgiahsdt-save"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
      </div>
    </div>
    <div id="danhgiahsdt-empty-state" class="bf-s-6aa34d7432"></div>
  `);
}
