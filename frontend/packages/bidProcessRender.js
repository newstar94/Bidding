import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";

export function renderOpeningSummary({
  container,
  gt,
  tenCdt,
  tenKhStr,
  model,
  isDirectOrSpecial,
  is1G2T,
  isEditable,
  isReadOnly,
  isLocked
}) {
  if (!container) return;
  container.classList.remove("is-hidden");
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
            ${!isDirectOrSpecial ? `
            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
            <div class="bf-s-e171ad9dd0">
                <div class="bf-s-6ff1d7b95f">• <strong>${is1G2T ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong>
                    ${isEditable ? `
                        <input type="text" id="op-thoigianmothau" class="form-control flatpickr-datetime bf-s-7666bd9be5" value="${gt.thoiGianMoThau ? model.formatForDatetimeLocal(gt.thoiGianMoThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                    ` : `
                        <span class="text-dark fw-bold bf-s-a747118215">${gt.thoiGianMoThau ? model.formatDateWithTime(gt.thoiGianMoThau) : "Chưa mở"}</span>
                    `}
                </div>
                <div id="op-thoigianmothau-error" class="bf-s-3f8a171679"></div>
            </div>
            ` : ""}
        </div>

        ${(isLocked || isReadOnly) && !isDirectOrSpecial ? `<div class="bf-s-967650a602">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
             ${is1G2T ? "Biên bản mở E-HSĐXKT" : "Biên bản mở thầu"} đã được khóa
        </div>` : ""}
    `);
}
