import { escapeHtml } from "../../../../views/subviews/view_helpers.js";

export function renderAwardedResultPanel(container, {
  pkg,
  winnerHtml,
  bidderRowsHtml,
  tableHeaderHtml,
  appraisalNumber = "",
  appraisalDate = "",
  isEditable = false,
  formatCurrency,
  formatDate
} = {}) {
  if (!container) return;
  const showAppraisal = pkg?.hinhThucLuaChon !== "Chào hàng cạnh tranh";
  container.innerHTML = `
    <div class="card award-result-card">
      <div class="award-result-header">
        <div class="award-result-heading">
          <i data-lucide="check-circle" class="text-success award-result-icon"></i>
          <div><h4 class="award-result-title">Gói thầu đã hoàn thành LCNT</h4><p class="text-muted award-result-description">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p></div>
        </div>
        <button class="btn btn-primary action-strong" id="btn-export-docx-report"><i data-lucide="file-text"></i> Xuất Báo cáo Kết quả (Word)</button>
      </div>
      <div class="award-result-grid">
        <div><span class="text-muted award-result-label">Nhà thầu trúng thầu</span>${winnerHtml}</div>
        <div><span class="text-muted award-result-label">Giá trúng thầu</span><h5 class="award-result-value">${escapeHtml(formatCurrency(pkg?.giaTrungThau))}</h5></div>
        <div><span class="text-muted award-result-label">Thời gian thực hiện</span><h5 class="award-result-value">${escapeHtml(pkg?.thoiGianGoiThau || "--")}</h5></div>
        ${showAppraisal && appraisalNumber ? `<div><span class="text-muted award-result-label">Số BCTĐ kết quả</span><h5 class="award-result-value">${escapeHtml(appraisalNumber)}</h5></div>` : ""}
        ${showAppraisal && appraisalDate ? `<div><span class="text-muted award-result-label">Ngày BCTĐ kết quả</span><h5 class="award-result-value">${escapeHtml(formatDate(appraisalDate))}</h5></div>` : ""}
        <div><span class="text-muted award-result-label">Số QĐ phê duyệt Kết quả</span><h5 class="award-result-value">${escapeHtml(pkg?.soQuyetDinhKetQua || "--")}</h5></div>
        <div><span class="text-muted award-result-label">Ngày ký QĐ phê duyệt Kết quả</span><h5 class="award-result-value">${escapeHtml(pkg?.ngayQuyetDinhKetQua ? formatDate(pkg.ngayQuyetDinhKetQua) : "--")}</h5></div>
      </div>
    </div>
    <h5 class="package-list-heading"><i data-lucide="list"></i> Danh sách Nhà thầu tham dự và kết quả đánh giá</h5>
    <div class="table-container package-table-frame has-bottom-space table-card-bg">
      <table class="data-table table-full-width"><thead>${tableHeaderHtml}</thead><tbody>${bidderRowsHtml}</tbody></table>
    </div>
    ${isEditable ? '<div class="workflow-action-row with-top-space"><button class="btn btn-primary action-strong" id="btn-edit-result-bottom"><i data-lucide="edit"></i> Sửa kết quả</button></div>' : ""}
  `;
}

export function bindAwardResultPanel(container, {
  onEdit,
  onExport,
  onExportError,
  refreshIcons
} = {}) {
  if (!container) return;
  const editButton = container.querySelector?.("#btn-edit-result-bottom");
  if (editButton) editButton.onclick = () => onEdit?.();

  const exportButton = container.querySelector?.("#btn-export-docx-report");
  if (!exportButton) return;
  exportButton.onclick = async () => {
    const originalHtml = exportButton.innerHTML;
    exportButton.disabled = true;
    exportButton.innerHTML = '<i data-lucide="loader-2" class="animate-spin icon-md"></i> Đang xuất...';
    refreshIcons?.();
    try {
      await onExport?.();
    } catch (error) {
      await onExportError?.(error);
    } finally {
      exportButton.disabled = false;
      exportButton.innerHTML = originalHtml;
      refreshIcons?.();
    }
  };
}
