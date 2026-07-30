import { trustedHTML } from "../../shared/trustedTypes.js";
import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { savePackagePreparation } from "../packagePreparation.js";
import { escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { assigneeLabelsForTarget } from "../../shared/MultiAssigneeSelect.js";

// eslint-disable-next-line complexity -- Legacy preparation markup is isolated for a dedicated refactor.
export function renderPreparationDetailsPanel(view, { contentWrapper, gt, id, isEditable, appController }) {
      if (true) {
        const khObj = view.model.getLatestPlan(gt.keHoachId);
        const cdtObj = khObj ? view.model.state.chudautu.find((c) => c.id === khObj.chuDauTuId) : null;
        const tenCdtStr = cdtObj ? cdtObj.tenChuDauTu : "Không rõ";
        const tenKhStr = khObj ? khObj.tenKeHoach : "Không rõ";
        const assigneeLabels = assigneeLabelsForTarget(view.model, gt.id, "goithau");
        contentWrapper.innerHTML = trustedHTML(`
                    <div class="bf-s-95f6f7a8cf">
                        <!-- Cột 1: Thông tin chung -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="info" class="bf-s-ea6824d1aa"></i> Thông tin chung
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Mã TBMT</span>
                                        <span class="package-info-value">${escapeHtml(gt.maGoiThau || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Tên gói thầu</span>
                                        <span class="bf-s-0b49a26b79">${escapeHtml(gt.tenGoiThau || "--")}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Chủ đầu tư</span>
                                        <span class="bf-s-a231830f9a">${escapeHtml(tenCdtStr)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Kế hoạch LCNT</span>
                                        <span class="bf-s-a231830f9a">${escapeHtml(tenKhStr)}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Lĩnh vực</span>
                                        <span class="package-info-value">${escapeHtml(gt.linhVuc || "--")}${gt.linhVuc === "Hàng hóa" ? gt.isThuoc == 1 ? " (Thuốc)" : " (Không phải thuốc)" : ""}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Giá gói thầu</span>
                                        <span class="bf-s-a1e9afc7db">${view.model.formatCurrency(gt.giaGoiThau) || "--"}</span>
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Người phụ trách</span>
                                        <span class="package-info-value">${escapeHtml(assigneeLabels.join(", ") || "Chưa phân công")}</span>
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Nguồn vốn</span>
                                        <span class="bf-s-a231830f9a">${escapeHtml(gt.nguonVon || "--")}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Cột 2: Hình thức & Phương thức -->
                        <div class="card package-info-card">
                            <div>
                                <h4 class="package-info-heading">
                                    <i data-lucide="layers" class="bf-s-ea6824d1aa"></i> Hình thức & Phương thức
                                </h4>
                                <div class="bf-s-41ff9fcb41">
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
                                    ${gt.phuongPhapDanhGia === "Kết hợp giữa kỹ thuật và giá" && gt.trongSoKyThuat != null ? `
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
                                    <div class="bf-s-6111467ecf">
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
                                    <i data-lucide="calendar" class="bf-s-ea6824d1aa"></i> Thời gian & Tiến độ
                                </h4>
                                <div class="bf-s-41ff9fcb41">
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
                                            <input type="text" id="ip-dangtai" class="form-control flatpickr-datetime bf-s-a77124f253" value="${gt.thoiGianDangTai ? view.model.formatForDatetimeLocal(gt.thoiGianDangTai) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianDangTai ? view.model.formatDateWithTime(gt.thoiGianDangTai) : "--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Thời gian đóng thầu</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-dongthau" class="form-control flatpickr-datetime bf-s-a77124f253" value="${gt.thoiGianDongThau ? view.model.formatForDatetimeLocal(gt.thoiGianDongThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianDongThau ? view.model.formatDateWithTime(gt.thoiGianDongThau) : "--"}</span>
                                        `}
                                    </div>
                                    <div style="display: flex; justify-content: space-between; border-bottom: ${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? "1px solid rgba(226, 232, 240, 0.5)" : "none"}; padding-bottom: 8px; font-size: 0.83rem;">
                                        <span class="package-info-label">${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? "Thời gian mở E-HSĐXKT" : "Thời gian mở thầu"}</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-mothau" class="form-control flatpickr-datetime bf-s-a77124f253" value="${gt.thoiGianMoThau ? view.model.formatForDatetimeLocal(gt.thoiGianMoThau) : ""}" placeholder="dd/MM/yyyy HH:mm">
                                        ` : `
                                            <span class="package-info-value">${gt.thoiGianMoThau ? view.model.formatDateWithTime(gt.thoiGianMoThau) : "--"}</span>
                                        `}
                                    </div>
                                    ${gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ" ? `
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Thời gian mở E-HSĐXTC</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-moehsdxtc" class="form-control flatpickr-datetime bf-s-a77124f253" value="${gt.thoiGianMoEhsdxtc ? view.model.formatForDatetimeLocal(gt.thoiGianMoEhsdxtc) : ""}" placeholder="dd/MM/yyyy HH:mm">
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
                                    <i data-lucide="file-text" class="bf-s-ea6824d1aa"></i> Quyết định phê duyệt HSMT
                                </h4>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-soquyetdinh" class="form-control bf-s-2c034cb5e7" value="${safeAttr(gt.soQuyetDinh || "")}" placeholder="Nhập số quyết định">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soQuyetDinh || "--")}</span>
                                        `}
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${gt.ngayQuyetDinh ? view.model.formatForDateInput(gt.ngayQuyetDinh) : ""}" placeholder="dd/MM/yyyy">
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
                    <div class="card bf-s-79d810df56">
                            <h4 class="package-info-heading">
                                <i data-lucide="file-text" class="bf-s-ea6824d1aa"></i> Phê duyệt HSMT
                            </h4>
                            <div class="bf-s-09162b0891">
                                <div class="bf-s-41ff9fcb41">
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số tờ trình HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-sototrinh" class="form-control bf-s-2c034cb5e7" value="${safeAttr(gt.soToTrinhHsmt || "")}" placeholder="Nhập số tờ trình">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soToTrinhHsmt || "--")}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Ngày trình HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngaytrinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${gt.ngayTrinhHsmt ? view.model.formatForDateInput(gt.ngayTrinhHsmt) : ""}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span class="package-info-value">${gt.ngayTrinhHsmt ? view.model.formatDate(gt.ngayTrinhHsmt) : "--"}</span>
                                        `}
                                    </div>
                                    <div class="package-info-row">
                                        <span class="package-info-label">Số quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-soquyetdinh" class="form-control bf-s-2c034cb5e7" value="${safeAttr(gt.soQuyetDinh || "")}" placeholder="Nhập số quyết định">
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soQuyetDinh || "--")}</span>
                                        `}
                                    </div>
                                    <div class="bf-s-6111467ecf">
                                        <span class="package-info-label">Ngày quyết định phê duyệt HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <input type="text" id="ip-ngayquyetdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${gt.ngayQuyetDinh ? view.model.formatForDateInput(gt.ngayQuyetDinh) : ""}" placeholder="dd/MM/yyyy">
                                        ` : `
                                            <span class="package-info-value">${gt.ngayQuyetDinh ? view.model.formatDate(gt.ngayQuyetDinh) : "--"}</span>
                                        `}
                                    </div>
                                </div>
                                <div class="bf-s-41ff9fcb41">
                                    <div class="bf-s-c733ba5cc7">
                                        <span class="package-info-label">Yêu cầu thẩm định HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div class="bf-s-f87b7dd318">
                                                <label class="bf-s-b3a13cfc23">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Có" ${gt.yeuCauThamDinhHsmt === "Có" ? "checked" : ""} class="bf-s-6a453d398f"> Có
                                                </label>
                                                <label class="bf-s-b3a13cfc23">
                                                    <input type="radio" name="ip-yeucauthamdinh" value="Không" ${gt.yeuCauThamDinhHsmt === "Không" || !gt.yeuCauThamDinhHsmt ? "checked" : ""} class="bf-s-6a453d398f"> Không
                                                </label>
                                            </div>
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.yeuCauThamDinhHsmt || "Không")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-sobaocaothamdinh" style="display: ${view._inPlaceEditMode || gt.yeuCauThamDinhHsmt === "Có" ? "flex" : "none"}; justify-content: space-between; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span class="package-info-label">Số BCTĐ HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div class="bf-s-be718f4a76">
                                                <input type="text" id="ip-sobaocaothamdinh" class="form-control bf-s-2c034cb5e7" value="${safeAttr(gt.soBaoCaoThamDinhHsmt || "")}" placeholder="Nhập số báo cáo">
                                                <span class="error-msg-inline bf-s-17b31d44f2" id="err-sobaocao">Vui lòng nhập số báo cáo</span>
                                            </div>
                                        ` : `
                                            <span class="package-info-value">${escapeHtml(gt.soBaoCaoThamDinhHsmt || "--")}</span>
                                        `}
                                    </div>
                                    <div id="wrapper-ngaybaocaothamdinh" style="display: ${view._inPlaceEditMode || gt.yeuCauThamDinhHsmt === "Có" ? "flex" : "none"}; justify-content: space-between; padding-bottom: 8px; font-size: 0.83rem; align-items: center;">
                                        <span class="package-info-label">Ngày BCTĐ HSMT</span>
                                        ${view._inPlaceEditMode ? `
                                            <div class="bf-s-be718f4a76">
                                                <input type="text" id="ip-ngaybaocaothamdinh" class="form-control flatpickr-date bf-s-2c034cb5e7" value="${gt.ngayBaoCaoThamDinhHsmt ? view.model.formatForDateInput(gt.ngayBaoCaoThamDinhHsmt) : ""}" placeholder="dd/MM/yyyy">
                                                <span class="error-msg-inline bf-s-17b31d44f2" id="err-ngaybaocao">Vui lòng chọn ngày báo cáo</span>
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
                        <div class="bf-s-404d922254">
                            <button id="btn-cancel-inplace" class="btn btn-outline bf-s-62c1ff7ddc">Hủy</button>
                            <button id="btn-save-inplace" class="btn btn-primary bf-s-62c1ff7ddc">Lưu</button>
                        </div>
                    ` : `
                        ${isEditable && gt.trangThai !== "Đang chấm thầu" && gt.trangThai !== "Đã có kết quả một phần" && gt.trangThai !== "Đã có kết quả" && gt.trangThai !== "Hủy thầu" ? `
                            <div class="bf-s-d6f1b866d4">
                                <button id="btn-edit-goithau-bottom" class="btn btn-primary bf-s-62c1ff7ddc">
                                    <i data-lucide="edit"></i> Sửa gói thầu
                                </button>
                            </div>
                        ` : ""}
                    `}
                `);
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
              setRuntimeStyle(document.getElementById("wrapper-sobaocaothamdinh"), "display", show ? "flex" : "none");
              setRuntimeStyle(document.getElementById("wrapper-ngaybaocaothamdinh"), "display", show ? "flex" : "none");
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
                    setRuntimeStyle(inpSo, "border", "1px solid #ef4444");
                    if (errEl) setRuntimeStyle(errEl, "display", "block");
                    hasErr = true;
                    errorInputs.push(inpSo);
                  } else {
                    setRuntimeStyle(inpSo, "border", "");
                    if (errEl) setRuntimeStyle(errEl, "display", "none");
                  }
                  inpSo.oninput = () => {
                    setRuntimeStyle(inpSo, "border", "");
                    if (errEl) setRuntimeStyle(errEl, "display", "none");
                  };
                }
                if (inpNgay) {
                  const errEl = document.getElementById("err-ngaybaocao");
                  if (!valNgayBaoCao.trim()) {
                    setRuntimeStyle(inpNgay, "border", "1px solid #ef4444");
                    if (errEl) setRuntimeStyle(errEl, "display", "block");
                    hasErr = true;
                    errorInputs.push(inpNgay);
                  } else {
                    setRuntimeStyle(inpNgay, "border", "");
                    if (errEl) setRuntimeStyle(errEl, "display", "none");
                  }
                  inpNgay.onchange = () => {
                    setRuntimeStyle(inpNgay, "border", "");
                    if (errEl) setRuntimeStyle(errEl, "display", "none");
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
