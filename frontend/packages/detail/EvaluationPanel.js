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
    <div id="danhgiahsdt-summary-view">
    <select id="danhgiahsdt-goithau-select" class="bf-s-6aa34d7432"><option value="${packageId}" selected>${packageName}</option></select>
    <div id="danhgiahsdt-goithau-summary" class="bf-s-6aa34d7432"></div>
    <div id="danhgiahsdt-container" class="bf-s-6aa34d7432">
      <div id="danhgiahsdt-round-history" class="evaluation-round-history is-hidden" aria-live="polite"></div>
      <section id="danhgiahsdt-current-round" class="evaluation-current-round">
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
      <section id="danhgiahsdt-scope-container" class="evaluation-lot-scope is-hidden" aria-labelledby="danhgiahsdt-scope-title">
        <div class="evaluation-lot-scope-heading">
          <div>
            <h4 id="danhgiahsdt-scope-title">Phạm vi đánh giá</h4>
            <p>Chọn đánh giá toàn bộ gói thầu hoặc lập đợt xử lý cho một hay nhiều phần lô.</p>
          </div>
          <span id="danhgiahsdt-scope-badge" class="evaluation-lot-scope-badge"></span>
        </div>
        <div class="evaluation-lot-scope-modes" role="radiogroup" aria-labelledby="danhgiahsdt-scope-title">
          <label class="evaluation-lot-scope-mode">
            <input type="radio" name="danhgiahsdt-scope-mode" value="all" checked>
            <span><strong>Đánh giá toàn bộ phần lô</strong><small>Tất cả phần lô đủ điều kiện trong cùng một đợt.</small></span>
          </label>
          <label class="evaluation-lot-scope-mode">
            <input type="radio" name="danhgiahsdt-scope-mode" value="selected">
            <span><strong>Đánh giá một hoặc nhiều phần lô</strong><small>Chọn các phần lô cần xử lý trước; phần còn lại tiếp tục ở đợt sau.</small></span>
          </label>
        </div>
        <div id="danhgiahsdt-lot-options" class="evaluation-lot-options" aria-live="polite"></div>
        <p id="danhgiahsdt-scope-feedback" class="evaluation-lot-scope-feedback"></p>
      </section>
      ${processOptions}
      <div class="package-section-header">
        <h4 id="danhgiahsdt-table-title" class="package-section-title is-neutral">Đánh giá E-HSDT</h4>
        <div class="compact-action-group">
          <button type="button" class="btn btn-secondary" id="btn-danhgiahsdt-detail"><i data-lucide="clipboard-list"></i> Báo cáo đánh giá chi tiết</button>
          <button class="btn-excel-action btn-download-excel-template-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-download-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button>
          <button class="btn-excel-action btn-import-excel-direct" data-type="danhgiahsdt" id="btn-danhgiahsdt-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button>
        </div>
      </div>
      <div class="table-container package-table-frame has-bottom-space">
        <table class="data-table" id="danhgiahsdt-table" data-row-pagination="true" aria-label="Báo cáo đánh giá hồ sơ dự thầu"><thead id="danhgiahsdt-table-thead"></thead><tbody id="danhgiahsdt-table-tbody"></tbody></table>
      </div>
      <div class="workflow-action-row">
        <button class="btn btn-primary workflow-primary-action" id="btn-danhgiahsdt-save"><i data-lucide="save"></i> Lưu thông tin đánh giá</button>
      </div>
      </section>
    </div>
    <div id="danhgiahsdt-empty-state" class="bf-s-6aa34d7432"></div>
    </div>
    <div id="danhgiahsdt-detail-view" class="is-hidden"></div>
  `);
}
