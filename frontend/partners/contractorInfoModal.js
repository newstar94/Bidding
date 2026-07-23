import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";

const MODAL_ID = "modal-contractor-info";

function displayValue(value) {
  const text = String(value ?? "").trim();
  return escapeHtml(text || "--");
}

function buildInfoItem(label, value, className = "") {
  return `
    <div class="contractor-info-item ${className}">
      <span class="contractor-info-label">${escapeHtml(label)}</span>
      <strong class="contractor-info-value">${displayValue(value)}</strong>
    </div>
  `;
}

export function buildContractorInfoModalHtml({ contractor = {}, formatDate } = {}) {
  const address = String(contractor.diaChi || "")
    .split(" | ")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const representative = [
    contractor.danhXung,
    contractor.nguoiDaiDien,
  ].filter(Boolean).join(" ");
  const appliedDate = contractor.ngayApDung && typeof formatDate === "function"
    ? formatDate(contractor.ngayApDung)
    : contractor.ngayApDung;
  const version = String(Number.parseInt(contractor.phienBan || 0, 10) || 0).padStart(2, "0");

  return `
    <div class="modal-card contractor-info-modal-card" role="dialog" aria-modal="true" aria-labelledby="contractor-info-title">
      <div class="modal-header contractor-info-modal-header">
        <div class="contractor-info-heading">
          <span class="contractor-info-eyebrow">Thông tin nhà thầu</span>
          <h3 id="contractor-info-title">${displayValue(contractor.tenNhaThau || "Nhà thầu")}</h3>
          <div class="contractor-info-identity">
            <span>${displayValue(formatPartnerIdentityCode(contractor.maNhaThau || contractor.maSoThue, "--"))}</span>
            <span aria-hidden="true">·</span>
            <span>Phiên bản ${escapeHtml(version)}</span>
          </div>
        </div>
        <button
          type="button"
          class="modal-close"
          data-bf-action="close-modal"
          data-modal-id="${MODAL_ID}"
          aria-label="Đóng thông tin nhà thầu"
        ></button>
      </div>
      <div class="modal-body contractor-info-modal-body">
        <div class="contractor-info-grid">
          ${buildInfoItem("Loại nhà thầu", contractor.loaiNhaThau || "Độc lập")}
          ${buildInfoItem("Ngày áp dụng", appliedDate)}
          ${buildInfoItem("Mã số thuế", contractor.maSoThue)}
          ${buildInfoItem("Tên viết tắt", contractor.tenVietTat)}
          ${buildInfoItem("Người đại diện", representative)}
          ${buildInfoItem("Chức vụ", contractor.chucVuDaiDien)}
          ${buildInfoItem("Địa chỉ", address, "contractor-info-item-wide")}
          ${buildInfoItem("Số điện thoại", contractor.soDienThoai)}
          ${buildInfoItem("Email liên hệ", contractor.email)}
          ${buildInfoItem("Số tài khoản", contractor.soTaiKhoan)}
          ${buildInfoItem("Nơi mở tài khoản", contractor.noiMoTaiKhoan)}
          ${buildInfoItem("Mã ngân hàng", contractor.maNganHang)}
        </div>
      </div>
    </div>
  `;
}

export function showNhaThauInfoModal(id) {
  const contractor = (this.model?.state?.nhathau || []).find(
    (item) => String(item.id) === String(id),
  );
  if (!contractor) {
    this.showToast?.(
      "Không tìm thấy nhà thầu",
      "Thông tin nhà thầu chưa sẵn sàng. Vui lòng đồng bộ dữ liệu và thử lại.",
      "warning",
    );
    return false;
  }

  let modal = document.getElementById(MODAL_ID);
  if (!modal) {
    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-overlay contractor-info-overlay";
    document.body.appendChild(modal);
  }

  modal.innerHTML = trustedHTML(buildContractorInfoModalHtml({
    contractor,
    formatDate: (value) => this.model?.formatDate?.(value) || value,
  }));
  this.openModal?.(MODAL_ID);
  return true;
}
