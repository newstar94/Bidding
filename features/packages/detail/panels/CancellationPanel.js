import { escapeHtml } from "../../../../views/subviews/view_helpers.js";

function parseMetadata(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function renderCancellationPanel(container, { pkg, formatDate, initDatePicker, onSave }) {
  const details = parseMetadata(pkg.danhGiaHsdtMetadata).cancelDetails || {};
  const isCanceled = pkg.trangThai === "Hủy thầu";
  const disabled = isCanceled ? "disabled" : "";
  container.innerHTML = `
    <div class="card package-cancellation-panel">
      <h4 class="package-cancellation-title"><i data-lucide="x-circle"></i> Quyết định Hủy thầu</h4>
      <div class="package-cancellation-form">
        <div class="package-cancellation-grid">
          <div class="form-group"><label>Số quyết định hủy thầu <span class="text-danger">*</span></label><input type="text" id="cancel-dec-no" class="form-control" value="${escapeHtml(details.soQuyetDinhHuyThau || "")}" placeholder="VD: 123/QĐ-CDT" ${disabled}></div>
          <div class="form-group"><label>Ngày quyết định hủy thầu <span class="text-danger">*</span></label><input type="text" id="cancel-dec-date" class="form-control flatpickr-date" value="${escapeHtml(details.ngayQuyetDinhHuyThau ? formatDate(details.ngayQuyetDinhHuyThau) : "")}" placeholder="dd/MM/yyyy" ${disabled}></div>
        </div>
        <div class="form-group"><label>Lý do hủy thầu <span class="text-danger">*</span></label><textarea id="cancel-reason" class="form-control" rows="5" placeholder="Nhập lý do hủy thầu..." ${disabled}>${escapeHtml(details.lyDoHuyThau || "")}</textarea></div>
        ${isCanceled ? "" : '<div><button id="btn-save-cancel-details" class="btn btn-primary"><i data-lucide="check"></i> Xác nhận hủy thầu</button></div>'}
      </div>
    </div>`;
  initDatePicker?.(container);
  const button = container.querySelector("#btn-save-cancel-details");
  if (button) button.onclick = () => onSave?.({
    decisionNumber: container.querySelector("#cancel-dec-no")?.value.trim() || "",
    decisionDate: container.querySelector("#cancel-dec-date")?.value.trim() || "",
    reason: container.querySelector("#cancel-reason")?.value.trim() || "",
    controls: {
      decisionNumber: container.querySelector("#cancel-dec-no"),
      decisionDate: container.querySelector("#cancel-dec-date"),
      reason: container.querySelector("#cancel-reason")
    }
  });
}
