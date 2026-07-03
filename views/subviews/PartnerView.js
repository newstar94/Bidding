import { renderChuDauTuTable, showChuDauTuDetails, renderChuDauTuVersionDetails } from './partner/ChuDauTuComponent.js';
import { renderNhaThauTable, showNhaThauDetails, renderNhaThauVersionDetails } from './partner/NhaThauComponent.js';
import { renderChuyenGiaTable, showChuyenGiaDetails } from './partner/ChuyenGiaComponent.js';
import { renderHopDongTable, showHopDongDetails, renderContractVersionDetails } from './partner/HopDongComponent.js';

// Bind to window for HTML compatibility
window.renderChuDauTuTable = renderChuDauTuTable;
window.showChuDauTuDetails = showChuDauTuDetails;
window.renderChuDauTuVersionDetails = renderChuDauTuVersionDetails;

window.renderNhaThauTable = renderNhaThauTable;
window.showNhaThauDetails = showNhaThauDetails;
window.renderNhaThauVersionDetails = renderNhaThauVersionDetails;

window.renderChuyenGiaTable = renderChuyenGiaTable;
window.showChuyenGiaDetails = showChuyenGiaDetails;

window.renderHopDongTable = renderHopDongTable;
window.showHopDongDetails = showHopDongDetails;
window.renderContractVersionDetails = renderContractVersionDetails;

export {
    renderChuDauTuTable,
    showChuDauTuDetails,
    renderChuDauTuVersionDetails,
    renderNhaThauTable,
    showNhaThauDetails,
    renderNhaThauVersionDetails,
    renderChuyenGiaTable,
    showChuyenGiaDetails,
    renderHopDongTable,
    showHopDongDetails,
    renderContractVersionDetails
};

export function renderBieumauTab(templatesList = []) {
    const tbody = document.getElementById('word-templates-tbody');
    if (!tbody) return;

    if (templatesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Đang tải biểu mẫu...</td></tr>`;
        return;
    }

    tbody.innerHTML = templatesList.map(tpl => {
        const activeBadge = tpl.is_active
            ? '<span class="badge badge-success"><i data-lucide="check-circle"></i> Đang hoạt động</span>'
            : `<span class="badge badge-neutral btn-activate-template" data-filename="${tpl.filename}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Nhấn để sử dụng làm mẫu chính"><i data-lucide="play" style="width: 12px; height: 12px;"></i> Sẵn sàng</span>`;

        const actionButton = tpl.is_active
            ? `<span class="text-success fw-bold" style="font-size:0.8rem;">Đang dùng</span>`
            : `<button class="btn btn-outline btn-sm btn-activate-template" data-filename="${tpl.filename}">Sử dụng</button>`;

        return `
            <tr>
                <td class="fw-bold">${tpl.name}</td>
                <td>${activeBadge}</td>
                <td class="text-right">${actionButton}</td>
            </tr>
        `;
    }).join('');
    lucide.createIcons({ root: tbody });
}

export function renderDictionary(group) {
    const tbody = document.getElementById('dictionary-table-body');
    if (!tbody) return;

    const DICTIONARY = {
        global: [],
        custom_lists: []
    };

    const getTableLabel = (tbl) => {
        const labels = {
            'chu_dau_tu': 'Chủ đầu tư',
            'ke_hoach_lcnt': 'Kế hoạch LCNT',
            'goi_thau': 'Gói thầu',
            'nha_thau': 'Nhà thầu',
            'hop_dong': 'Hợp đồng',
            'chuyen_gia': 'Chuyên gia',
            'thong_tin_mo_thau': 'Thông tin mở thầu',
            'tai_khoan': 'Tài khoản cá nhân',
            'to_chuc': 'Tổ chức / Doanh nghiệp',
            'goi_dich_vu': 'Gói dịch vụ',
            'yeu_cau_lam_ro': 'Yêu cầu làm rõ',
            'yeu_cau_lam_ro_list': 'Yêu cầu làm rõ',
            'tra_loi_lam_ro': 'Trả lời làm rõ',
            'tra_loi_lam_ro_list': 'Trả lời làm rõ',
            'phan_lo': 'Phân lô',
            'phan_lo_list': 'Phân lô',
            'tuy_chon_mua_them': 'Tùy chọn mua thêm',
            'tuy_chon_mua_them_list': 'Tùy chọn mua thêm',
            'gia_han': 'Gia hạn',
            'gia_han_list': 'Gia hạn',
            'thanh_vien_lien_danh': 'Thành viên liên danh',
            'cv_da_thuc_hien': 'Công việc đã thực hiện',
            'cv_khong_ap_dung': 'Công việc không áp dụng LCNT',
            'cv_chua_du_dieu_kien': 'Công việc chưa đủ điều kiện LCNT',
            'awarded_phan_lo_list': 'Phần lô trúng thầu',
            'goi_thau_ids': 'Gói thầu liên kết',
            'nha_thau_trung_thau': 'Nhà thầu trúng thầu',
            'nha_thau_truot_thau': 'Nhà thầu trượt thầu',
            'to_chuyen_gia': 'Tổ chuyên gia',
            'to_tham_dinh': 'Tổ thẩm định'
        };
        return labels[tbl] || tbl;
    };

    const getColumnLabel = (tbl, col) => {
        if (!col || col === '*') return 'Toàn bộ bảng (Biến danh sách)';
        
        let normTbl = tbl || '';
        if (normTbl.endsWith('_list')) {
            normTbl = normTbl.substring(0, normTbl.length - 5);
        }
        if (normTbl.startsWith('awarded_')) {
            normTbl = normTbl.substring(8);
        }
        if (normTbl === 'nha_thau_trung_thau' || normTbl === 'nha_thau_truot_thau') {
            normTbl = 'nha_thau';
        }
        if (normTbl === 'to_chuyen_gia' || normTbl === 'to_tham_dinh') {
            normTbl = 'chuyen_gia';
        }
        if (normTbl === 'user') {
            normTbl = 'tai_khoan';
        }

        const cols = {
            'chu_dau_tu': {
                'ten_chu_dau_tu': 'Tên chủ đầu tư',
                'ma_chu_dau_tu': 'Mã chủ đầu tư',
                'ma_so_thue': 'Mã số thuế',
                'chuc_vu_nguoi_dung_dau': 'Chức vụ người đứng đầu',
                'dai_dien_cdt': 'Đại diện CĐT',
                'chuc_vu_dai_dien': 'Chức vụ người đại diện',
                'danh_xung': 'Danh xưng',
                'dia_chi': 'Địa chỉ',
                'so_dien_thoai': 'Số điện thoại',
                'email': 'Email',
                'so_tai_khoan': 'Số tài khoản',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản',
                'ma_qhns': 'Mã QHNS',
                'ma_ngan_hang': 'Mã ngân hàng',
                'co_quan_chu_quan': 'Cơ quan chủ quan',
                'phien_ban': 'Phiên bản'
            },
            'ke_hoach_lcnt': {
                'ten_ke_hoach': 'Tên kế hoạch LCNT',
                'ma_ke_hoach': 'Mã kế hoạch LCNT',
                'ma_du_an': 'Mã dự án',
                'ten_du_an_du_toan': 'Tên dự án / Dự toán',
                'loai_hinh_mua_sam': 'Loại hình mua sắm',
                'tong_muc_dau_tu': 'Tổng mức đầu tư',
                'quyet_dinh_phe_duyet': 'QĐ phê duyệt',
                'ngay_phe_duyet': 'Ngày phê duyệt',
                'so_quyet_dinh': 'Số quyết định',
                'ngay_quyet_dinh': 'Ngày quyết định',
                'thoi_gian_dang_tai': 'Thời gian đăng tải',
                'nguon_von': 'Nguồn vốn',
                'thoi_gian_du_an': 'Thời gian dự án',
                'dia_diem_quy_mo': 'Địa điểm quy mô',
                'thong_tin_khac': 'Thông tin khác',
                'so_qd_phe_duyet_du_an': 'Số QĐ phê duyệt dự án',
                'ngay_qd_phe_duyet_du_an': 'Ngày QĐ phê duyệt dự án',
                'co_quan_phe_duyet_du_an': 'Cơ quan phê duyệt dự án',
                'phe_duyet': 'Người phê duyệt',
                'ngay_trinh_du_toan': 'Ngày trình dự toán',
                'ngay_phe_duyet_du_toan': 'Ngày phê duyệt dự toán',
                'so_qd_phe_duyet_du_toan': 'Số QĐ phê duyệt dự toán',
                'ngay_trinh_ke_hoach': 'Ngày trình kế hoạch LCNT',
                'phien_ban': 'Phiên bản'
            },
            'goi_thau': {
                'ten_goi_thau': 'Tên gói thầu',
                'ma_goi_thau': 'Mã gói thầu',
                'gia_goi_thau': 'Giá gói thầu',
                'hinh_thuc_lua_chon': 'Hình thức LCNT',
                'phuong_thuc_lua_chon': 'Phương thức LCNT',
                'loai_hop_dong': 'Loại hợp đồng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'nguon_von': 'Nguồn vốn',
                'gia_trung_thau': 'Giá trúng thầu',
                'linh_vuc': 'Lĩnh vực',
                'tuy_chon_mua_them': 'Tùy chọn mua thêm',
                'thoi_gian_to_chuc': 'Thời gian tổ chức',
                'thoi_gian_bat_dau_to_chuc': 'Thời gian bắt đầu tổ chức',
                'phan_lo': 'Phân lô',
                'thoi_gian_dang_tai': 'Thời gian đăng tải',
                'thoi_gian_dong_thau': 'Thời gian đóng thầu',
                'thoi_gian_mo_thau': 'Thời gian mở thầu',
                'so_quyet_dinh': 'Số QĐ phê duyệt',
                'ngay_quyet_dinh': 'Ngày QĐ phê duyệt',
                'so_quyet_dinh_ket_qua': 'Số QĐ kết quả',
                'ngay_quyet_dinh_ket_qua': 'Ngày QĐ kết quả',
                'thoi_gian_goi_thau': 'Thời gian gói thầu',
                'thoi_gian_hop_dong': 'Thời gian hợp đồng',
                'gia_tri_dam_bao_du_thau': 'Giá trị bảo đảm dự thầu',
                'hieu_luc_hsdt': 'Hiệu lực HSDT',
                'hieu_luc_dam_bao_du_thau': 'Hiệu lực bảo đảm dự thầu',
                'gia_han_list': 'Gia hạn thời gian mở thầu / đóng thầu',
                'yeu_cau_lam_ro_list': 'Làm rõ hồ sơ mời thầu (Yêu cầu)',
                'tra_loi_lam_ro_list': 'Trả lời làm rõ hồ sơ mời thầu',
                'so_to_trinh_hsmt': 'Số tờ trình HSMT',
                'ngay_trinh_hsmt': 'Ngày trình HSMT',
                'yeu_cau_tham_dinh_hsmt': 'Yêu cầu thẩm định HSMT (Có/Không)',
                'so_bao_cao_tham_dinh_hsmt': 'Số báo cáo thẩm định HSMT',
                'ngay_bao_cao_tham_dinh_hsmt': 'Ngày báo cáo thẩm định HSMT',
                'trang_thai': 'Trạng thái',
                'phien_ban': 'Phiên bản',
                'hinh_thuc_lua_chon_nha_thau': 'Hình thức LCNT',
                'phuong_thuc_lua_chon_nha_thau': 'Phương thức LCNT',
                'ngay_yeu_cau_bao_gia': 'Ngày yêu cầu báo giá',
                'ngay_gui_bao_gia': 'Ngày gửi báo giá',
                'ngay_bao_cao_danh_gia_nha_thau': 'Ngày báo cáo đánh giá nhà thầu',
                'ngay_moi_thuong_thao': 'Ngày mời thương thảo',
                'ngay_thuong_thao': 'Ngày thương thảo',
                'ngay_trinh_ket_qua': 'Ngày trình kết quả LCNT'
            },
            'nha_thau': {
                'ten_nha_thau': 'Tên nhà thầu',
                'ma_nha_thau': 'Mã nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu',
                'ma_so_thue': 'Mã số thuế',
                'nguoi_dai_dien': 'Người đại diện',
                'danh_xung': 'Danh xưng',
                'so_dien_thoai': 'Số điện thoại',
                'email': 'Email',
                'dia_chi': 'Địa chỉ',
                'so_tai_khoan': 'Số tài khoản',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản',
                'ma_ngan_hang': 'Mã ngân hàng',
                'phien_ban': 'Phiên bản'
            },
            'hop_dong': {
                'ten_hop_dong': 'Tên hợp đồng',
                'so_hop_dong': 'Số hợp đồng',
                'ngay_ky': 'Ngày ký',
                'gia_tri': 'Giá trị hợp đồng',
                'loai_hop_dong': 'Loại hợp đồng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'trang_thai_ho_so': 'Trạng thái hồ sơ',
                'phan_loai': 'Phân loại (Tư vấn/Thẩm định)',
                'co_qd_chi_dinh': 'Có QĐ chỉ định thầu không (0/1)',
                'so_qd_chi_dinh': 'Số QĐ chỉ định',
                'ngay_qd_chi_dinh': 'Ngày QĐ chỉ định'
            },
            'chuyen_gia': {
                'ho_ten': 'Họ tên chuyên gia',
                'so_cccd': 'Số CCCD',
                'ngay_cap_cccd': 'Ngày cấp CCCD',
                'noi_cap_cccd': 'Nơi cấp CCCD',
                'so_chung_chi': 'Số chứng chỉ',
                'ngay_cap_chung_chi': 'Ngày cấp chứng chỉ',
                'don_vi_cap_chung_chi': 'Don vị cấp chứng chỉ',
                'chuc_vu': 'Chức vụ trong tổ',
                'cong_viec': 'Nhiệm vụ phân công'
            },
            'thong_tin_mo_thau': {
                'gia_du_thau': 'Giá dự thầu',
                'dam_bao_du_thau': 'Bảo đảm dự thầu',
                'hieu_luc_dam_bao': 'Hiệu lực bảo đảm',
                'hieu_luc_hsdxt': 'Hiệu lực HSDXT',
                'ty_le_giam_gia': 'Tỷ lệ giảm giá',
                'gia_sau_giam_gia': 'Giá sau giảm giá',
                'hieu_luc_hsdt': 'Hiệu lực HSDT',
                'gia_tri_dam_bao': 'Giá trị bảo đảm',
                'hieu_luc_bao_dam_ngay': 'Hiệu lực bảo đảm (ngày)',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện',
                'ten_nha_thau': 'Tên nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu',
                'danh_gia_hop_le': 'Đánh giá hợp lệ',
                'danh_gia_nang_luc': 'Đánh giá năng lực',
                'danh_gia_ky_thuat': 'Đánh giá kỹ thuật',
                'danh_gia_tai_chinh': 'Đánh giá tài chính',
                'danh_gia_ket_luan': 'Đánh giá kết luận',
                'ly_do_truot': 'Lý do trượt',
                'lam_ro_hop_le': 'Làm rõ hợp lệ',
                'lam_ro_nang_luc': 'Làm rõ năng lực',
                'lam_ro_ky_thuat': 'Làm rõ kỹ thuật',
                'lam_ro_tai_chinh': 'Làm rõ tài chính',
                'ma_phan_lo': 'Mã phân lô',
                'ma_dinh_danh': 'Mã định danh'
            },
            'tai_khoan': {
                'ten_dang_nhap': 'Tên đăng nhập',
                'ho_ten': 'Họ và tên',
                'email': 'Email',
                'so_dien_thoai': 'Số điện thoại',
                'chuc_vu': 'Chức vụ',
                'vai_tro': 'Vai trò',
                'ngay_bat_dau_goi': 'Ngày bắt đầu gói',
                'ngay_het_han_goi': 'Ngày hết hạn gói',
                'da_xac_minh': 'Đã xác minh'
            },
            'to_chuc': {
                'ten_to_chuc': 'Tên tổ chức',
                'ma_so_thue': 'Mã số thuế',
                'dia_chi': 'Địa chỉ',
                'nguoi_dai_dien': 'Người đại diện'
            },
            'goi_dich_vu': {
                'ten_goi': 'Tên gói dịch vụ',
                'gia_goi': 'Giá gói dịch vụ',
                'thoi_han_thang': 'Thời hạn (tháng)',
                'gia_ca': 'Giá gói dịch vụ',
                'han_muc_nhan_su': 'Hạn mức nhân sự tối đa',
                'mo_ta': 'Mô tả chi tiết gói'
            },
            'yeu_cau_lam_ro': {
                'thoi_gian_yeu_cau': 'Thời gian yêu cầu làm rõ',
                'noi_dung_yeu_cau': 'Nội dung yêu cầu làm rõ'
            },
            'tra_loi_lam_ro': {
                'thoi_gian_tra_loi': 'Thời gian trả lời làm rõ',
                'noi_dung_tra_loi': 'Nội dung trả lời làm rõ'
            },
            'phan_lo': {
                'ma_phan_lo': 'Mã phân lô',
                'ten_phan_lo': 'Tên phân lô',
                'gia_tri_phan_lo': 'Giá trị phân lô',
                'nha_thau_trung': 'Nhà thầu trúng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện'
            },
            'tuy_chon_mua_them': {
                'hang_muc': 'Hạng mục',
                'don_vi': 'Đơn vị',
                'so_luong': 'Số lượng',
                'ty_le': 'Tỷ lệ',
                'gia_tri_uoc_tinh': 'Giá trị ước tính'
            },
            'gia_han': {
                'thoi_gian_truoc': 'Thời gian trước',
                'thoi_gian_sau': 'Thời gian sau',
                'ngay_gia_han': 'Ngày gia hạn',
                'ly_do': 'Lý do'
            },
            'thanh_vien_lien_danh': {
                'ten_tv': 'Tên thành viên',
                'mst_tv': 'Mã số thuế',
                'vai_tro_tv': 'Vai trò',
                'nguoi_dai_dien_tv': 'Người đại diện',
                'dia_chi_tv': 'Địa chỉ',
                'so_tai_khoan_tv': 'Số tài khoản',
                'noi_mo_tai_khoan_tv': 'Nơi mở tài khoản'
            },
            'cv_da_thuc_hien': {
                'ten_cong_viec': 'Tên công việc',
                'gia_tri': 'Giá trị',
                'don_vi_thuc_hien': 'Đơn vị thực hiện',
                'van_ban_phe_duyet': 'Văn bản phê duyệt'
            },
            'cv_khong_ap_dung': {
                'ten_cong_viec': 'Tên công việc',
                'gia_tri': 'Giá trị',
                'don_vi_thuc_hien': 'Đơn vị thực hiện'
            },
            'cv_chua_du_dieu_kien': {
                'ten_cong_viec': 'Tên công việc',
                'gia_tri': 'Giá trị'
            }
        };
        return (cols[normTbl] && cols[normTbl][col]) || col;
    };

    let variables = DICTIONARY[group] || [];
    if (group === 'global' && this.model.state && this.model.state.wordMappings) {
        const customVars = this.model.state.wordMappings
            .filter(m => m.sourceColumn && m.sourceColumn !== '*')
            .map(m => ({
                code: `{${m.tenBien}}`,
                desc: `Biến tự định nghĩa (Ánh xạ: Bảng ${getTableLabel(m.sourceTable)} -> ${getColumnLabel(m.sourceTable, m.sourceColumn)})`,
                isCustom: true,
                id: m.id,
                sourceTable: m.sourceTable,
                sourceColumn: m.sourceColumn,
                tenBien: m.tenBien
            }));
        variables = [...variables, ...customVars];
    } else if (group === 'custom_lists' && this.model.state && this.model.state.wordMappings) {
        const customLists = this.model.state.wordMappings
            .filter(m => !m.sourceColumn || m.sourceColumn === '*')
            .map(m => ({
                code: `{#${m.tenBien}}`,
                desc: `Biến vòng lặp danh sách tự định nghĩa (Ánh xạ từ bảng: ${getTableLabel(m.sourceTable)})`,
                isCustom: true,
                isList: true,
                id: m.id,
                sourceTable: m.sourceTable,
                sourceColumn: m.sourceColumn,
                tenBien: m.tenBien
            }));
        variables = [...variables, ...customLists];
    }

    // Filter variables dynamically based on currently selected values in the mapping forms
    const tableSelect = document.getElementById('wm-source-table');
    const columnSelect = document.getElementById('wm-source-column');
    const wmlTableSelect = document.getElementById('wml-source-table');

    let filterTable = null;
    let filterColumn = null;

    if (group === 'global') {
        if (tableSelect && tableSelect.value) {
            filterTable = tableSelect.value;
        }
        if (columnSelect && columnSelect.value) {
            filterColumn = columnSelect.value;
        }
    } else if (group === 'custom_lists') {
        if (wmlTableSelect && wmlTableSelect.value) {
            filterTable = wmlTableSelect.value;
        }
    }

    if (filterTable) {
        variables = variables.filter(v => v.sourceTable === filterTable);
    }
    if (filterColumn) {
        variables = variables.filter(v => v.sourceColumn === filterColumn);
    }

    if (variables.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">Chưa có biến nào trong nhóm này.</td></tr>`;
        return;
    }

    tbody.innerHTML = variables.map(v => {
        let codeHTML = '';
        let actionHTML = '';

        if (v.isList) {
            codeHTML = `
                <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                    <code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:3px 6px; border-radius:4px; margin-bottom: 2px;">{#${v.tenBien}}</code>
                    <code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:3px 6px; border-radius:4px;">{/${v.tenBien}}</code>
                </div>
            `;
            actionHTML = `
                <div class="action-btn-group" style="justify-content: flex-end; gap: 8px;">
                    <button class="btn btn-outline btn-sm btn-copy-var" data-copy="{#${v.tenBien}}&#10;&#10;{/${v.tenBien}}" title="Sao chép cả cặp tag" style="padding: 4px 8px; font-size: 0.75rem;">
                        <i data-lucide="copy" style="width:12px; height:12px;"></i>
                    </button>
                    <button class="action-btn btn-edit" onclick="window.editWordMapping('${v.id}')" title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="window.deleteWordMapping('${v.id}')" title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="trash-2" style="width:12px; height:12px; color: var(--danger);"></i>
                    </button>
                </div>
            `;
        } else {
            codeHTML = `<code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${v.code}</code>`;
            if (v.isCustom) {
                actionHTML = `
                    <div class="action-btn-group" style="justify-content: flex-end; gap: 8px;">
                        <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${v.code}" title="Sao chép" style="padding: 4px 8px; font-size: 0.75rem;">
                            <i data-lucide="copy" style="width:12px; height:12px;"></i>
                        </button>
                        <button class="action-btn btn-edit" onclick="window.editWordMapping('${v.id}')" title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                            <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="window.deleteWordMapping('${v.id}')" title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                            <i data-lucide="trash-2" style="width:12px; height:12px; color: var(--danger);"></i>
                        </button>
                    </div>
                `;
            } else {
                actionHTML = `
                    <button class="btn btn-outline btn-sm btn-copy-var" data-copy="${v.code}" style="padding: 4px 8px; font-size: 0.75rem;">
                        <i data-lucide="copy" style="width:12px; height:12px;"></i> Sao chép
                    </button>
                `;
            }
        }

        let descHTML = '';
        if (v.isCustom) {
            if (!v.sourceColumn || v.sourceColumn === '*') {
                descHTML = `
                    <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">Vòng lặp danh sách</span>
                    <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                    <span class="fw-bold" style="font-size: 0.8rem;">Bảng ${getTableLabel(v.sourceTable)}</span>
                `;
            } else {
                descHTML = `
                    <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">${getTableLabel(v.sourceTable)}</span>
                    <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                    <span class="fw-bold" style="font-size: 0.8rem;">${getColumnLabel(v.sourceTable, v.sourceColumn)}</span>
                `;
            }
        } else {
            descHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">${v.desc}</span>`;
        }

        return `
            <tr>
                <td>${codeHTML}</td>
                <td>${descHTML}</td>
                <td class="text-right">${actionHTML}</td>
            </tr>
        `;
    }).join('');
    lucide.createIcons({ root: tbody });
}

export function renderWordMappingsTable(mappingsList = []) {
    const dictionarySelect = document.getElementById('dictionary-group-select');
    const group = dictionarySelect ? dictionarySelect.value : 'global';
    renderDictionary.call(this, group);
}

export function renderWordTemplates(templatesList = []) {
    this.renderBieumauTab(templatesList);
}

export function getJointVentureMemberHTML(cardId, memberData = null) {
    return `
        <button type="button" class="btn-remove-member" onclick="window.removeJointVentureMemberCard('${cardId}')" style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.25rem; color: var(--danger); cursor: pointer;">&times;</button>
        <h5 style="margin: 0 0 12px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-muted);">Thành viên liên danh</h5>
        <div class="form-grid">
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label class="nt-member-ten-label">Tên nhà thầu thành viên <span class="required">*</span></label>
                <input type="text" class="nt-member-ten" required placeholder="Ví dụ: Công ty A" value="${memberData ? memberData.tenNhaThau : ''}">
                <span class="error-text">Vui lòng nhập tên nhà thầu</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Mã số thuế <span class="required">*</span></label>
                <input type="text" class="nt-member-mst" required placeholder="Mã số thuế" value="${memberData ? memberData.maSoThue : ''}">
                <span class="error-text">Vui lòng nhập mã số thuế</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Người đại diện <span class="required">*</span></label>
                <input type="text" class="nt-member-nguoidaidien" required placeholder="Họ tên người đại diện" value="${memberData ? memberData.nguoiDaiDien : ''}">
                <span class="error-text">Vui lòng nhập người đại diện</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Danh xưng <span class="required">*</span></label>
                <select class="nt-member-danhxung" required>
                    <option value="Ông" ${(memberData && memberData.danhXung === 'Ông') ? 'selected' : ''}>Ông</option>
                    <option value="Bà" ${(memberData && memberData.danhXung === 'Bà') ? 'selected' : ''}>Bà</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Điện thoại</label>
                <input type="tel" class="nt-member-sdt" placeholder="Số điện thoại" value="${memberData ? memberData.soDienThoai : ''}">
                <span class="error-text">Vui lòng nhập số điện thoại</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Email</label>
                <input type="email" class="nt-member-email" placeholder="contact@nhathau.com" value="${memberData ? memberData.email : ''}">
                <span class="error-text">Vui lòng nhập email hợp lệ</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 12px;">
                <label>Địa chỉ <span class="required">*</span></label>
                <input type="text" class="nt-member-diachi" required placeholder="Địa chỉ chi tiết" value="${memberData ? memberData.diaChi : ''}">
                <span class="error-text">Vui lòng nhập địa chỉ</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Số tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-sotaikhoan" required placeholder="Số tài khoản" value="${memberData ? memberData.soTaiKhoan : ''}">
                <span class="error-text">Vui lòng nhập số tài khoản</span>
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
                <label>Nơi mở tài khoản <span class="required">*</span></label>
                <input type="text" class="nt-member-noimotaikhoan" required placeholder="Tên ngân hàng" value="${memberData ? memberData.noiMoTaiKhoan : ''}">
                <span class="error-text">Vui lòng nhập nơi mở</span>
            </div>
            <div class="form-group col-span-2" style="margin-bottom: 0;">
                <label>Mã ngân hàng</label>
                <input type="text" class="nt-member-manganhang" placeholder="Mã ngân hàng" value="${memberData ? memberData.maNganHang || '' : ''}">
            </div>
        </div>
    `;
}

// Bind remaining helpers to window
window.renderBieumauTab = renderBieumauTab;
window.renderDictionary = renderDictionary;
window.renderWordMappingsTable = renderWordMappingsTable;
window.renderWordTemplates = renderWordTemplates;
window.getJointVentureMemberHTML = getJointVentureMemberHTML;
