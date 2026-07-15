import { renderEvaluationLockNotice } from "./detail/EvaluationConclusion.js";
import { escapeHtml } from "../shared/view_helpers.js";

export function addEvaluationLetterRow({ view, model, containerId, letter = { soCv: "", ngayCv: "" }, readOnly = false }) {
  const container = view.getActiveElement(containerId);
  if (!container) return;
  const div = document.createElement("div");
  div.className = "letter-row";
  div.style.display = "grid";
  div.style.gridTemplateColumns = "1fr 1fr auto";
  div.style.gap = "6px";
  div.style.alignItems = "center";
  div.style.marginBottom = "6px";
  const ngayFormattedDisplay = letter.ngayCv ? model.formatDate(letter.ngayCv) : "";
  const ngayFormattedInput = letter.ngayCv ? model.formatForDateInput(letter.ngayCv) : "";
  div.innerHTML = readOnly ? `
        <div style="font-size: 0.8rem; font-weight: 600; padding: 6px; background: rgba(0,0,0,0.02); border-radius: 4px;">${escapeHtml(letter.soCv || "--")}</div>
        <div style="font-size: 0.8rem; padding: 6px; background: rgba(0,0,0,0.02); border-radius: 4px;">${escapeHtml(ngayFormattedDisplay || "--")}</div>
        <div></div>
    ` : `
        <input type="text" class="form-control letter-so-cv" placeholder="Số công văn" value="${escapeHtml(letter.soCv || "")}" style="padding: 4px 8px; font-size: 0.8rem;" required>
        <input type="date" class="form-control letter-ngay-cv" value="${escapeHtml(ngayFormattedInput)}" style="padding: 4px 8px; font-size: 0.8rem;" required>
        <button type="button" class="btn-delete-row" style="border: none; background: transparent; color: var(--danger); cursor: pointer; font-size: 1.1rem; padding: 4px;" data-bf-action="remove-closest" data-selector=".letter-row">&times;</button>
    `;
  container.appendChild(div);
}
export function renderEvaluationSummary({ container, gt, tenCdt, tenKhStr, model, is1G2T, isReadOnly, currentTab }) {
  if (!container) return;
  container.style.display = "block";
  container.innerHTML = `
        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
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
    `;
}
