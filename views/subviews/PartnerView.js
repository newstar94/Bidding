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
            'ds_phan_lo': 'Tất cả phần lô',
            'ds_nha_thau_tham_du': 'Nhà thầu tham dự',
            'ds_nha_thau_trung_thau': 'Nhà thầu trúng thầu',
            'ds_nha_thau_truot_thau': 'Nhà thầu trượt thầu',
            'ds_nha_thau_khong_dat': 'Nhà thầu không đạt',
            'ds_nha_thau_dat_khong_xep_hang_1': 'Nhà thầu đạt nhưng không xếp hạng 1',
            'ds_nha_thau_khong_duoc_danh_gia': 'Nhà thầu không được đánh giá',
            'ds_nha_thau_trung_theo_phan_lo': 'Nhà thầu trúng thầu, kèm danh sách phần lô trúng',
            'phan_lo': 'Phần lô',
            'phan_lo_list': 'Phần lô',
            'ds_phan_lo_co_nha_thau_tham_du': 'Phần lô có nhà thầu tham dự',
            'ds_phan_lo_khong_co_nha_thau_tham_du': 'Phần lô không có nhà thầu tham dự',
            'ds_phan_lo_co_nha_thau_tham_du_khong_trung': 'Phần lô tham dự nhưng không có nhà thầu trúng',
            'ds_phan_lo_co_nha_thau_trung': 'Phần lô có nhà thầu trúng thầu',
            '__context__': 'Thực thể động',
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
                'ten_viet_tat': 'Tên viết tắt chủ đầu tư',
                'ma_so_thue': 'Mã số thuế chủ đầu tư',
                'chuc_vu_nguoi_dung_dau': 'Chức vụ người đứng đầu (ví dụ: Giám đốc)',
                'dai_dien_cdt': 'Họ tên người đại diện chủ đầu tư',
                'chuc_vu_dai_dien': 'Chức vụ người đại diện chủ đầu tư',
                'danh_xung': 'Danh xưng người đại diện chủ đầu tư (Ông/Bà)',
                'dia_chi': 'Địa chỉ chủ đầu tư',
                'so_dien_thoai': 'Số điện thoại chủ đầu tư',
                'email': 'Email chủ đầu tư',
                'so_tai_khoan': 'Số tài khoản chủ đầu tư',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản chủ đầu tư',
                'ma_qhns': 'Mã QHNS (Quan hệ ngân sách) chủ đầu tư',
                'co_quan_chu_quan': 'Cơ quan chủ quan của chủ đầu tư',
                'phien_ban': 'Phiên bản dữ liệu'
            },
            'ke_hoach_lcnt': {
                'ten_ke_hoach': 'Tên kế hoạch lựa chọn nhà thầu (LCNT)',
                'ma_ke_hoach': 'Mã kế hoạch lựa chọn nhà thầu (LCNT)',
                'ma_du_an': 'Mã dự án đầu tư',
                'ten_du_an_du_toan': 'Tên dự án / Dự toán mua sắm',
                'loai_hinh_mua_sam': 'Loại hình mua sắm (ví dụ: Xây lắp, Hàng hóa, Phi tư vấn...)',
                'tong_muc_dau_tu': 'Tổng mức đầu tư dự án / Tổng dự toán',
                'quyet_dinh_phe_duyet': 'Số quyết định phê duyệt kế hoạch LCNT',
                'ngay_phe_duyet': 'Ngày phê duyệt quyết định kế hoạch LCNT',
                'thoi_gian_dang_tai': 'Thời gian đăng tải kế hoạch LCNT',
                'nguon_von': 'Nguồn vốn',
                'thoi_gian_du_an': 'Thời gian thực hiện dự án',
                'dia_diem_quy_mo': 'Địa điểm và quy mô xây dựng/mua sắm',
                'thong_tin_khac': 'Thông tin bổ sung khác',
                'so_qd_phe_duyet_du_an': 'Số quyết định phê duyệt dự án đầu tư',
                'ngay_qd_phe_duyet_du_an': 'Ngày quyết định phê duyệt dự án đầu tư',
                'co_quan_phe_duyet_du_an': 'Cơ quan ban hành quyết định phê duyệt dự án',
                'phe_duyet': 'Họ tên người phê duyệt kế hoạch LCNT',
                'ngay_trinh_du_toan': 'Ngày trình duyệt dự toán',
                'ngay_phe_duyet_du_toan': 'Ngày phê duyệt dự toán',
                'so_qd_phe_duyet_du_toan': 'Số quyết định phê duyệt dự toán',
                'ngay_trinh_ke_hoach': 'Ngày trình phê duyệt kế hoạch LCNT',
                'phien_ban': 'Phiên bản dữ liệu'
            },
            'goi_thau': {
                'ten_goi_thau': 'Tên gói thầu',
                'ma_goi_thau': 'Mã gói thầu (Mã TBMT)',
                'gia_goi_thau': 'Giá dự toán gói thầu',
                'hinh_thuc_lua_chon': 'Hình thức lựa chọn nhà thầu',
                'phuong_thuc_lua_chon': 'Phương thức lựa chọn nhà thầu',
                'loai_hop_dong': 'Loại hợp đồng gói thầu',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện gói thầu theo kế hoạch LCNT',
                'nguon_von': 'Nguồn vốn gói thầu',
                'gia_trung_thau': 'Giá trúng thầu',
                'linh_vuc': 'Lĩnh vực gói thầu',
                'tuy_chon_mua_them': 'Tùy chọn mua thêm (Có/Không)',
                'thoi_gian_to_chuc': 'Thời gian tổ chức LCNT',
                'thoi_gian_bat_dau_to_chuc': 'Thời gian bắt đầu tổ chức LCNT',
                'phan_lo': 'Phần lô gói thầu (Có/Không)',
                'thoi_gian_dang_tai': 'Thời gian đăng tải thông báo mời thầu',
                'thoi_gian_dong_thau': 'Thời gian đóng thầu',
                'thoi_gian_mo_thau': 'Thời gian mở thầu',
                'thoi_gian_mo_ehsdxtc': 'Thời gian mở E-HSDXTC (Hồ sơ đề xuất kỹ thuật)',
                'so_quyet_dinh': 'Số quyết định phê duyệt HSMT / Hồ sơ yêu cầu',
                'ngay_quyet_dinh': 'Ngày quyết định phê duyệt HSMT / Hồ sơ yêu cầu',
                'so_quyet_dinh_ket_qua': 'Số quyết định phê duyệt kết quả LCNT',
                'ngay_quyet_dinh_ket_qua': 'Ngày quyết định phê duyệt kết quả LCNT',
                'thoi_gian_goi_thau': 'Thời gian thực hiện gói thầu của nhà thầu trúng thầu',
                'thoi_gian_hop_dong': 'Thời gian thực hiện hợp đồng của nhà thầu trúng thầu',
                'gia_tri_dam_bao_du_thau': 'Giá trị bảo đảm dự thầu',
                'hieu_luc_hsdt': 'Hiệu lực của HSDT (ngày)',
                'hieu_luc_dam_bao_du_thau': 'Hiệu lực bảo đảm dự thầu (ngày)',
                'gia_han_list': 'Gia hạn thời gian mở thầu / đóng thầu',
                'yeu_cau_lam_ro_list': 'Làm rõ hồ sơ mời thầu (Yêu cầu)',
                'tra_loi_lam_ro_list': 'Trả lời làm rõ hồ sơ mời thầu',
                'so_to_trinh_hsmt': 'Số tờ trình phê duyệt HSMT',
                'ngay_trinh_hsmt': 'Ngày trình phê duyệt HSMT',
                'yeu_cau_tham_dinh_hsmt': 'Yêu cầu thẩm định HSMT (Có/Không)',
                'so_bao_cao_tham_dinh_hsmt': 'Số báo cáo thẩm định HSMT',
                'ngay_bao_cao_tham_dinh_hsmt': 'Ngày báo cáo thẩm định HSMT',
                'trang_thai': 'Trạng thái gói thầu',
                'phien_ban': 'Phiên bản dữ liệu',
                'hinh_thuc_lua_chon_nha_thau': 'Hình thức lựa chọn nhà thầu',
                'phuong_thuc_lua_chon_nha_thau': 'Phương thức lựa chọn nhà thầu',
                'ngay_yeu_cau_bao_gia': 'Ngày yêu cầu báo giá',
                'ngay_gui_bao_gia': 'Ngày gửi báo giá',
                'ngay_bao_cao_danh_gia_nha_thau': 'Ngày báo cáo đánh giá nhà thầu',
                'ngay_moi_thuong_thao': 'Ngày mời thương thảo',
                'ngay_thuong_thao': 'Ngày thương thảo',
                'ngay_trinh_ket_qua': 'Ngày trình kết quả LCNT',
                'phuong_phap_danh_gia': 'Phương pháp đánh giá hồ sơ dự thầu (HSDT)',
                'trong_so_ky_thuat': 'Trọng số điểm kỹ thuật (%)',
                'is_thuoc': 'Thuộc danh mục mua sắm tập trung (0: Không, 1: Có)'
            },
            'nha_thau': {
                'ten_nha_thau': 'Tên nhà thầu',
                'ma_nha_thau': 'Mã nhà thầu',
                'ten_viet_tat': 'Tên viết tắt nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu (Độc lập/Liên danh)',
                'ma_so_thue': 'Mã số thuế nhà thầu',
                'nguoi_dai_dien': 'Người đại diện nhà thầu',
                'danh_xung': 'Danh xưng người đại diện nhà thầu',
                'so_dien_thoai': 'Số điện thoại nhà thầu',
                'email': 'Email nhà thầu',
                'dia_chi': 'Địa chỉ nhà thầu',
                'so_tai_khoan': 'Số tài khoản nhà thầu',
                'noi_mo_tai_khoan': 'Nơi mở tài khoản nhà thầu',
                'ma_ngan_hang': 'Mã ngân hàng nhà thầu',
                'phien_ban': 'Phiên bản dữ liệu'
            },
            'hop_dong': {
                'ten_hop_dong': 'Tên hợp đồng',
                'so_hop_dong': 'Số hợp đồng',
                'ngay_ky': 'Ngày ký hợp đồng',
                'gia_tri': 'Giá trị hợp đồng',
                'loai_hop_dong': 'Loại hợp đồng',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện hợp đồng (ngày)',
                'trang_thai_ho_so': 'Trạng thái hồ sơ hợp đồng',
                'phan_loai': 'Phân loại hợp đồng (Tư vấn/Thẩm định/Khác)',
                'co_qd_chi_dinh': 'Có quyết định chỉ định thầu (0: Không, 1: Có)',
                'so_qd_chi_dinh': 'Số quyết định chỉ định thầu',
                'ngay_qd_chi_dinh': 'Ngày quyết định chỉ định thầu'
            },
            'chuyen_gia': {
                'ho_ten': 'Họ tên chuyên gia',
                'so_cccd': 'Số CCCD chuyên gia',
                'ngay_cap_cccd': 'Ngày cấp CCCD chuyên gia',
                'noi_cap_cccd': 'Nơi cấp CCCD chuyên gia',
                'so_chung_chi': 'Số chứng chỉ chuyên gia',
                'ngay_cap_chung_chi': 'Ngày cấp chứng chỉ chuyên gia',
                'don_vi_cap_chung_chi': 'Đơn vị cấp chứng chỉ chuyên gia',
                'chuc_vu': 'Chức vụ chuyên gia trong tổ chuyên gia/thẩm định',
                'cong_viec': 'Nhiệm vụ chuyên gia được phân công'
            },
            'thong_tin_mo_thau': {
                'gia_du_thau': 'Giá dự thầu mở thầu',
                'dam_bao_du_thau': 'Bảo đảm dự thầu mở thầu',
                'hieu_luc_dam_bao': 'Hiệu lực bảo đảm mở thầu',
                'hieu_luc_hsdxt': 'Hiệu lực HSDXT mở thầu',
                'ty_le_giam_gia': 'Tỷ lệ giảm giá mở thầu',
                'gia_sau_giam_gia': 'Giá sau giảm giá mở thầu',
                'hieu_luc_hsdt': 'Hiệu lực HSDT mở thầu (ngày)',
                'gia_tri_dam_bao': 'Giá trị bảo đảm mở thầu',
                'hieu_luc_bao_dam_ngay': 'Hiệu lực bảo đảm mở thầu (ngày)',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện mở thầu',
                'ten_nha_thau': 'Tên nhà thầu mở thầu',
                'loai_nha_thau': 'Loại nhà thầu mở thầu',
                'danh_gia_hop_le': 'Đánh giá hợp lệ mở thầu',
                'danh_gia_nang_luc': 'Đánh giá năng lực mở thầu',
                'danh_gia_ky_thuat': 'Đánh giá kỹ thuật mở thầu',
                'danh_gia_tai_chinh': 'Đánh giá tài chính mở thầu',
                'danh_gia_ket_luan': 'Đánh giá kết luận mở thầu',
                'ly_do_truot': 'Lý do trượt mở thầu',
                'lam_ro_hop_le': 'Làm rõ hợp lệ mở thầu',
                'lam_ro_nang_luc': 'Làm rõ năng lực mở thầu',
                'lam_ro_ky_thuat': 'Làm rõ kỹ thuật mở thầu',
                'lam_ro_tai_chinh': 'Làm rõ tài chính mở thầu',
                'ma_phan_lo': 'Mã phần lô mở thầu',
                'ma_dinh_danh': 'Mã định danh mở thầu',
                'nguyen_nhan_khong_dat_hop_le': 'Nguyên nhân không đạt đánh giá hợp lệ',
                'nguyen_nhan_khong_dat_nang_luc': 'Nguyên nhân không đạt đánh giá năng lực/kinh nghiệm',
                'nguyen_nhan_khong_dat_ky_thuat': 'Nguyên nhân không đạt đánh giá kỹ thuật'
            },
            'tai_khoan': {
                'ten_dang_nhap': 'Tên đăng nhập hệ thống',
                'ho_ten': 'Họ tên tài khoản',
                'email': 'Email tài khoản',
                'so_dien_thoai': 'Số điện thoại tài khoản',
                'chuc_vu': 'Chức vụ',
                'vai_tro': 'Vai trò tài khoản',
                'ngay_bat_dau_goi': 'Ngày bắt đầu gói dịch vụ',
                'ngay_het_han_goi': 'Ngày hết hạn gói dịch vụ',
                'da_xac_minh': 'Đã xác minh tài khoản (0/1)'
            },
            'to_chuc': {
                'ten_to_chuc': 'Tên tổ chức / Doanh nghiệp',
                'ma_so_thue': 'Mã số thuế tổ chức',
                'dia_chi': 'Địa chỉ tổ chức',
                'nguoi_dai_dien': 'Người đại diện tổ chức'
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
                'ma_phan_lo': 'Mã phần lô',
                'ten_phan_lo': 'Tên phần lô',
                'gia_tri_phan_lo': 'Giá trị phần lô',
                'nha_thau_trung': 'Nhà thầu trúng thầu phần lô',
                'thoi_gian_thuc_hien': 'Thời gian thực hiện phần lô'
            },
            'tuy_chon_mua_them': {
                'hang_muc': 'Hạng mục mua thêm',
                'don_vi': 'Đơn vị tính mua thêm',
                'so_luong': 'Số lượng mua thêm',
                'ty_le': 'Tỷ lệ mua thêm',
                'gia_tri_uoc_tinh': 'Giá trị ước tính mua thêm'
            },
            'gia_han': {
                'thoi_gian_truoc': 'Thời gian trước gia hạn',
                'thoi_gian_sau': 'Thời gian sau gia hạn',
                'ngay_gia_han': 'Ngày quyết định gia hạn',
                'ly_do': 'Lý do gia hạn'
            },
            'thanh_vien_lien_danh': {
                'ten_tv': 'Tên thành viên liên danh',
                'mst_tv': 'Mã số thuế thành viên liên danh',
                'vai_tro_tv': 'Vai trò thành viên liên danh',
                'nguoi_dai_dien_tv': 'Người đại diện thành viên liên danh',
                'dia_chi_tv': 'Địa chỉ thành viên liên danh',
                'so_tai_khoan_tv': 'Số tài khoản thành viên liên danh',
                'noi_mo_tai_khoan_tv': 'Nơi mở tài khoản thành viên liên danh'
            },
            'cv_da_thuc_hien': {
                'ten_cong_viec': 'Tên công việc đã thực hiện',
                'gia_tri': 'Giá trị công việc đã thực hiện',
                'don_vi_thuc_hien': 'Đơn vị thực hiện công việc',
                'van_ban_phe_duyet': 'Văn bản phê duyệt công việc'
            },
            'cv_khong_ap_dung': {
                'ten_cong_viec': 'Tên công việc không áp dụng LCNT',
                'gia_tri': 'Giá trị công việc không áp dụng LCNT',
                'don_vi_thuc_hien': 'Đơn vị thực hiện công việc không áp dụng LCNT'
            },
            'cv_chua_du_dieu_kien': {
                'ten_cong_viec': 'Tên công việc chưa đủ điều kiện LCNT',
                'gia_tri': 'Giá trị công việc chưa đủ điều kiện LCNT'
            },
            '__context__': {
                'tong_so_phan_lo': 'Tổng số phần lô',
                'so_phan_lo_co_nha_thau_tham_du': 'Số phần lô có nhà thầu tham dự',
                'so_phan_lo_khong_co_nha_thau_tham_du': 'Số phần lô không có nhà thầu tham dự',
                'so_phan_lo_tham_du_khong_trung': 'Số phần lô có nhà thầu tham dự nhưng không có nhà thầu trúng',
                'so_phan_lo_co_nha_thau_trung': 'Số phần lô có nhà thầu trúng thầu',
                'tong_so_nha_thau_tham_du': 'Tổng số nhà thầu tham dự',
                'so_nha_thau_trung_thau': 'Số nhà thầu trúng thầu',
                'so_nha_thau_truot_thau': 'Số nhà thầu trượt thầu',
                'so_nha_thau_khong_dat': 'Số nhà thầu không đạt',
                'so_nha_thau_dat_khong_xep_hang_1': 'Số nhà thầu đạt nhưng không xếp hạng 1',
                'so_nha_thau_khong_duoc_danh_gia': 'Số nhà thầu không được đánh giá'
            },
            'ds_phan_lo': {
                'ma_phan_lo': 'Mã phần lô',
                'ten_phan_lo': 'Tên phần lô',
                'gia_tri_phan_lo': 'Giá trị phần lô',
                'so_nha_thau_tham_du': 'Số nhà thầu tham dự phần lô',
                'co_nha_thau_tham_du': 'Có nhà thầu tham dự',
                'co_nha_thau_trung': 'Có nhà thầu trúng thầu',
                'ten_nha_thau_trung': 'Tên nhà thầu trúng thầu phần lô',
                'gia_trung_thau': 'Giá trúng thầu phần lô',
                'ds_ten_nha_thau_tham_du': 'Danh sách tên nhà thầu tham dự phần lô',
                'ly_do_khong_trung': 'Lý do không trúng của phần lô'
            },
            'ds_nha_thau_tham_du': {
                'ma_nha_thau': 'Mã nhà thầu',
                'ten_nha_thau': 'Tên nhà thầu',
                'ten_viet_tat': 'Tên viết tắt nhà thầu',
                'loai_nha_thau': 'Loại nhà thầu',
                'ma_phan_lo': 'Mã phần lô tham dự',
                'ten_phan_lo': 'Tên phần lô tham dự',
                'gia_du_thau': 'Giá dự thầu',
                'gia_sau_giam_gia': 'Giá sau giảm giá',
                'danh_gia_hop_le': 'Đánh giá hợp lệ',
                'danh_gia_nang_luc': 'Đánh giá năng lực',
                'danh_gia_ky_thuat': 'Đánh giá kỹ thuật',
                'danh_gia_tai_chinh': 'Đánh giá tài chính / xếp hạng',
                'danh_gia_ket_luan': 'Kết luận đánh giá',
                'ly_do_truot': 'Lý do trượt thầu'
            },
            'ds_nha_thau_trung_theo_phan_lo': {
                'ma_nha_thau': 'Mã nhà thầu trúng',
                'ten_nha_thau': 'Tên nhà thầu trúng',
                'ten_viet_tat': 'Tên viết tắt nhà thầu trúng',
                'so_phan_lo_trung': 'Số phần lô trúng',
                'tong_gia_tri_trung_thau': 'Tổng giá trị trúng thầu'
            }
        };
        [
            'ds_phan_lo_co_nha_thau_tham_du',
            'ds_phan_lo_khong_co_nha_thau_tham_du',
            'ds_phan_lo_co_nha_thau_tham_du_khong_trung',
            'ds_phan_lo_co_nha_thau_trung'
        ].forEach(key => { cols[key] = cols.ds_phan_lo; });
        [
            'ds_nha_thau_trung_thau',
            'ds_nha_thau_truot_thau',
            'ds_nha_thau_khong_dat',
            'ds_nha_thau_dat_khong_xep_hang_1',
            'ds_nha_thau_khong_duoc_danh_gia'
        ].forEach(key => { cols[key] = cols.ds_nha_thau_tham_du; });
        return (cols[normTbl] && cols[normTbl][col]) || col;
    };

    let variables = DICTIONARY[group] || [];
    if (group === 'global' && this.model.state && this.model.state.wordMappings) {
        const customVars = this.model.state.wordMappings
            .filter(m => m.sourceColumn && m.sourceColumn !== '*' && m.sourceTable !== '__computed__')
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
            .filter(m => (!m.sourceColumn || m.sourceColumn === '*') && m.sourceTable !== '__computed__')
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
    } else if (group === 'computed' && this.model.state && this.model.state.wordMappings) {
        variables = this.model.state.wordMappings
            .filter(m => m.mappingType === 'computed' || m.sourceTable === '__computed__')
            .map(m => ({
                code: `{${m.tenBien}}`,
                desc: m.formula || m.sourceColumn || '',
                isCustom: true,
                isComputed: true,
                id: m.id,
                sourceTable: m.sourceTable,
                sourceColumn: m.sourceColumn,
                tenBien: m.tenBien
            }));
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
                    <button class="action-btn btn-edit" data-bf-action="call" data-fn="editWordMapping" data-args='["${v.id}"]' title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                        <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                    </button>
                    <button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteWordMapping" data-args='["${v.id}"]' title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
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
                        <button class="action-btn btn-edit" data-bf-action="call" data-fn="editWordMapping" data-args='["${v.id}"]' title="Sửa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
                            <i data-lucide="edit-2" style="width:12px; height:12px; color: var(--text-muted);"></i>
                        </button>
                        <button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteWordMapping" data-args='["${v.id}"]' title="Xóa ánh xạ" style="padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: none; cursor: pointer; display: inline-flex; align-items: center;">
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
            if (v.isComputed) {
                descHTML = `
                    <span class="badge badge-info" style="font-size:0.7rem; padding: 2px 6px;">Công thức</span>
                    <span style="color:var(--text-muted); margin:0 4px;">&rarr;</span>
                    <code style="font-size: 0.8rem;">${v.desc}</code>
                `;
            } else if (!v.sourceColumn || v.sourceColumn === '*') {
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
        <button type="button" class="btn-remove-member" data-bf-action="call" data-fn="removeJointVentureMemberCard" data-args='["${cardId}"]' style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 1.25rem; color: var(--danger); cursor: pointer;">&times;</button>
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
