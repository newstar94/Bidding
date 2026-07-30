import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";

export function buildAwardedResultPanelMarkup({
  pkg,
  winnerHtml,
  bidderRowsHtml,
  tableHeaderHtml,
  resultHistoryHtml = "",
  appraisalNumber = "",
  appraisalDate = "",
  isEditable = false,
  wordExportEnabled = false,
  winningGoodsExportEnabled = false,
  formatCurrency,
  formatDate
} = {}) {
  const showAppraisal = pkg?.hinhThucLuaChon !== "Chào hàng cạnh tranh";
  const hasOfficialResultHistory = Boolean(String(resultHistoryHtml || "").trim());
  return `
    <div class="card award-result-card">
      <div class="award-result-header">
        <div class="award-result-heading">
          <i data-lucide="check-circle" class="text-success award-result-icon"></i>
          <div><h4 class="award-result-title">Gói thầu đã hoàn thành LCNT</h4><p class="text-muted award-result-description">Đã phê duyệt kết quả lựa chọn nhà thầu chính thức.</p></div>
        </div>
        <div class="compact-action-group">
          ${winningGoodsExportEnabled ? '<button class="btn btn-outline action-strong" id="btn-export-winning-goods"><i data-lucide="file-spreadsheet"></i> Xuất danh sách hàng hóa trúng thầu</button>' : ""}
          <button class="btn btn-primary action-strong" id="btn-export-docx-report"
            ${wordExportEnabled ? "" : "disabled"}
            title="${wordExportEnabled ? "Xuất báo cáo kết quả ra Word" : "Cần gói trả phí đang hoạt động để xuất Word"}"><i data-lucide="file-text"></i> Xuất Báo cáo Kết quả (Word)</button>
        </div>
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
    ${isEditable && !hasOfficialResultHistory ? '<div class="workflow-action-row with-top-space"><button class="btn btn-primary action-strong" id="btn-edit-result-bottom"><i data-lucide="edit-3"></i> Sửa kết quả</button></div>' : ""}
    ${resultHistoryHtml}
  `;
}

export function renderAwardedResultPanel(container, options = {}) {
  if (!container) return;
  container.innerHTML = trustedHTML(buildAwardedResultPanelMarkup(options));
}

export function bindAwardResultPanel(container, {
  onEdit,
  onExport,
  onExportWinningGoods,
  onExportError,
  onWinningGoodsExportError,
  refreshIcons
} = {}) {
  if (!container) return;
  const editButton = container.querySelector?.("#btn-edit-result-bottom");
  if (editButton) editButton.onclick = () => onEdit?.();

  const bindExport = (button, action, loadingLabel, errorHandler = onExportError) => {
    if (!button) return;
    button.onclick = async () => {
      const originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = trustedHTML(`<i data-lucide="loader-2" class="animate-spin icon-md"></i> ${loadingLabel}`);
      refreshIcons?.();
      try {
        await action?.();
      } catch (error) {
        await errorHandler?.(error);
      } finally {
        button.disabled = false;
        button.innerHTML = trustedHTML(originalHtml);
        refreshIcons?.();
      }
    };
  };
  bindExport(container.querySelector?.("#btn-export-docx-report"), onExport, "Đang xuất Word...");
  bindExport(
    container.querySelector?.("#btn-export-winning-goods"),
    onExportWinningGoods,
    "Đang xuất Excel...",
    onWinningGoodsExportError || onExportError,
  );
}
