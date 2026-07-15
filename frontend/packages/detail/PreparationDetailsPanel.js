import { savePackagePreparation } from "../packagePreparation.js";
import { escapeHtml, safeAttr } from "../../shared/view_helpers.js";

export function renderPreparationDetailsPanel(view, { contentWrapper, gt, id, isEditable, appController }) {
      if (true) {
        const khObj = view.model.getLatestPlan(gt.keHoachId);
        const cdtObj = khObj ? view.model.state.chudautu.find((c) => c.id === khObj.chuDauTuId) : null;
        const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : "Không rõ";
        const tenKhStr = khObj ? khObj.tenKeHoach : "Không rõ";
        contentWrapper.innerHTML = `
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 24px;">
                        <!-- Cột 1: Thông tin chung -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="info" style="width: 18px; height: 18px;"></i> Thông tin chung
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Mã TBMT</span>
                                        <span class="package-info-value">${escapeHtml(gt.maGoiThau || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Tên gói thầu</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right; word-break: break-word;">${escapeHtml(gt.tenGoiThau || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Chủ đầu tư</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${escapeHtml(tenCdtStr)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Kế hoạch LCNT</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${escapeHtml(tenKhStr)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Lĩnh vực</span>
                                        <span class="package-info-value">${escapeHtml(gt.linhVuc || "--")}${gt.linhVuc === "Hàng hóa" ? gt.isThuoc == 1 ? " (Thuốc)" : " (Không phải thuốc)" : ""}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Giá gói thầu</span>
                                        <span style="color: var(--primary); font-weight: 800;">${view.model.formatCurrency(gt.giaGoiThau) || "--"}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">Nguồn vốn</span>
                                        <span style="color: var(--text-main); font-weight: 700; max-width: 60%; text-align: right;">${escapeHtml(gt.nguonVon || "--")}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 2: Hình thức & Phương thức -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="layers" style="width: 18px; height: 18px;"></i> Hình thức & Phương thức
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Hình thức LCNT</span>
                                        <span class="package-info-value">${escapeHtml(gt.hinhThucLuaChon || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phương thức LCNT</span>
                                        <span class="package-info-value">${escapeHtml(gt.phuongThucLuaChon || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phương pháp đánh giá</span>
                                        <span class="package-info-value">${escapeHtml(gt.phuongPhapDanhGia || "--")}</span>
                                    </div>
                                    ${gt.trongSoKyThuat ? `
                                    <div class="package-info-row">
                                        <span class="package-info-label">Trọng số kỹ thuật (%)</span>
                                        <span class="package-info-value">${escapeHtml(gt.trongSoKyThuat)}%</span>
                                    </div>` : ""}
                                    <div class="package-info-row">
                                        <span class="package-info-label">Đấu thầu qua mạng</span>
                                        <span class="package-info-value">${escapeHtml(gt.quaMang || "Qua mạng")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Phân lô</span>
                                        <span class="package-info-value">${escapeHtml(gt.phanLo || "Không")}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">Tùy chọn mua thêm</span>
                                        <span class="package-info-value">${escapeHtml(gt.tuyChonMuaThem || "Không")}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 3: Thời gian & Tiến độ -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="calendar" style="width: 18px; height: 18px;"></i> Thời gian & Tiến độ
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian thực hiện</span>
                                        <span class="package-info-value">${escapeHtml(gt.thoiGianThucHien || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Bắt đầu tổ chức</span>
                                        <span class="package-info-value">${escapeHtml(gt.thoiGianBatDauToChuc || "--")}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt" ? "none" : "1px solid rgba(226, 232, 240, 0.5)"}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">${khObj && khObj.pheDuyet === "Kế hoạch" ? "Phê duyệt kế hoạch" : "Phê duyệt dự toán và kế hoạch"}</span>
                                        <span class="package-info-value">${khObj && khObj.ngayPheDuyet ? view.model.formatDate(khObj.ngayPheDuyet) : "--"}</span>
                                    </div>
                                    ${gt.hinhThucLuaChon !== "Chỉ định thầu rút gọn" && gt.hinhThucLuaChon !== "Lựa chọn nhà thầu trong trường hợp đặc biệt" ? `
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian đăng tải</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-dangtai" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDangTai ? view.model.formatForDatetimeLocal(gt.thoiGianDangTai) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianDangTai ? view.model.formatDateWithTime(gt.thoiGianDangTai) : "--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian đóng thầu</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-dongthau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianDongThau ? view.model.formatForDatetimeLocal(gt.thoiGianDongThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianDongThau ? view.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? "1px solid rgba(226, 232, 240, 0.5)" : "none"}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-mothau" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianMoThau ? view.model.formatForDatetimeLocal(gt.thoiGianMoThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianMoThau ? view.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</span>
                                        `}
                                    </div>
                                    ${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? `
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">Thời gian mở E-HSĐXTC</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-moehsdxtc" class="form-control flatpickr-datetime" style="width: 160px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.thoiGianMoEhsdxtc ? view.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianMoEhsdxtc ? view.model.formatDateWithTime(gt.thoiGianMoEhsdxtc) : "--"}</span>
                                        `}
                                    </div>
                                    ` : ""}
                                    ` : ""}
                                </div>
                            </div>
                        </div>

                        ${gt.hinhThucLuaChon === "Chào hàng cạnh tranh" ? `
                        <!-- Cột 4: Quyết định phê duyệt HSMT (Dành riêng cho Chào hàng cạnh tranh ở dạng cột) -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Quyết định phê duyệt HSMT
                                </h4>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-soquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${safeAttr(gt.soQuyetDinh || "")}" placeholder="Nhập số quyết định">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soQuyetDinh || "--")}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayQuyetDinh ? view.model.formatForDateInput(gt.ngayQuyetDinh) : ""}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span class="package-info-value">${gt.ngayQuyetDinh ? view.model.formatDate(gt.ngayQuyetDinh) : "--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ""}
                    </div>

                    ${gt.hinhThucLuaChon !== "Chào hàng cạnh tranh" && gt.hinhThucLuaChon !== "Chỉ định thầu rút gọn" && gt.hinhThucLuaChon !== "Lựa chọn nhà thầu trong trường hợp đặc biệt" ? `
                    <!-- Cột 4: Phê duyệt HSMT (Trải ngang full chiều rộng) -->
                    <div class="card" style="padding: 20px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-card); margin-bottom: 24px;">
                            <h4 class="package-info-heading">
                                <i data-lucide="file-text" style="width: 18px; height: 18px;"></i> Phê duyệt HSMT
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số tờ trình HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-sototrinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${safeAttr(gt.soToTrinhHsmt || "")}" placeholder="Nhập số tờ trình">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soToTrinhHsmt || "--")}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Ngày trình HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngaytrinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayTrinhHsmt ? view.model.formatForDateInput(gt.ngayTrinhHsmt) : ""}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span class="package-info-value">${gt.ngayTrinhHsmt ? view.model.formatDate(gt.ngayTrinhHsmt) : "--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-soquyetdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${safeAttr(gt.soQuyetDinh || "")}" placeholder="Nhập số quyết định">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soQuyetDinh || "--")}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayQuyetDinh ? view.model.formatForDateInput(gt.ngayQuyetDinh) : ""}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span class="package-info-value">${gt.ngayQuyetDinh ? view.model.formatDate(gt.ngayQuyetDinh) : "--"}</span>
                                        `}
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 10px;">
                                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span class="package-info-label">Yêu cầu thẩm định HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div style="display: flex; gap: 16px; align-items: center;">
                                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; color: var(--text-main);">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Có" ${gt.yeuCauThamDinhHsmt === "Có" ? "checked" : ""} style="cursor: pointer; accent-color: var(--primary); margin: 0;"> Có
                                                </label>
                                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; color: var(--text-main);">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Không" ${gt.yeuCauThamDinhHsmt === "Không" || !gt.yeuCauThamDinhHsmt ? "checked" : ""} style="cursor: pointer; accent-color: var(--primary); margin: 0;"> Không
                                                </label>
                                            </div>
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.yeuCauThamDinhHsmt || "Không")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" style="display: ${view._inPlaceEditMode || gt.yeuCauThamDinhHsmt === "Có" ? "flex" : "none"}; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span class="package-info-label">Số BCTĐ HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                                <input type="text" id="ip-sobaocaothamdinh" class="form-control" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${safeAttr(gt.soBaoCaoThamDinhHsmt || "")}" placeholder="Nhập số báo cáo">
                                                <span class="error-msg-inline" id="err-sobaocao" style="display: none; color: #ef4444; font-size: 0.72rem; margin-top: 4px; font-weight: 600;">Vui lòng nhập số báo cáo</span>
                                            </div>
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soBaoCaoThamDinhHsmt || "--")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" style="display: ${view._inPlaceEditMode || gt.yeuCauThamDinhHsmt === "Có" ? "flex" : "none"}; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span class="package-info-label">Ngày BCTĐ HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                                <input type="text" id="ip-ngaybaocaothamdinh" class="form-control flatpickr-date" style="width: 180px; height: 28px; padding: 2px 8px; font-size: 0.83rem; text-align: right;" value="${gt.ngayBaoCaoThamDinhHsmt ? view.model.formatForDateInput(gt.ngayBaoCaoThamDinhHsmt) : ""}" placeholder="dd/MM/yyyy">
                                                <span class="error-msg-inline" id="err-ngaybaocao" style="display: none; color: #ef4444; font-size: 0.72rem; margin-top: 4px; font-weight: 600;">Vui lòng chọn ngày báo cáo</span>
                                            </div>
                                        ` : `
                                            <span class="package-info-value">${gt.ngayBaoCaoThamDinhHsmt ? view.model.formatDate(gt.ngayBaoCaoThamDinhHsmt) : "--"}</span>
                                        `}
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ""}
                     ${view._inPlaceEditMode ? `
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
                            <button id="btn-cancel-inplace" class="btn btn-outline" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">Lưu</button>
                        </div>
                    ` : `
                        ${isEditable && gt.trangThai !== "Đang chấm thầu" && gt.trangThai !== "Đã có kết quả" && gt.trangThai !== "Hủy thầu" ? `
                            <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                                <button id="btn-edit-goithau-bottom" class="btn btn-primary" style="padding: 8px 20px; font-weight: 700; border-radius: var(--radius-md);">
                                    <i data-lucide="edit"></i> Sửa gói thầu
                                </button>
                            </div>
                        ` : ""}
                    `}
                `;
        lucide.createIcons();
        const btnEditBottom = document.getElementById("btn-edit-goithau-bottom");
        if (btnEditBottom) {
          btnEditBottom.onclick = () => {
            if (gt.hinhThucLuaChon === "Chỉ định thầu rút gọn" || gt.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt") {
              executeAppCommand("editGoiThau", id);
            } else {
              view._inPlaceEditMode = true;
              view.showPackageDetails(id);
            }
          };
        }
        if (view._inPlaceEditMode) {
          const radioYeuCaus = document.querySelectorAll('input[name="ip-yeucauthamdinh"]');
          if (radioYeuCaus.length > 0) {
            const toggleReportFields = () => {
              const checkedRadio = document.querySelector('input[name="ip-yeucauthamdinh"]:checked');
              const show = checkedRadio && checkedRadio.value === "Có";
              document.getElementById("wrapper-sobaocaothamdinh").style.display = show ? "flex" : "none";
              document.getElementById("wrapper-ngaybaocaothamdinh").style.display = show ? "flex" : "none";
            };
            radioYeuCaus.forEach((radio) => {
              radio.onchange = toggleReportFields;
            });
            toggleReportFields();
          }
          const btnSave = document.getElementById("btn-save-inplace");
          if (btnSave) {
            btnSave.onclick = async () => {
              const valDangTai = document.getElementById("ip-dangtai").value;
              const valDongThau = document.getElementById("ip-dongthau").value;
              const valMoThau = document.getElementById("ip-mothau").value;
              const inputMoEhsdxtc = document.getElementById("ip-moehsdxtc");
              const valMoEhsdxtc = inputMoEhsdxtc ? inputMoEhsdxtc.value : "";
              const valSoQuyetDinh = document.getElementById("ip-soquyetdinh").value;
              const valNgayQuyetDinh = document.getElementById("ip-ngayquyetdinh").value;
              const valSoToTrinh = document.getElementById("ip-sototrinh")?.value || "";
              const valNgayTrinh = document.getElementById("ip-ngaytrinh")?.value || "";
              const checkedRadio = document.querySelector('input[name="ip-yeucauthamdinh"]:checked');
              const valYeuCauThamDinh = checkedRadio ? checkedRadio.value : "Không";
              const valSoBaoCao = document.getElementById("ip-sobaocaothamdinh")?.value || "";
              const valNgayBaoCao = document.getElementById("ip-ngaybaocaothamdinh")?.value || "";
              if (valYeuCauThamDinh === "Có") {
                let hasErr = false;
                const errorInputs = [];
                const inpSo = document.getElementById("ip-sobaocaothamdinh");
                const inpNgay = document.getElementById("ip-ngaybaocaothamdinh");
                if (inpSo) {
                  const errEl = document.getElementById("err-sobaocao");
                  if (!valSoBaoCao.trim()) {
                    inpSo.style.setProperty("border", "1px solid #ef4444", "important");
                    if (errEl) errEl.style.display = "block";
                    hasErr = true;
                    errorInputs.push(inpSo);
                  } else {
                    inpSo.style.removeProperty("border");
                    if (errEl) errEl.style.display = "none";
                  }
                  inpSo.oninput = () => {
                    inpSo.style.removeProperty("border");
                    if (errEl) errEl.style.display = "none";
                  };
                }
                if (inpNgay) {
                  const errEl = document.getElementById("err-ngaybaocao");
                  if (!valNgayBaoCao.trim()) {
                    inpNgay.style.setProperty("border", "1px solid #ef4444", "important");
                    if (errEl) errEl.style.display = "block";
                    hasErr = true;
                    errorInputs.push(inpNgay);
                  } else {
                    inpNgay.style.removeProperty("border");
                    if (errEl) errEl.style.display = "none";
                  }
                  inpNgay.onchange = () => {
                    inpNgay.style.removeProperty("border");
                    if (errEl) errEl.style.display = "none";
                  };
                }
                if (hasErr) {
                  view.focusInvalidControl(errorInputs[0]);
                  return;
                }
              }
              const gtData = {
                hinhThucLuaChon: gt.hinhThucLuaChon,
                thoiGianDangTai: valDangTai ? view.model.convertDMYHMSToYMDHMS(valDangTai) : "",
                thoiGianDongThau: valDongThau ? view.model.convertDMYHMSToYMDHMS(valDongThau) : "",
                thoiGianMoThau: valMoThau ? view.model.convertDMYHMSToYMDHMS(valMoThau) : "",
                thoiGianMoEhsdxtc: valMoEhsdxtc ? view.model.convertDMYHMSToYMDHMS(valMoEhsdxtc) : "",
                soQuyetDinh: valSoQuyetDinh,
                ngayQuyetDinh: valNgayQuyetDinh ? view.model.convertDMYToYMD(valNgayQuyetDinh) : "",
                soToTrinhHsmt: valSoToTrinh,
                ngayTrinhHsmt: valNgayTrinh ? view.model.convertDMYToYMD(valNgayTrinh) : "",
                yeuCauThamDinhHsmt: valYeuCauThamDinh,
                soBaoCaoThamDinhHsmt: valYeuCauThamDinh === "Không" ? "" : valSoBaoCao,
                ngayBaoCaoThamDinhHsmt: valYeuCauThamDinh === "Không" || !valNgayBaoCao ? "" : view.model.convertDMYToYMD(valNgayBaoCao)
              };
              const savedPackage = await savePackagePreparation(appController || view, gt, gtData, {
                generateRecordId: generateRecordId
              });
              view._inPlaceEditMode = false;
              view.showPackageDetails(savedPackage.id);
              await view.customAlert("Thành công", "Cập nhật thông tin gói thầu thành công!", "check-circle");
            };
          }
          const btnCancel = document.getElementById("btn-cancel-inplace");
          if (btnCancel) {
            btnCancel.onclick = () => {
              view._inPlaceEditMode = false;
              view.showPackageDetails(id);
            };
          }
        }
      }
}
import { executeAppCommand } from "../../app/commandBus.js";
import { generateRecordId } from "../../shared/idUtils.js";
