import { authFetchDownload } from '../utils/workflow_helpers.js';
import { makeSearchableSelect } from '../utils/PartnerHelpers.js';

export function setupWordTemplatesEvents() {
    const templateInput = document.getElementById('word-file-input') || document.getElementById('word-template-file-input');
    if (templateInput) {
        templateInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleWordTemplateUpload(file);
        });
    }

    const dragDropZone = document.getElementById('word-drag-drop-zone');
    if (dragDropZone && templateInput) {
        dragDropZone.addEventListener('click', () => templateInput.click());
        dragDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dragDropZone.classList.add('dragover');
        });
        dragDropZone.addEventListener('dragleave', () => {
            dragDropZone.classList.remove('dragover');
        });
        dragDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) {
                templateInput.files = e.dataTransfer.files;
                this.handleWordTemplateUpload(file);
            }
        });
    }

    // Set up dictionary group select change event
    const dictionarySelect = document.getElementById('dictionary-group-select');
    if (dictionarySelect) {
        dictionarySelect.addEventListener('change', (e) => {
            const group = e.target.value;
            this.view.renderDictionary(group);
            this.setupCopyVariableEvents();
        });
    }

    // --- CUSTOM WORD MAPPINGS INTERACTIVE LOGIC ---
    const MAPPING_COLUMNS = {
        'chu_dau_tu': [
            { value: 'ma_chu_dau_tu', label: 'Mã chủ đầu tư' },
            { value: 'ten_chu_dau_tu', label: 'Tên chủ đầu tư' },
            { value: 'ma_so_thue', label: 'Mã số thuế' },
            { value: 'chuc_vu_nguoi_dung_dau', label: 'Chức vụ người đứng đầu' },
            { value: 'nguoi_ky_quyet_dinh', label: 'Đại diện CĐT' },
            { value: 'chuc_vu_dai_dien', label: 'Chức vụ người đại diện' },
            { value: 'danh_xung', label: 'Danh xưng' },
            { value: 'dia_chi', label: 'Địa chỉ đầy đủ' },
            { value: 'so_dien_thoai', label: 'Số điện thoại' },
            { value: 'so_tai_khoan', label: 'Số tài khoản' },
            { value: 'noi_mo_tai_khoan', label: 'Nơi mở tài khoản' },
            { value: 'email', label: 'Email' },
            { value: 'ma_qhns', label: 'Mã QHNS' },
            { value: 'co_quan_chu_quan', label: 'Cơ quan chủ quản' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'ke_hoach_lcnt': [
            { value: 'ma_ke_hoach', label: 'Mã kế hoạch LCNT' },
            { value: 'ma_du_an', label: 'Mã dự án' },
            { value: 'ten_ke_hoach', label: 'Tên kế hoạch LCNT' },
            { value: 'ten_du_an_du_toan', label: 'Tên dự án / Dự toán' },
            { value: 'loai_hinh_mua_sam', label: 'Loại hình mua sắm' },
            { value: 'tong_muc_dau_tu', label: 'Tổng mức đầu tư' },
            { value: 'is_tong_muc_tu_dong', label: 'Tự động tính tổng mức (0/1)' },
            { value: 'ngay_phe_duyet', label: 'Ngày phê duyệt' },
            { value: 'quyet_dinh_phe_duyet', label: 'QĐ phê duyệt' },
            { value: 'thoi_gian_dang_tai', label: 'Thời gian đăng tải' },
            { value: 'nguon_von', label: 'Nguồn vốn' },
            { value: 'thoi_gian_du_an', label: 'Thời gian dự án' },
            { value: 'dia_diem_quy_mo', label: 'Địa điểm quy mô' },
            { value: 'thong_tin_khac', label: 'Thông tin khác' },
            { value: 'so_qd_phe_duyet_du_an', label: 'Số QĐ phê duyệt dự án' },
            { value: 'ngay_qd_phe_duyet_du_an', label: 'Ngày QĐ phê duyệt dự án' },
            { value: 'co_quan_phe_duyet_du_an', label: 'Cơ quan phê duyệt dự án' },
            { value: 'phe_duyet', label: 'Người phê duyệt' },
            { value: 'ngay_trinh_du_toan', label: 'Ngày trình dự toán' },
            { value: 'ngay_phe_duyet_du_toan', label: 'Ngày phê duyệt dự toán' },
            { value: 'so_qd_phe_duyet_du_toan', label: 'Số QĐ phê duyệt dự toán' },
            { value: 'ngay_trinh_ke_hoach', label: 'Ngày trình kế hoạch LCNT' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'goi_thau': [
            { value: 'ma_goi_thau', label: 'Mã gói thầu (Mã TBMT)' },
            { value: 'ten_goi_thau', label: 'Tên gói thầu' },
            { value: 'gia_goi_thau', label: 'Giá dự toán gói thầu' },
            { value: 'hinh_thuc_lua_chon', label: 'Hình thức LCNT' },
            { value: 'phuong_thuc_lua_chon', label: 'Phương thức LCNT' },
            { value: 'loai_hop_dong', label: 'Loại hợp đồng' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'nguon_von', label: 'Nguồn vốn' },
            { value: 'gia_trung_thau', label: 'Giá trúng thầu' },
            { value: 'linh_vuc', label: 'Lĩnh vực' },
            { value: 'tuy_chon_mua_them', label: 'Tùy chọn mua thêm' },
            { value: 'thoi_gian_to_chuc', label: 'Thời gian tổ chức' },
            { value: 'thoi_gian_bat_dau_to_chuc', label: 'Thời gian bắt đầu tổ chức' },
            { value: 'phan_lo', label: 'Phân lô' },
            { value: 'thoi_gian_dang_tai', label: 'Thời gian đăng tải' },
            { value: 'thoi_gian_dong_thau', label: 'Thời gian đóng thầu' },
            { value: 'thoi_gian_mo_thau', label: 'Thời gian mở thầu' },
            { value: 'so_quyet_dinh', label: 'Số QĐ phê duyệt' },
            { value: 'ngay_quyet_dinh', label: 'Ngày QĐ phê duyệt' },
            { value: 'so_quyet_dinh_ket_qua', label: 'Số QĐ kết quả' },
            { value: 'ngay_quyet_dinh_ket_qua', label: 'Ngày QĐ kết quả / Ngày phê duyệt kết quả' },
            { value: 'thoi_gian_goi_thau', label: 'Thời gian gói thầu' },
            { value: 'thoi_gian_hop_dong', label: 'Thời gian hợp đồng' },
            { value: 'gia_tri_dam_bao_du_thau', label: 'Giá trị bảo đảm dự thầu' },
            { value: 'hieu_luc_hsdt', label: 'Hiệu lực HSDT' },
            { value: 'hieu_luc_dam_bao_du_thau', label: 'Hiệu lực bảo đảm dự thầu' },
            { value: 'gia_han_list', label: 'Gia hạn thời gian mở thầu / đóng thầu' },
            { value: 'yeu_cau_lam_ro_list', label: 'Làm rõ hồ sơ mời thầu (Yêu cầu)' },
            { value: 'tra_loi_lam_ro_list', label: 'Trả lời làm rõ hồ sơ mời thầu' },
            { value: 'danh_gia_nang_luc', label: 'Đánh giá năng lực nhà thầu (Có/Không)' },
            { value: 'ngay_yeu_cau_bao_gia', label: 'Ngày yêu cầu báo giá' },
            { value: 'ngay_gui_bao_gia', label: 'Ngày gửi báo giá' },
            { value: 'ngay_bao_cao_danh_gia_nha_thau', label: 'Ngày báo cáo đánh giá nhà thầu' },
            { value: 'ngay_moi_thuong_thao', label: 'Ngày mời thương thảo' },
            { value: 'ngay_thuong_thao', label: 'Ngày thương thảo' },
            { value: 'ngay_trinh_ket_qua', label: 'Ngày trình kết quả' },
            { value: 'so_to_trinh_hsmt', label: 'Số tờ trình HSMT' },
            { value: 'ngay_trinh_hsmt', label: 'Ngày trình HSMT' },
            { value: 'yeu_cau_tham_dinh_hsmt', label: 'Yêu cầu thẩm định HSMT (Có/Không)' },
            { value: 'so_bao_cao_tham_dinh_hsmt', label: 'Số báo cáo thẩm định HSMT' },
            { value: 'ngay_bao_cao_tham_dinh_hsmt', label: 'Ngày báo cáo thẩm định HSMT' },
            { value: 'trang_thai', label: 'Trạng thái' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'nha_thau': [
            { value: 'ma_nha_thau', label: 'Mã nhà thầu' },
            { value: 'ten_nha_thau', label: 'Tên nhà thầu' },
            { value: 'loai_nha_thau', label: 'Loại nhà thầu (Độc lập/Liên danh)' },
            { value: 'ma_so_thue', label: 'Mã số thuế' },
            { value: 'nguoi_dai_dien', label: 'Người đại diện' },
            { value: 'danh_xung', label: 'Danh xưng' },
            { value: 'so_dien_thoai', label: 'Số điện thoại' },
            { value: 'email', label: 'Email' },
            { value: 'dia_chi', label: 'Địa chỉ' },
            { value: 'so_tai_khoan', label: 'Số tài khoản' },
            { value: 'noi_mo_tai_khoan', label: 'Nơi mở tài khoản' },
            { value: 'ma_ngan_hang', label: 'Mã ngân hàng' },
            { value: 'phien_ban', label: 'Phiên bản' }
        ],
        'hop_dong': [
            { value: 'ten_hop_dong', label: 'Tên hợp đồng' },
            { value: 'so_hop_dong', label: 'Số hợp đồng' },
            { value: 'ngay_ky', label: 'Ngày ký' },
            { value: 'gia_tri', label: 'Giá trị hợp đồng' },
            { value: 'loai_hop_dong', label: 'Loại hợp đồng' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'trang_thai_ho_so', label: 'Trạng thái hồ sơ' },
            { value: 'phan_loai', label: 'Phân loại (Tư vấn/Thẩm định)' },
            { value: 'co_qd_chi_dinh', label: 'Có QĐ chỉ định thầu không (0/1)' },
            { value: 'so_qd_chi_dinh', label: 'Số QĐ chỉ định' },
            { value: 'ngay_qd_chi_dinh', label: 'Ngày QĐ chỉ định' }
        ],
        'chuyen_gia': [
            { value: 'ho_ten', label: 'Họ tên chuyên gia' },
            { value: 'so_cccd', label: 'Số CCCD' },
            { value: 'ngay_cap_cccd', label: 'Ngày cấp CCCD' },
            { value: 'noi_cap_cccd', label: 'Nơi cấp CCCD' },
            { value: 'so_chung_chi', label: 'Số chứng chỉ' },
            { value: 'ngay_cap_chung_chi', label: 'Ngày cấp chứng chỉ' },
            { value: 'don_vi_cap_chung_chi', label: 'Đơn vị cấp chứng chỉ' },
            { value: 'chuc_vu', label: 'Chức vụ trong tổ' },
            { value: 'cong_viec', label: 'Nhiệm vụ phân công' }
        ],
        'thong_tin_mo_thau': [
            { value: 'ma_phan_lo', label: 'Mã phân lô' },
            { value: 'ten_phan_lo', label: 'Tên phân lô' },
            { value: 'ma_dinh_danh', label: 'Mã định danh' },
            { value: 'gia_du_thau', label: 'Giá dự thầu' },
            { value: 'dam_bao_du_thau', label: 'Bảo đảm dự thầu' },
            { value: 'hieu_luc_dam_bao', label: 'Hiệu lực bảo đảm' },
            { value: 'hieu_luc_hsdxt', label: 'Hiệu lực HSDXT' },
            { value: 'ty_le_giam_gia', label: 'Tỷ lệ giảm giá' },
            { value: 'gia_sau_giam_gia', label: 'Giá sau giảm giá' },
            { value: 'hieu_luc_hsdt', label: 'Hiệu lực HSDT' },
            { value: 'gia_tri_dam_bao', label: 'Giá trị bảo đảm' },
            { value: 'hieu_luc_bao_dam_ngay', label: 'Hiệu lực bảo đảm (ngày)' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện' },
            { value: 'ten_nha_thau', label: 'Tên nhà thầu' },
            { value: 'loai_nha_thau', label: 'Loại nhà thầu' },
            { value: 'danh_gia_hop_le', label: 'Đánh giá hợp lệ' },
            { value: 'danh_gia_nang_luc', label: 'Đánh giá năng lực' },
            { value: 'danh_gia_ky_thuat', label: 'Đánh giá kỹ thuật' },
            { value: 'danh_gia_tai_chinh', label: 'Đánh giá tài chính' },
            { value: 'danh_gia_ket_luan', label: 'Đánh giá kết luận' },
            { value: 'ly_do_truot', label: 'Lý do trượt' },
            { value: 'lam_ro_hop_le', label: 'Làm rõ hợp lệ' },
            { value: 'lam_ro_nang_luc', label: 'Làm rõ năng lực' },
            { value: 'lam_ro_ky_thuat', label: 'Làm rõ kỹ thuật' },
            { value: 'lam_ro_tai_chinh', label: 'Làm rõ tài chính' }
        ],
        'tai_khoan': [
            { value: 'ten_dang_nhap', label: 'Tên đăng nhập' },
            { value: 'ho_ten', label: 'Họ tên người dùng' },
            { value: 'vai_tro', label: 'Vai trò tài khoản' },
            { value: 'email', label: 'Email tài khoản' },
            { value: 'ngay_bat_dau_goi', label: 'Ngày bắt đầu gói' },
            { value: 'ngay_het_han_goi', label: 'Ngày hết hạn gói' },
            { value: 'da_xac_minh', label: 'Đã xác minh (0/1)' }
        ],
        'to_chuc': [
            { value: 'ten_to_chuc', label: 'Tên tổ chức / Doanh nghiệp' }
        ],
        'goi_dich_vu': [
            { value: 'ten_goi', label: 'Tên gói dịch vụ' },
            { value: 'gia_ca', label: 'Giá gói dịch vụ' },
            { value: 'han_muc_nhan_su', label: 'Hạn mức nhân sự tối đa' },
            { value: 'mo_ta', label: 'Mô tả chi tiết gói' }
        ],
        'yeu_cau_lam_ro': [
            { value: 'thoi_gian_yeu_cau', label: 'Thời gian yêu cầu làm rõ' },
            { value: 'noi_dung_yeu_cau', label: 'Nội dung yêu cầu làm rõ' }
        ],
        'tra_loi_lam_ro': [
            { value: 'thoi_gian_tra_loi', label: 'Thời gian trả lời làm rõ' },
            { value: 'noi_dung_tra_loi', label: 'Nội dung trả lời làm rõ' }
        ],
        'phan_lo': [
            { value: 'ma_phan_lo', label: 'Mã phân lô' },
            { value: 'ten_phan_lo', label: 'Tên phân lô' },
            { value: 'gia_tri_phan_lo', label: 'Giá trị phân lô' },
            { value: 'nha_thau_trung', label: 'Nhà thầu trúng thầu phân lô' },
            { value: 'thoi_gian_thuc_hien', label: 'Thời gian thực hiện phân lô' }
        ],
        'tuy_chon_mua_them': [
            { value: 'hang_muc', label: 'Hạng mục mua thêm' },
            { value: 'don_vi', label: 'Đơn vị tính mua thêm' },
            { value: 'so_luong', label: 'Số lượng mua thêm' },
            { value: 'ty_le', label: 'Tỷ lệ mua thêm' },
            { value: 'gia_tri_uoc_tinh', label: 'Giá trị ước tính mua thêm' }
        ],
        'gia_han': [
            { value: 'thoi_gian_truoc', label: 'Thời gian trước gia hạn' },
            { value: 'thoi_gian_sau', label: 'Thời gian sau gia hạn' },
            { value: 'ngay_gia_han', label: 'Ngày quyết định gia hạn' },
            { value: 'ly_do', label: 'Lý do gia hạn' }
        ],
        'thanh_vien_lien_danh': [
            { value: 'ten_tv', label: 'Tên thành viên' },
            { value: 'mst_tv', label: 'Mã số thuế thành viên' },
            { value: 'vai_tro_tv', label: 'Vai trò thành viên' },
            { value: 'nguoi_dai_dien_tv', label: 'Người đại diện thành viên' },
            { value: 'dia_chi_tv', label: 'Địa chỉ thành viên' },
            { value: 'so_tai_khoan_tv', label: 'Số tài khoản thành viên' },
            { value: 'noi_mo_tai_khoan_tv', label: 'Nơi mở tài khoản thành viên' }
        ],
        'cv_da_thuc_hien': [
            { value: 'ten_cong_viec', label: 'Tên công việc' },
            { value: 'gia_tri', label: 'Giá trị công việc' },
            { value: 'don_vi_thuc_hien', label: 'Đơn vị thực hiện' },
            { value: 'van_ban_phe_duyet', label: 'Văn bản phê duyệt' }
        ],
        'cv_khong_ap_dung': [
            { value: 'ten_cong_viec', label: 'Tên công việc' },
            { value: 'gia_tri', label: 'Giá trị công việc' },
            { value: 'don_vi_thuc_hien', label: 'Đơn vị thực hiện' }
        ],
        'cv_chua_du_dieu_kien': [
            { value: 'ten_cong_viec', label: 'Tên công việc' },
            { value: 'gia_tri', label: 'Giá trị công việc' }
        ]
    };

    const tableSelect = document.getElementById('wm-source-table');
    const columnSelect = document.getElementById('wm-source-column');
    const formWm = document.getElementById('form-word-mapping');
    const cancelWmBtn = document.getElementById('btn-wm-cancel');

    const formWml = document.getElementById('form-word-list-mapping');
    const cancelWmlBtn = document.getElementById('btn-wml-cancel');
    const wmlTableSelect = document.getElementById('wml-source-table');

    if (tableSelect) makeSearchableSelect(tableSelect, 'Tìm kiếm thực thể...');
    if (columnSelect) makeSearchableSelect(columnSelect, 'Chọn hoặc tìm kiếm trường thông tin...');
    if (wmlTableSelect) makeSearchableSelect(wmlTableSelect, 'Tìm kiếm danh sách...');

    const checkExistingMapping = () => {
        const table = tableSelect?.value;
        const column = columnSelect?.value;
        const statusDiv = document.getElementById('wm-mapping-status');
        const inputVar = document.getElementById('wm-ten-bien');
        if (!statusDiv) return;

        if (!table || !column) {
            statusDiv.style.display = 'none';
            return;
        }

        const mappings = this.model.state?.wordMappings || [];
        const match = mappings.find(m => m.sourceTable === table && m.sourceColumn === column);

        statusDiv.style.display = 'block';
        if (match) {
            statusDiv.innerHTML = `Trạng thái ánh xạ: <span class="badge badge-success" style="background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Đã có {${match.tenBien}}</span>`;
            if (inputVar && !document.getElementById('wm-id').value) {
                inputVar.value = match.tenBien;
            }
        } else {
            statusDiv.innerHTML = `Trạng thái ánh xạ: <span class="badge badge-warning" style="background:var(--warning); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Chưa có</span>`;
        }
    };

    const checkExistingListMapping = () => {
        const table = wmlTableSelect?.value;
        const statusDiv = document.getElementById('wml-mapping-status');
        const inputVar = document.getElementById('wml-ten-bien');
        if (!statusDiv) return;

        if (!table) {
            statusDiv.style.display = 'none';
            return;
        }

        const mappings = this.model.state?.wordMappings || [];
        const match = mappings.find(m => m.sourceTable === table && (!m.sourceColumn || m.sourceColumn === '*'));

        statusDiv.style.display = 'block';
        if (match) {
            statusDiv.innerHTML = `Trạng thái ánh xạ: <span class="badge badge-success" style="background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Đã có {#${match.tenBien}}</span>`;
            if (inputVar && !document.getElementById('wml-id').value) {
                inputVar.value = match.tenBien;
            }
        } else {
            statusDiv.innerHTML = `Trạng thái ánh xạ: <span class="badge badge-warning" style="background:var(--warning); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">Chưa có</span>`;
        }
    };

    if (tableSelect && columnSelect) {
        tableSelect.addEventListener('change', (e) => {
            const table = e.target.value;
            columnSelect.innerHTML = '<option value="">-- Chọn cột --</option>';
            if (table && MAPPING_COLUMNS[table]) {
                columnSelect.disabled = false;
                MAPPING_COLUMNS[table].forEach(col => {
                    const opt = document.createElement('option');
                    opt.value = col.value;
                    opt.textContent = col.label;
                    columnSelect.appendChild(opt);
                });
            } else {
                columnSelect.disabled = true;
            }
            checkExistingMapping();
            
            // Automatically switch dictionary view to global (single variables) and update filter
            const dictionarySelect = document.getElementById('dictionary-group-select');
            if (dictionarySelect) {
                dictionarySelect.value = 'global';
            }
            if (this.view && this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable();
            }
            this.setupCopyVariableEvents();
        });

        columnSelect.addEventListener('change', () => {
            checkExistingMapping();
            const dictionarySelect = document.getElementById('dictionary-group-select');
            if (dictionarySelect) {
                dictionarySelect.value = 'global';
            }
            if (this.view && this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable();
            }
            this.setupCopyVariableEvents();
        });
    }

    if (wmlTableSelect) {
        wmlTableSelect.addEventListener('change', () => {
            checkExistingListMapping();
            // Automatically switch dictionary view to custom_lists (list variables) and update filter
            const dictionarySelect = document.getElementById('dictionary-group-select');
            if (dictionarySelect) {
                dictionarySelect.value = 'custom_lists';
            }
            if (this.view && this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable();
            }
            this.setupCopyVariableEvents();
        });
    }

    const resetWmForm = () => {
        if (formWm) {
            formWm.reset();
            document.getElementById('wm-id').value = '';
            if (columnSelect) columnSelect.disabled = true;
            if (cancelWmBtn) cancelWmBtn.style.display = 'none';
            const statusDiv = document.getElementById('wm-mapping-status');
            if (statusDiv) statusDiv.style.display = 'none';
            const submitBtn = formWm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Lưu biến';
                lucide.createIcons({ root: submitBtn });
            }
            if (this.view && this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable();
            }
            this.setupCopyVariableEvents();
        }
    };

    const resetWmlForm = () => {
        if (formWml) {
            formWml.reset();
            document.getElementById('wml-id').value = '';
            if (cancelWmlBtn) cancelWmlBtn.style.display = 'none';
            const statusDiv = document.getElementById('wml-mapping-status');
            if (statusDiv) statusDiv.style.display = 'none';
            const submitBtn = formWml.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Lưu danh sách';
                lucide.createIcons({ root: submitBtn });
            }
            if (this.view && this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable();
            }
            this.setupCopyVariableEvents();
        }
    };

    if (cancelWmBtn) {
        cancelWmBtn.addEventListener('click', resetWmForm);
    }
    if (cancelWmlBtn) {
        cancelWmlBtn.addEventListener('click', resetWmlForm);
    }

    if (formWm) {
        formWm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('wm-id').value;
            const tenBien = document.getElementById('wm-ten-bien').value.trim();
            const sourceTable = tableSelect.value;
            const sourceColumn = columnSelect.value;

            if (!tenBien || !sourceTable || !sourceColumn) return;

            // Check for duplicate variable name
            const duplicate = (this.model.state.wordMappings || []).find(m => m.tenBien.toLowerCase() === tenBien.toLowerCase() && m.id !== id);
            if (duplicate) {
                const tableNames = {
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
                const labelTable = tableNames[duplicate.sourceTable] || duplicate.sourceTable;
                const isList = !duplicate.sourceColumn || duplicate.sourceColumn === '*';
                const labelColumn = isList ? 'Biến danh sách (Vòng lặp)' : (duplicate.sourceColumn);
                await this.view.customAlert('Trùng tên biến', `Tên biến <strong>{${tenBien}}</strong> đã trùng với biến ánh xạ của:<br><strong>Bảng: ${labelTable} &rarr; Cột: ${labelColumn}</strong>.`, 'alert-triangle');
                return;
            }

            try {
                const res = await fetch('/api/word-mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, tenBien, sourceTable, sourceColumn })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    resetWmForm();
                    await this.loadWordMappings();
                    if (this.view.customAlert) {
                        await this.view.customAlert('Thành công', 'Đã lưu biến ánh xạ thành công!', 'check-circle');
                    }
                } else {
                    await this.view.customAlert('Lỗi lưu biến', data.error || 'Lỗi khi lưu biến ánh xạ.', 'x-circle');
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi kết nối', 'Không thể kết nối máy chủ.', 'x-circle');
            }
        });
    }

    if (formWml) {
        formWml.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('wml-id').value;
            const tenBien = document.getElementById('wml-ten-bien').value.trim();
            const sourceTable = document.getElementById('wml-source-table').value;
            const sourceColumn = ""; // Empty indicates a list mapping

            if (!tenBien || !sourceTable) return;

            // Check for duplicate variable name
            const duplicate = (this.model.state.wordMappings || []).find(m => m.tenBien.toLowerCase() === tenBien.toLowerCase() && m.id !== id);
            if (duplicate) {
                const tableNames = {
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
                const labelTable = tableNames[duplicate.sourceTable] || duplicate.sourceTable;
                const isList = !duplicate.sourceColumn || duplicate.sourceColumn === '*';
                const labelColumn = isList ? 'Biến danh sách (Vòng lặp)' : (duplicate.sourceColumn);
                await this.view.customAlert('Trùng tên biến', `Tên biến <strong>{#${tenBien}}</strong> đã trùng với biến ánh xạ của:<br><strong>Bảng: ${labelTable} &rarr; Cột: ${labelColumn}</strong>.`, 'alert-triangle');
                return;
            }

            try {
                const res = await fetch('/api/word-mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, tenBien, sourceTable, sourceColumn })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    resetWmlForm();
                    await this.loadWordMappings();
                    if (this.view.customAlert) {
                        await this.view.customAlert('Thành công', 'Đã lưu cấu hình biến danh sách thành công!', 'check-circle');
                    }
                } else {
                    await this.view.customAlert('Lỗi lưu danh sách', data.error || 'Lỗi khi lưu biến danh sách.', 'x-circle');
                }
            } catch (err) {
                console.error(err);
                await this.view.customAlert('Lỗi kết nối', 'Không thể kết nối máy chủ.', 'x-circle');
            }
        });
    }

    // Register global edit/delete handlers on window for HTML onclick compatibility
    window.editWordMapping = (id) => {
        const m = (this.model.state.wordMappings || []).find(x => x.id === id);
        if (!m) return;

        // Check if it is a list mapping
        if (!m.sourceColumn || m.sourceColumn === '*') {
            document.getElementById('wml-id').value = m.id;
            document.getElementById('wml-ten-bien').value = m.tenBien;
            document.getElementById('wml-source-table').value = m.sourceTable;
            if (wmlTableSelect) wmlTableSelect.dispatchEvent(new Event('change'));
            if (cancelWmlBtn) cancelWmlBtn.style.display = 'inline-block';
            
            const submitBtn = formWml.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Cập nhật';
                lucide.createIcons({ root: submitBtn });
            }
            return;
        }

        document.getElementById('wm-id').value = m.id;
        document.getElementById('wm-ten-bien').value = m.tenBien;

        tableSelect.value = m.sourceTable;
        tableSelect.dispatchEvent(new Event('change'));

        columnSelect.value = m.sourceColumn;
        columnSelect.dispatchEvent(new Event('change'));

        if (cancelWmBtn) cancelWmBtn.style.display = 'inline-block';

        const submitBtn = formWm.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i> Cập nhật';
            lucide.createIcons({ root: submitBtn });
        }
    };

    window.deleteWordMapping = async (id) => {
        const confirmed = await this.view.customConfirm('Xác nhận xóa', 'Bạn có chắc chắn muốn xóa biến ánh xạ này không?', 'trash-2');
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/word-mappings/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                await this.loadWordMappings();
                if (this.view.customAlert) {
                    await this.view.customAlert('Thành công', 'Đã xóa biến ánh xạ thành công!', 'check-circle');
                }
            } else {
                const data = await res.json();
                await this.view.customAlert('Lỗi xóa', data.error || 'Có lỗi xảy ra khi xóa biến ánh xạ.', 'x-circle');
            }
        } catch (err) {
            console.error(err);
        }
    };
}


export function setupCopyVariableEvents() {
    document.querySelectorAll('.btn-copy-var, .copy-var-btn').forEach(btn => {
        btn.onclick = (e) => {
            const button = e.target.closest('button');
            const text = button.getAttribute('data-copy') || button.getAttribute('data-var');
            if (text) {
                navigator.clipboard.writeText(text).then(() => {
                    if (this.view.customAlert) {
                        this.view.customAlert('Sao chép thành công', `Đã sao chép mã biến: <strong>${text}</strong>`, 'check-circle');
                    } else {
                        // Show inline toast instead of blocking alert
                        const btn = document.querySelector(`.btn-copy-var[data-copy="${text}"]`);
                        if (btn) {
                            const orig = btn.innerHTML;
                            btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i> Đã sao chép!';
                            btn.style.color = 'var(--success)';
                            lucide.createIcons({ root: btn });
                            setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; lucide.createIcons({ root: btn }); }, 1500);
                        }
                    }
                });
            }
        };
    });
}


export async function loadWordTemplates() {
    try {
        const res = await fetch('/api/templates');
        if (res.ok) {
            const templates = await res.json();
            this.view.renderWordTemplates(templates);
            this.setupTemplateActivationEvents();
        }
        // Load the custom mappings concurrently
        await this.loadWordMappings();
    } catch (err) {
        console.error("Failed to load templates:", err);
    }
}


export async function loadWordMappings() {
    try {
        const res = await fetch('/api/word-mappings');
        if (res.ok) {
            const mappings = await res.json();
            if (!this.model.state) this.model.state = {};
            this.model.state.wordMappings = mappings;

            // Render the mappings list table
            if (this.view.renderWordMappingsTable) {
                this.view.renderWordMappingsTable(mappings);
            }

            // Re-render the dictionary to include the custom mappings
            const dictionarySelect = document.getElementById('dictionary-group-select');
            const group = dictionarySelect ? dictionarySelect.value : 'global';
            this.view.renderDictionary(group);
            this.setupCopyVariableEvents();
        }
    } catch (err) {
        console.error("Failed to load word mappings:", err);
    }
}


export function setupTemplateActivationEvents() {
    document.querySelectorAll('.btn-activate-template').forEach(btn => {
        btn.onclick = async (e) => {
            const targetEl = e.target.closest('.btn-activate-template');
            if (!targetEl) return;
            const filename = targetEl.getAttribute('data-filename');
            try {
                const res = await fetch('/api/templates/active', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                });
                if (res.ok) {
                    await this.loadWordTemplates();
                }
            } catch (err) {
                console.error("Failed to set active template:", err);
            }
        };
    });
}


export async function handleWordTemplateUpload(file) {
    if (!file.name.endsWith('.docx')) {
        await this.view.customAlert('Lỗi định dạng', 'Hệ thống chỉ hỗ trợ biểu mẫu tệp tin Microsoft Word (.docx)!', 'alert-triangle');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/templates/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            await this.view.customAlert('Thành công', 'Đã tải lên biểu mẫu QĐ phê duyệt thành công!', 'check-circle');
            await this.loadWordTemplates();
        } else {
            await this.view.customAlert('Thất bại', data.error || 'Không thể tải lên biểu mẫu này.', 'alert-triangle');
        }
    } catch (err) {
        await this.view.customAlert('Lỗi hệ thống', 'Lỗi kết nối máy chủ: ' + err.message, 'alert-triangle');
    }
}
