import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderEvaluationLockNotice } from "./detail/EvaluationConclusion.js";
import { escapeHtml } from "../shared/view_helpers.js";

export function addEvaluationLetterRow({ view, model, containerId, letter = { soCv: "", ngayCv: "" }, readOnly = false }) {
  const container = view.getActiveElement(containerId);
  if (!container) return;
  const div = document.createElement("div");
  div.className = "letter-row";
  setRuntimeStyle(div, "display", "grid");
  setRuntimeStyle(div, "gridTemplateColumns", "1fr 1fr auto");
  setRuntimeStyle(div, "gap", "6px");
  setRuntimeStyle(div, "alignItems", "center");
  setRuntimeStyle(div, "marginBottom", "6px");
  const ngayFormattedDisplay = letter.ngayCv ? model.formatDate(letter.ngayCv) : "";
  const ngayFormattedInput = letter.ngayCv ? model.formatForDateInput(letter.ngayCv) : "";
  div.innerHTML = trustedHTML(readOnly ? `
        <div class="bf-s-6aa064f9ce">${escapeHtml(letter.soCv || "--")}</div>
        <div class="bf-s-4a866e47a9">${escapeHtml(ngayFormattedDisplay || "--")}</div>
        <div></div>
    ` : `
        <input type="text" class="form-control letter-so-cv bf-s-6621c14642" placeholder="Số công văn" value="${escapeHtml(letter.soCv || "")}" required>
        <input type="date" class="form-control letter-ngay-cv bf-s-6621c14642" value="${escapeHtml(ngayFormattedInput)}" required>
        <button type="button" class="action-btn btn-delete btn-delete-row" data-bf-action="remove-closest" data-selector=".letter-row" aria-label="Xóa công văn" title="Xóa công văn"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    `);
  container.appendChild(div);
  view.createIconsScoped?.(div);
}
export function renderEvaluationSummary({ container, gt, tenCdt, tenKhStr, model, is1G2T, isReadOnly, currentTab }) {
  if (!container) return;
  setRuntimeStyle(container, "display", "block");
  container.innerHTML = trustedHTML(`
        <div class="bf-s-5d398becec">Thông số Gói thầu</div>
        <div class="bf-s-5219e35258">
            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(tenCdt)}</span></div>
            <div>• <strong>Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(tenKhStr)}</span></div>
            <div>• <strong>Lĩnh vực:</strong> ${escapeHtml(gt.linhVuc || "Hàng hóa")}</div>
            <div>• <strong>Phương thức LCNT:</strong> ${escapeHtml(gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
            <div>• <strong>Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
            <div>• <strong>Giá gói thầu:</strong> <span class="text-dark fw-bold">${model.formatCurrency(gt.giaGoiThau)}</span></div>
            <div>• <strong>Hình thức LCNT:</strong> ${escapeHtml(gt.hinhThucLuaChon || "--")}</div>
            ${gt.phuongPhapDanhGia ? `<div>• <strong>Phương pháp đánh giá:</strong> ${escapeHtml(gt.phuongPhapDanhGia)}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${escapeHtml(gt.trongSoKyThuat)}%)` : ""}</div>` : ""}
            <div>• <strong>Loại hợp đồng:</strong> ${escapeHtml(gt.loaiHopDong || "--")}</div>
            <div>• <strong>Thời gian thực hiện:</strong> ${escapeHtml(gt.thoiGianThucHien || "--")}</div>
            <div>• <strong>Nguồn vốn:</strong> ${escapeHtml(gt.nguonVon || "--")}</div>
            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
            <div>• <strong>${is1G2T ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong> ${gt.thoiGianMoThau ? model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</div>
            ${is1G2T ? `<div>• <strong>Thời gian mở E-HSĐXTC:</strong> ${gt.thoiGianMoEhsdxtc ? model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "Chưa mở"}</div>` : ""}
        </div>
        ${isReadOnly ? renderEvaluationLockNotice({ isTwoEnvelope: is1G2T, stage: currentTab }) : ""}
    `);
}
