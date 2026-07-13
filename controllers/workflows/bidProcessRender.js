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
  container.innerHTML = `
        <div style="font-weight: 700; color: var(--primary); border-bottom: 1px solid rgba(59, 130, 246, 0.2); padding-bottom: 4px; margin-bottom: 12px;">Thông số Gói thầu</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; font-size: 0.82rem; margin-bottom: 12px;">
            <div>• <strong>Chủ đầu tư:</strong> <span class="text-dark fw-bold">${tenCdt}</span></div>
            <div>• <strong>Tên kế hoạch:</strong> <span class="text-dark fw-bold">${tenKhStr}</span></div>
            <div>• <strong>Lĩnh vực:</strong> ${gt.linhVuc || "Hàng hóa"}</div>
            <div>• <strong>Phương thức LCNT:</strong> ${gt.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ"}</div>
            <div>• <strong>Phân lô:</strong> ${gt.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
            <div>• <strong>Giá gói thầu:</strong> <span class="text-dark fw-bold">${model.formatCurrency(gt.giaGoiThau)}</span></div>
            <div>• <strong>Hình thức LCNT:</strong> ${gt.hinhThucLuaChon || "--"}</div>
            ${gt.phuongPhapDanhGia ? `<div>• <strong>Phương pháp đánh giá:</strong> ${gt.phuongPhapDanhGia}${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat ? ` (${gt.trongSoKyThuat}%)` : ""}</div>` : ""}
            <div>• <strong>Loại hợp đồng:</strong> ${gt.loaiHopDong || "--"}</div>
            <div>• <strong>Thời gian thực hiện:</strong> ${gt.thoiGianThucHien || "--"}</div>
            <div>• <strong>Nguồn vốn:</strong> ${gt.nguonVon || "--"}</div>
            ${!isDirectOrSpecial ? `
            <div>• <strong>Thời gian đóng thầu:</strong> ${gt.thoiGianDongThau ? model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</div>
            <div style="display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; vertical-align: middle;">
                <div style="display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;">• <strong>${is1G2T ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}:</strong>
                    ${isEditable ? `
                        <input type="text" id="op-thoigianmothau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: left; display: inline-block; vertical-align: middle; margin-left: 4px;" value="${gt.thoiGianMoThau ? model.formatForDatetimeLocal(gt.thoiGianMoThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                    ` : `
                        <span class="text-dark fw-bold" style="margin-left: 4px;">${gt.thoiGianMoThau ? model.formatDateWithTime(gt.thoiGianMoThau) : "Chưa mở"}</span>
                    `}
                </div>
                <div id="op-thoigianmothau-error" style="color: var(--danger); font-size: 0.72rem; margin-left: 10px; display: none; font-weight: 600; white-space: normal; max-width: 250px; margin-top: 2px;"></div>
            </div>
            ` : ""}
        </div>

        ${(isLocked || isReadOnly) && !isDirectOrSpecial ? `<div style="margin-top:8px; padding:8px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:6px; color:#dc2626; font-weight:600; font-size:0.82rem; display:flex; align-items:center; gap:6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
             ${is1G2T ? "Biên bản mở E-HSĐXKT" : "Biên bản mở thầu"} đã được khóa
        </div>` : ""}
    `;
}
