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
        experts: [
            { code: '{#Danh_Sach_Chuyen_Gia}', desc: 'Bắt đầu vòng lặp tổ chuyên gia' },
            { code: '{STT}', desc: 'Số thứ tự chuyên gia' },
            { code: '{/Danh_Sach_Chuyen_Gia}', desc: 'Kết thúc vòng lặp tổ chuyên gia' },
            { code: '{#Danh_Sach_Tham_Dinh}', desc: 'Bắt đầu vòng lặp tổ thẩm định' },
            { code: '{STT}', desc: 'Số thứ tự thẩm định viên' },
            { code: '{/Danh_Sach_Tham_Dinh}', desc: 'Kết thúc vòng lặp tổ thẩm định' }
        ],
        contractors: [
            { code: '{#Danh_Sach_Nha_Thau}', desc: 'Bắt đầu vòng lặp danh sách nhà thầu tham dự' },
            { code: '{STT}', desc: 'Số thứ tự nhà thầu tham dự' },
            { code: '{#Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Bắt đầu vòng lặp thành viên liên danh của nhà thầu trúng' },
            { code: '{Ten_TV}', desc: '(Liên danh) Tên thành viên liên danh' },
            { code: '{MST_TV}', desc: '(Liên danh) Mã số thuế thành viên liên danh' },
            { code: '{Vai_Tro_TV}', desc: '(Liên danh) Vai trò thành viên (Liên danh chính / liên danh phụ)' },
            { code: '{Nguoi_Dai_Dien_TV}', desc: '(Liên danh) Người đại diện thành viên liên danh' },
            { code: '{Dia_Chi_TV}', desc: '(Liên danh) Địa chỉ thành viên liên danh' },
            { code: '{So_Tai_Khoan_TV}', desc: '(Liên danh) Số tài khoản thành viên liên danh' },
            { code: '{Noi_Mo_Tai_Khoan_TV}', desc: '(Liên danh) Nơi mở tài khoản thành viên liên danh' },
            { code: '{/Thanh_Vien_Lien_Danh}', desc: '(Liên danh) Kết thúc vòng lặp thành viên liên danh' },
            { code: '{/Danh_Sach_Nha_Thau}', desc: 'Kết thúc vòng lặp nhà thầu' },
            { code: '{#Danh_Sach_Nha_Thau_Truot}', desc: 'Bắt đầu vòng lặp danh sách nhà thầu trượt thầu' },
            { code: '{Ten_Nha_Thau}', desc: 'Tên nhà thầu trượt thầu' },
            { code: '{Ma_Nha_Thau}', desc: 'Mã định danh/MST nhà thầu trượt' },
            { code: '{Ly_Do_Truot}', desc: 'Lý do trượt thầu (phân tích tự động hoặc người dùng tự gõ)' },
            { code: '{/Danh_Sach_Nha_Thau_Truot}', desc: 'Kết thúc vòng lặp danh sách nhà thầu trượt' }
        ],
        phanlo: [
            { code: '{#Danh_Sach_Phan_Lo}', desc: 'Bắt đầu vòng lặp danh sách phân lô gói thầu' },
            { code: '{STT}', desc: 'Số thứ tự phân lô' },
            { code: '{Ten_Phan_Lo}', desc: 'Tên phân lô' },
            { code: '{Gia_Tri_Phan_Lo}', desc: 'Giá trúng thầu phân lô' },
            { code: '{Nha_Thau_Trung}', desc: 'Tên nhà thầu trúng thầu phân lô tương ứng' },
            { code: '{Thoi_Gian_Thuc_Hien}', desc: 'Thời gian thực hiện hợp đồng phân lô' },
            { code: '{/Danh_Sach_Phan_Lo}', desc: 'Kết thúc vòng lặp phân lô' }
        ],
        tuychonmuathem: [
            { code: '{#Danh_Sach_Tuy_Chon_Mua_Them}', desc: 'Bắt đầu vòng lặp tùy chọn mua thêm' },
            { code: '{STT}', desc: 'Số thứ tự tùy chọn mua thêm' },
            { code: '{Hang_Muc}', desc: 'Tên hạng mục tùy chọn mua thêm' },
            { code: '{Don_Vi}', desc: 'Đơn vị tính' },
            { code: '{So_Luong}', desc: 'Số lượng mua thêm' },
            { code: '{Ty_Le}', desc: 'Tỷ lệ % mua thêm' },
            { code: '{Gia_Tri_Uoc_Tinh}', desc: 'Giá trị ước tính mua thêm' },
            { code: '{/Danh_Sach_Tuy_Chon_Mua_Them}', desc: 'Kết thúc vòng lặp mua thêm' }
        ]
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
            'goi_dich_vu': 'Gói dịch vụ'
        };
        return labels[tbl] || tbl;
    };

    const getColumnLabel = (tbl, col) => {
        const cols = {
            'chu_dau_tu': {
                'ten_chu_dau_tu': 'Tên chủ đầu tư',
                'ma_chu_dau_tu': 'Mã chủ đầu tư',
                'ma_so_thue': 'Mã số thuế',
                'chuc_vu_nguoi_dung_dau': 'Chức vụ người đứng đầu',
                'nguoi_ky_quyet_dinh': 'Người ký QĐ',
                'chuc_vu_nguoi_ky': 'Chức vụ người ký',
                'danh_xung': 'Danh xưng',
                'dia_chi': 'Địa chỉ',
                'so_dien_thoai': 'Số điện thoại',
                'email': 'Email',
                'so_tai_khoan': 'Số tài khoản',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản',
                'ma_qhns': 'Mã QHNS',
                'co_quan_chu_quan': 'Cơ quan chủ quản',
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
                'phien_ban': 'Phiên bản'
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
                'don_vi_cap_chung_chi': 'Đơn vị cấp chứng chỉ',
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
                'lam_ro_tai_chinh': 'Làm rõ tài chính'
            },
            'tai_khoan': {
                'ten_dang_nhap': 'Tên đăng nhập',
                'ho_ten': 'Họ và tên',
                'email': 'Email',
                'so_dien_thoai': 'Số điện thoại',
                'chuc_vu': 'Chức vụ'
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
                'thoi_han_thang': 'Thời hạn (tháng)'
            }
        };
        return (cols[tbl] && cols[tbl][col]) || col;
    };

    let variables = DICTIONARY[group] || [];
    if (group === 'global' && this.model.state && this.model.state.wordMappings) {
        const customVars = this.model.state.wordMappings.map(m => ({
            code: `{${m.tenBien}}`,
            desc: `Biến tự định nghĩa (Ánh xạ: Bảng ${getTableLabel(m.sourceTable)} -> ${getColumnLabel(m.sourceTable, m.sourceColumn)})`,
            isCustom: true,
            id: m.id,
            sourceTable: m.sourceTable,
            sourceColumn: m.sourceColumn,
            tenBien: m.tenBien
        }));
        variables = [...variables, ...customVars];
    }

    if (variables.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">Chưa có biến nào trong nhóm này.</td></tr>`;
        return;
    }

    tbody.innerHTML = variables.map(v => {
        let actionHTML = '';
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

        let descHTML = '';
        if (v.isCustom) {
            descHTML = `
                <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">${getTableLabel(v.sourceTable)}</span>
                <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                <span class="fw-bold" style="font-size: 0.8rem;">${getColumnLabel(v.sourceTable, v.sourceColumn)}</span>
            `;
        } else {
            descHTML = `<span style="font-size: 0.8rem; color: var(--text-muted);">${v.desc}</span>`;
        }

        return `
            <tr>
                <td><code style="font-size:0.82rem; color:var(--primary); font-weight:700; background:var(--primary-soft); padding:4px 8px; border-radius:4px;">${v.code}</code></td>
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
