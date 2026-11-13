import re
# -*- coding: utf-8 -*-
"""Mapping from the ND30 template placeholders ([[...]]) to BiddingFlow Word variables."""

# ---------------------------------------------------------------- folders
PLAN_FOLDERS = {'1. KHLCNT Chung', '2. KHLCNT Rieng', '11. KHLCNT CĐT Chung', '12. KHLCNT CĐT Rieng'}
KQCD_FOLDERS = {'10. KQCĐ KXN', '11. KQCĐ CXN'}
LOT_FOLDERS = {'8. BCĐG PLQT1', '8. BCĐG PLQT2', '9. KQLCNT PL'}

# ---------------------------------------------------------------- root (scalar) fields
# name -> (alias, native path, format)   format: text | date | datetime | money
CDT = 'chu_dau_tu.'
KH = 'ke_hoach.'
GT = 'goi_thau.'
ROOT = {
    # Chủ đầu tư
    'Tên CĐT': ('ten_cdt', CDT + 'ten_chu_dau_tu', 'text'),
    'Tên CĐT KHLCNT': ('ten_cdt', CDT + 'ten_chu_dau_tu', 'text'),
    'Cơ quan ký QĐKHLCNT': ('ten_cdt', CDT + 'ten_chu_dau_tu', 'text'),
    'Chủ quản CĐT': ('cq_chu_quan', CDT + 'co_quan_chu_quan', 'text'),
    'Mã số thuế CĐT': ('mst_cdt', CDT + 'ma_so_thue', 'text'),
    'Ký QĐ': ('chuc_vu_nguoi_dung_dau_cdt', CDT + 'chuc_vu_nguoi_dung_dau', 'text'),
    'Chức vụ': ('chuc_vu_dai_dien_cdt', CDT + 'chuc_vu_dai_dien', 'text'),
    'Đại diện': ('dai_dien_cdt', CDT + 'dai_dien_cdt', 'text'),
    'Danh xưng': ('danh_xung_cdt', CDT + 'danh_xung', 'text'),
    'Địa chỉ': ('dia_chi_cdt', CDT + 'dia_chi', 'text'),
    'Điện thoại': ('sdt_cdt', CDT + 'so_dien_thoai', 'text'),
    'Tài khoản': ('stk_cdt', CDT + 'so_tai_khoan', 'text'),
    'Ngân hàng': ('noi_mo_tk_cdt', CDT + 'noi_mo_tai_khoan', 'text'),
    'Đơn vị trình của CĐT': ('don_vi_trinh_cdt', KH + 'don_vi_trinh_cdt', 'text'),
    'Đơn vị trình kế hoạch': ('don_vi_trinh_cdt', KH + 'don_vi_trinh_cdt', 'text'),
    # Kế hoạch LCNT / dự toán
    'Tên KHLCNT': ('ten_kh', KH + 'ten_ke_hoach', 'text'),
    'Tên dự toán/dự án': ('ten_du_an_du_toan', KH + 'ten_du_an_du_toan', 'text'),
    'Mã KHLCNT': ('ma_kh', KH + 'ma_ke_hoach', 'text'),
    'Ngày đăng KHLCNT': ('tg_dang_tai_kh', KH + 'thoi_gian_dang_tai', 'datetime'),
    'Số QĐPDKH': ('qd_phe_duyet_kh', KH + 'quyet_dinh_phe_duyet', 'text'),
    'Ngày PDKH': ('ngay_phe_duyet_kh', KH + 'ngay_phe_duyet', 'date'),
    'Giá trị TMĐT': ('tong_muc_dau_tu_du_toan', KH + 'tong_muc_dau_tu', 'money'),
    'Ngày trình KH': ('ngay_trinh_kh', KH + 'ngay_trinh_ke_hoach', 'date'),
    'Ngày trình DT': ('ngay_trinh_du_toan', KH + 'ngay_trinh_du_toan', 'date'),
    'Ngày phê duyệt DT': ('ngay_phe_duyet_du_toan', KH + 'ngay_phe_duyet_du_toan', 'date'),
    'Số QĐ DT': ('so_qd_du_toan', KH + 'so_qd_phe_duyet_du_toan', 'text'),
    # Gói thầu
    'Tên gói thầu': ('ten_gt', GT + 'ten_goi_thau', 'text'),
    'Số TBMT': ('ma_gt', GT + 'ma_goi_thau', 'text'),
    ' Thời gian đăng TBMT': ('tg_dang_tai_tbmt', GT + 'thoi_gian_dang_tai', 'datetime'),
    'Giá gói thầu': ('gia_gt', GT + 'gia_goi_thau', 'money'),
    'Giá trị gói thầu': ('gia_gt', GT + 'gia_goi_thau', 'money'),
    'Bằng chữ Giá gói thầu KHLCNT': ('bangchu_gia_gt', GT + 'bangchu_gia_goi_thau', 'text'),
    'Hình thức': ('hinh_thuc_lcnt', GT + 'hinh_thuc_lua_chon', 'text'),
    'Phương thức': ('phuong_thuc_lcnt', GT + 'phuong_thuc_lua_chon', 'text'),
    'Loại hợp đồng': ('loai_hd_gt', GT + 'loai_hop_dong', 'text'),
    'Thời gian thực hiện': ('tg_thuc_hien_gt', GT + 'thoi_gian_thuc_hien', 'text'),
    'Tiến độ': ('tg_thuc_hien_gt', GT + 'thoi_gian_thuc_hien', 'text'),
    'Thời gian tổ chức': ('tg_to_chuc_lcnt', GT + 'thoi_gian_to_chuc', 'text'),
    'Thời gian bắt đầu': ('tg_bat_dau_lcnt', GT + 'thoi_gian_bat_dau_to_chuc', 'text'),
    'Thời gian thực hiện HĐ': ('tg_hop_dong', GT + 'thoi_gian_hop_dong', 'text'),
    'Số QĐ E-HSMT': ('so_qd_hsmt', GT + 'so_quyet_dinh', 'text'),
    'Ngày QĐ E-HSMT': ('ngay_qd_hsmt', GT + 'ngay_quyet_dinh', 'date'),
    'Số QĐ KQ': ('so_qd_kq', GT + 'so_quyet_dinh_ket_qua', 'text'),
    'Số QĐ kết quả': ('so_qd_kq', GT + 'so_quyet_dinh_ket_qua', 'text'),
    'Ngày phê duyệt KQ': ('ngay_qd_kq', GT + 'ngay_quyet_dinh_ket_qua', 'date'),
    'Số thẩm định E-HSMT': ('so_bc_tham_dinh_hsmt', GT + 'so_bao_cao_tham_dinh_hsmt', 'text'),
    'Ngày thẩm định E-HSMT': ('ngay_bc_tham_dinh_hsmt', GT + 'ngay_bao_cao_tham_dinh_hsmt', 'date'),
    'Số tờ trình HSMT': ('so_ttr_hsmt', GT + 'so_to_trinh_hsmt', 'text'),
    'Ngày trình E-HSMT': ('ngay_trinh_hsmt', GT + 'ngay_trinh_hsmt', 'date'),
    'Đóng thầu': ('tg_dong_thau', GT + 'thoi_gian_dong_thau', 'datetime'),
    'Ngày đóng thầu': ('tg_dong_thau', GT + 'thoi_gian_dong_thau', 'datetime'),
    'Mở thầu': ('tg_mo_thau', GT + 'thoi_gian_mo_thau', 'datetime'),
    # ngay_doi_chieu / ngay_moi_doi_chieu are mapped as text in BiddingFlow (no S_ alias allowed)
    'Ngày đối chiếu': ('ngay_doi_chieu', GT + 'ngay_doi_chieu', 'textdate'),
    'Ngày thương thảo': ('ngay_doi_chieu', GT + 'ngay_doi_chieu', 'textdate'),
    'Ngày thư mời ĐCTL': ('ngay_moi_doi_chieu', GT + 'ngay_moi_doi_chieu', 'textdate'),
    'Ngày thư mời thương thảo': ('ngay_moi_doi_chieu', GT + 'ngay_moi_doi_chieu', 'textdate'),
}
# placeholders whose short form (S_) is requested by the template name itself
FORCE_SHORT = {'Đóng thầuS': 'Đóng thầu', 'Ngày đóng thầu': 'Ngày đóng thầu'}
# H-suffix = upper case: base name -> rendered with <w:caps/>
CAPS = {
    'Tên CĐTH': 'Tên CĐT', 'TÊN CĐTH': 'Tên CĐT', 'Chủ quản CĐTH': 'Chủ quản CĐT',
    'Ký QĐH': 'Ký QĐ', 'Chức vụH': 'Chức vụ', 'Đơn vị trình của CĐTH': 'Đơn vị trình của CĐT',
    'Phương thứcH': 'Phương thức', 'Tên nhà thầuH': 'Tên nhà thầu',
    'Tư vấn lậpH': 'Tư vấn lập', 'Tư vấn thẩmH': 'Tư vấn thẩm',
    'Chức vụ TVLH': 'Chức vụ TVL', 'Chức vụ TVTH': 'Chức vụ TVT',
}

# year placeholders -> current year (BiddingFlow does not allow nam_* aliases as root keys)
YEAR = {'Năm', 'Năm BCĐG', 'Năm HSMT', 'Năm BCTĐ HSMT', 'Năm BCTĐ KQLCNT', 'Năm TĐKT'}
YEAR_EXPR = '{{ current_time[0] }}{{ current_time[1] }}{{ current_time[2] }}{{ current_time[3] }}'

# Nhà thầu fields used as single values (KQCĐ folders: one contractor)
NT_ROOT = {
    'Tên nhà thầu': ('ten_nt', 'text'), 'Chức vụ NT': ('chuc_vu_dai_dien_nt', 'text'),
    'Danh xưng NT': ('danh_xung_nt', 'text'), 'Đại diện NT': ('dai_dien_nt', 'text'),
    'Địa chỉ NT': ('dia_chi_nt', 'text'), 'Điện thoại NT': ('sdt_nt', 'text'),
    'Mã số thuế NT': ('mst_nt', 'text'), 'Tài khoản NT': ('stk_nt', 'text'),
    'Ngân hàng NT': ('noi_mo_tk_nt', 'text'),
}

# "...KHLCNT" fields: package rows of the plan (plan folders) / the package itself elsewhere
PKG = {
    'Tên gói thầu KHLCNT': ('ten_goi_thau', 'Tên gói thầu'),
    'Giá gói thầu KHLCNT': ('gia_goi_thau', 'Giá gói thầu'),
    'Nguồn vốn KHLCNT': ('nguon_von', None),
    'Hình thức KHLCNT': ('hinh_thuc_lua_chon', 'Hình thức'),
    'Phương thức KHLCNT': ('phuong_thuc_lua_chon', 'Phương thức'),
    'Thời gian tổ chức KHLCNT': ('thoi_gian_to_chuc', 'Thời gian tổ chức'),
    'Thời gian bắt đầu tổ chức LCNT': ('thoi_gian_bat_dau_to_chuc', 'Thời gian bắt đầu'),
    'Loại hợp đồng KHLCNT': ('loai_hop_dong', 'Loại hợp đồng'),
    'Thời gian thực hiện gói thầu KHLCNT': ('thoi_gian_thuc_hien', 'Thời gian thực hiện'),
}

# ---------------------------------------------------------------- list groups
# group -> (app alias list, native root path, loop variable)
GROUPS = {
    'TCG': ('ds_to_chuyen_gia', 'to_chuyen_gia', 'cg'),
    'TTD': ('ds_to_tham_dinh', 'to_tham_dinh', 'td'),
    'PKG': ('ds_gt', 'goi_thau_trong_ke_hoach', 'gt'),
    'CVDTH': ('ds_cv_da_thuc_hien', 'ke_hoach.cv_da_thuc_hien', 'cv'),
    'CVKAD': ('ds_cv_khong_ap_dung', 'ke_hoach.cv_khong_ap_dung', 'cv'),
    'LOT': ('ds_tat_ca_phan_lo', 'ds_phan_lo', 'lo'),
    'LOTWIN': ('ds_lo_co_nt_trung', 'ds_phan_lo_co_nha_thau_trung', 'lo'),
    'WINLOT': ('ds_nt_trung_kem_lo', 'ds_nha_thau_trung_theo_phan_lo', 'nt'),
}
BID_LISTS = {  # app alias -> native root
    'ds_nt_tham_du': 'ds_nha_thau_tham_du',
    'ds_nt_trung': 'ds_nha_thau_trung_thau',
    'ds_nt_truot': 'ds_nha_thau_truot_thau',
    'ds_nt_khong_dat': 'ds_nha_thau_khong_dat',
    'ds_nt_dat_khong_hang_1': 'ds_nha_thau_dat_khong_xep_hang_1',
}

TCG_ITEMS = {
    'Họ và tên TVL': 'ho_ten', 'Vai trò TVL': 'chuc_vu', 'Nhiệm vụ BCĐG': 'cong_viec',
    'Nhiệm vụ HSMT': 'cong_viec', 'Số CC TVL': 'so_chung_chi', 'Nơi cấp TVL': 'don_vi_cap_chung_chi',
    'Ngày cấp TVL': 'ngay_cap_chung_chi', 'Số CCCD TVL': 'so_cccd', 'Chữ ký TVL': 'anh_chu_ky',
    'Ảnh TVL': 'anh_chung_chi',
}
TTD_ITEMS = {
    'Họ và tên TVT': 'ho_ten', 'Vai trò TVT': 'chuc_vu', 'Nhiệm vụ TĐ KQ': 'cong_viec',
    'Nhiệm vụ TĐ HSMT': 'cong_viec', 'Số CCCD TVT': 'so_cccd', 'Ngày CCCD TVT': 'ngay_cap_cccd',
    'Nơi CCCD TVT': 'noi_cap_cccd', 'Chữ ký TVT': 'anh_chu_ky', 'Ảnh TVT': 'anh_chung_chi',
}
DATE_ITEM_KEYS = {'ngay_cap_chung_chi', 'ngay_cap_cccd', 'ngay_ky', 'ngay_qd_chi_dinh'}
IMAGE_KEYS = {'anh_chu_ky', 'anh_chung_chi', 'anh_dau'}

# Tổ trưởng / tổ viên written as separate placeholders (8. BCĐG PLQT2)
LEADER = {
    'Họ và tên Tổ trưởng TV': (True, 'ho_ten'), 'Số CC Tổ trưởng TV': (True, 'so_chung_chi'),
    'Ngày cấp Tổ trưởng TV': (True, 'ngay_cap_chung_chi'), 'Số CCCD Tổ trưởng TV': (True, 'so_cccd'),
    'Họ và tên Tổ viên TV': (False, 'ho_ten'), 'Số CC Tổ viên TV': (False, 'so_chung_chi'),
    'Ngày cấp Tổ viên TV': (False, 'ngay_cap_chung_chi'), 'Số CCCD Tổ viên TV': (False, 'so_cccd'),
}

# bidder (opening/evaluation row) fields
BID_ITEMS = {
    'Tên nhà thầu': 'ten_nha_thau', 'Nhà thầu': 'ten_nha_thau', 'Nhà thầu tham dự': 'ten_nha_thau',
    'Nhà thầu hợp lệ': 'ten_nha_thau', 'Nhà thầu hợp lệ V2': 'ten_nha_thau',
    'Nhà thầu đạt năng lực, kinh nghiệm': 'ten_nha_thau', 'Nhà thầu đạt năng lực, kinh nghiệm V2': 'ten_nha_thau',
    'Nhà thầu đạt kỹ thuật': 'ten_nha_thau', 'Nhà thầu đạt kỹ thuật V2': 'ten_nha_thau',
    'Nhà thầu xếp hạng 1': 'ten_nha_thau', 'Nhà thầu xếp hạng 2 trở đi': 'ten_nha_thau',
    'Nhà thầu không trúng': 'ten_nha_thau', 'Nhà thầu đối chiếu': 'ten_nha_thau',
    'MST Nhà thầu': 'ma_so_thue', 'Mã số thuế': 'ma_so_thue',
    'Giá dự thầu': 'gia_du_thau', 'Giá dự thầu tổng': 'gia_du_thau',
    'Giá dự thầu xếp hạng 1 tổng': 'gia_du_thau', 'Giá dự thầu đạt kỹ thuật tổng': 'gia_du_thau',
    'Giảm giá tổng': 'ty_le_giam_gia', 'Giảm giá đạt kỹ thuật tổng': 'ty_le_giam_gia',
    'Giá trị giảm': 'ty_le_giam_gia',
    'Giá dự thầu sau hiệu chỉnh, giảm giá': 'gia_sau_giam_gia',
    'Giá dự thầu sau hiệu chỉnh, giảm giá tổng': 'gia_sau_giam_gia',
    'Giá dự thầu đạt kỹ thuật sau giảm giá tổng': 'gia_sau_giam_gia',
    'Giá dự thầu sau giảm': 'gia_sau_giam_gia',
    'Giá dự thầu xếp hạng 1 tổng sau giảm giá': 'gia_sau_giam_gia',
    'Giá dự thầu sau giảm giá, ưu đãi': 'gia_xep_hang',
    'Giá đánh giá': 'gia_xep_hang', 'Giá đánh giá đạt kỹ thuật tổng': 'gia_xep_hang',
    'Tính hợp lệ': 'danh_gia_hop_le', 'Năng lực kinh nghiệm': 'danh_gia_nang_luc',
    'Kỹ thuật': 'danh_gia_ky_thuat', 'Xếp hạng': 'danh_gia_tai_chinh', 'Điểm kỹ thuật': 'diem_danh_gia',
    'Tính hợp lệ-Làm rõ': 'lam_ro_hop_le', 'Năng lực kinh nghiệm - Làm rõ': 'lam_ro_nang_luc',
    'Kỹ thuật - Làm rõ': 'lam_ro_ky_thuat',
    'Lý do không đạt tư cách hợp lệ': 'nguyen_nhan_khong_dat_hop_le',
    'Lý do không đạt năng lực, kinh nghiệm': 'nguyen_nhan_khong_dat_nang_luc',
    'Lý do không đạt kỹ thuật': 'nguyen_nhan_khong_dat_ky_thuat',
    'Mã phần lô': 'ma_phan_lo', 'Tên phần lô': 'ten_phan_lo', 'Phần lô tham dự': 'ten_phan_lo',
}
# which bidder list a "driver" (name column) stands for
BID_DRIVERS = {
    'Tên nhà thầu': 'ds_nt_tham_du', 'Nhà thầu tham dự': 'ds_nt_tham_du',
    'Nhà thầu hợp lệ': 'ds_nt_tham_du', 'Nhà thầu hợp lệ V2': 'ds_nt_tham_du',
    'Nhà thầu đạt năng lực, kinh nghiệm': 'ds_nt_tham_du', 'Nhà thầu đạt năng lực, kinh nghiệm V2': 'ds_nt_tham_du',
    'Nhà thầu đạt kỹ thuật': 'ds_nt_tham_du', 'Nhà thầu đạt kỹ thuật V2': 'ds_nt_tham_du',
    'Nhà thầu': 'ds_nt_trung', 'Nhà thầu xếp hạng 1': 'ds_nt_trung', 'Nhà thầu đối chiếu': 'ds_nt_trung',
    'Nhà thầu xếp hạng 2 trở đi': 'ds_nt_dat_khong_hang_1', 'Nhà thầu không trúng': 'ds_nt_truot',
}
LAMRO_FIELDS = {'Tính hợp lệ-Làm rõ', 'Năng lực kinh nghiệm - Làm rõ', 'Kỹ thuật - Làm rõ'}
REASON_FIELDS = {'Lý do không đạt tư cách hợp lệ', 'Lý do không đạt năng lực, kinh nghiệm', 'Lý do không đạt kỹ thuật'}

# Root fields that, inside a bidder row, describe the package (use native path)
#   'Giá trị phần lô' in a bidder row = package price column
BID_ROW_ROOT = {'Giá trị phần lô': ('gia_gt', GT + 'gia_goi_thau', 'money')}

# Lot rows (lot folders)
LOT_ITEMS = {'Tên phần lô': 'ten_phan_lo', 'Mã phần lô': 'ma_phan_lo', 'Giá trị phần lô': 'gia_tri_phan_lo'}
LOTWIN_ITEMS = {'Nhà thầu đối chiếu': 'ten_nha_thau_trung', 'Tên phần lô': 'ten_phan_lo',
                'Mã phần lô': 'ma_phan_lo', 'Giá dự thầu sau hiệu chỉnh, giảm giá': 'gia_trung_thau'}
WINLOT_ITEMS = {'Nhà thầu xếp hạng 1': 'ten_nha_thau', 'Số phần xếp hạng 1': 'so_phan_lo_trung',
                'Giá dự thầu xếp hạng 1 tổng sau giảm giá': 'tong_gia_tri_trung_thau'}

# Plan work lists
CVDTH_ITEMS = {'Đã thực hiện': 'ten_cong_viec', 'Đơn vị thực hiện': 'don_vi_thuc_hien',
               'Giá trị đã thực hiện': 'gia_tri', 'Văn bản phê duyệt': 'van_ban_phe_duyet'}
CVKAD_ITEMS = {'Không áp dụng': 'ten_cong_viec', 'Giá không áp dụng': 'gia_tri'}

# Consultant contracts (hop_dong_list filtered by phan_loai)
CONTRACT = {
    'Số HĐ TVL': ('tư vấn', 'so_hop_dong'), 'Ngày ký HĐTVL': ('tư vấn', 'ngay_ky'),
    'Giá TVL': ('tư vấn', 'gia_tri'), 'Bằng chữ Giá TVL': ('tư vấn', 'bangchu_gia_tri'),
    'Thời gian TVL': ('tư vấn', 'thoi_gian_thuc_hien'), 'Số QĐTVL': ('tư vấn', 'so_qd_chi_dinh'),
    'Ngày ký QĐTVL': ('tư vấn', 'ngay_qd_chi_dinh'),
    'Số HĐTVT': ('thẩm định', 'so_hop_dong'), 'Ngày ký HĐTVT': ('thẩm định', 'ngay_ky'),
    'Giá TVT': ('thẩm định', 'gia_tri'), 'Bằng chữ Giá TVT': ('thẩm định', 'bangchu_gia_tri'),
    'Thời gian TVT': ('thẩm định', 'thoi_gian_thuc_hien'), 'Số QĐTVT': ('thẩm định', 'so_qd_chi_dinh'),
    'Ngày ký QĐTVT': ('thẩm định', 'ngay_qd_chi_dinh'),
}

LOOP_INDEX = {'STT', 'STT TVL'}

# No equivalent data in BiddingFlow -> keep [[...]] (reason shown in the report)
UNMAPPED = {
    'Địa danh': 'BiddingFlow không có trường địa danh riêng',
    'Địa danh TVL': 'Không có trường địa danh của đơn vị tư vấn',
    'Địa danh TVT': 'Không có trường địa danh của đơn vị tư vấn',
    'Phê duyệt': 'Không có trường "kế hoạch / dự toán và kế hoạch"',
    'Chứng thư thẩm định': 'Không có trường số chứng thư thẩm định giá',
    'Bảo đảm thực hiện hợp đồng': 'Chỉ có tỷ lệ (%) bảo đảm, không có số tiền',
    'Số QĐ thành lập tổ': 'Không lưu QĐ thành lập tổ của chủ đầu tư',
    'Ngày thành lập tổ': 'Không lưu QĐ thành lập tổ của chủ đầu tư',
    'Số QĐ thành lập TVL': 'Không lưu QĐ thành lập tổ chuyên gia',
    'Ngày thành lập TVL': 'Không lưu QĐ thành lập tổ chuyên gia',
    'Số QĐ thành lập TVT': 'Không lưu QĐ thành lập tổ thẩm định',
    'Ngày thành lập TVT': 'Không lưu QĐ thành lập tổ thẩm định',
    'Số BCĐG': 'Không có số/ngày báo cáo đánh giá', 'Ngày trình BCĐG': 'Không có số/ngày báo cáo đánh giá',
    'Ngày trình BCĐGS': 'Không có số/ngày báo cáo đánh giá',
    'Số BCTĐ KQ': 'Không có số/ngày báo cáo thẩm định KQLCNT', 'Ngày BCTĐKQ': 'Không có số/ngày báo cáo thẩm định KQLCNT',
    'Số BCTĐ KT': 'Không có báo cáo thẩm định kỹ thuật', 'Ngày BCTĐ KT': 'Không có báo cáo thẩm định kỹ thuật',
    'Số QĐ KT': 'Không có QĐ phê duyệt danh sách đạt kỹ thuật', 'Ngày QĐ KT': 'Không có QĐ phê duyệt danh sách đạt kỹ thuật',
    'Ngày QĐ KTS': 'Không có QĐ phê duyệt danh sách đạt kỹ thuật',
    'Số BC TC': 'Không có số/ngày báo cáo đánh giá tài chính', 'Ngày BC TC': 'Không có số/ngày báo cáo đánh giá tài chính',
    'Ngày BC TCS': 'Không có số/ngày báo cáo đánh giá tài chính',
    'Số BBĐC': 'Không có số biên bản đối chiếu',
    'Ngày thư chấp thuận': 'Không có ngày thư chấp thuận', 'Ngày cuối hoàn thiện': 'Không có hạn hoàn thiện hợp đồng',
    'Ngày hoàn thiện hợp đồng': 'Không có ngày hoàn thiện hợp đồng',
    'Ngày thư mời xác nhận năng lực': 'Không có ngày thư mời', 'Ngày báo cáo': 'Không có ngày báo cáo',
    'Ngày tờ trình KQ': 'Không có ngày tờ trình kết quả',
    'Ngày gửi giấy mời TVL': 'Không có ngày giấy mời tư vấn', 'Ngày gửi giấy mời TVT': 'Không có ngày giấy mời tư vấn',
    'Ngày đơn xin TVL': 'Không có ngày đơn xin nhận thầu', 'Ngày đơn xin TVT': 'Không có ngày đơn xin nhận thầu',
    'Ngày trình TVL': 'Không có ngày tờ trình chỉ định tư vấn', 'Ngày trình TVT': 'Không có ngày tờ trình chỉ định tư vấn',
    'Ngày ký BBHT TVL': 'Không có ngày biên bản hoàn thiện hợp đồng tư vấn',
    'Tên gói thầu BS': 'Phần tên bổ sung, không có trường tương ứng', 'Tên KHLCNTBS': 'Phần tên bổ sung, không có trường tương ứng',
    'Áp dụng Hình thức KHLCNT': 'Văn bản giải trình, không có trường', 'Áp dụng Phương thức KHLCNT': 'Văn bản giải trình, không có trường',
    'Áp dụng Loại hợp đồng KHLCNT': 'Văn bản giải trình, không có trường',
    'Giá tổng gói thầu': 'Tổng giá các gói thầu: không có trường tổng', 'Giá tổng dự toán': 'Không có trường giá trị dự toán sau khấu trừ',
    'Giá trị đã thực hiện tổng': 'Không có trường tổng', 'Giá không áp dụng tổng': 'Không có trường tổng',
    'Giá trị ưu đãi tổng': 'Không có giá trị ưu đãi trong dữ liệu xuất Word', 'Ưu đãi': 'Không có giá trị ưu đãi trong dữ liệu xuất Word',
    'Số phần tham dự': 'Không có thống kê số phần lô theo từng nhà thầu', 'Số phần đạt': 'Không có thống kê số phần lô theo từng nhà thầu',
    'Số phần không đạt': 'Không có thống kê số phần lô theo từng nhà thầu',
    'Giá phần lô tham dự tổng': 'Không có tổng giá phần lô theo từng nhà thầu',
    'Giá phần lô tham dự đạt xếp hạng 1 tổng': 'Không có tổng giá phần lô theo từng nhà thầu',
    # consultant firm identity (not exposed to Word in package exports)
    'Tư vấn lập': 'Dữ liệu xuất Word không có thông tin đơn vị tư vấn lập', 'Tư vấn thẩm': 'Dữ liệu xuất Word không có thông tin đơn vị tư vấn thẩm định',
    'Chức vụ TVL': 'Không có thông tin người đại diện đơn vị tư vấn', 'Chức vụ TVT': 'Không có thông tin người đại diện đơn vị tư vấn',
    'Danh xưng TVL': 'Không có thông tin đơn vị tư vấn', 'Danh xưng TVT': 'Không có thông tin đơn vị tư vấn',
    'Đại diện TVL': 'Không có thông tin đơn vị tư vấn', 'Đại diện TVT': 'Không có thông tin đơn vị tư vấn',
    'Địa chỉ TVL': 'Không có thông tin đơn vị tư vấn', 'Địa chỉ TVT': 'Không có thông tin đơn vị tư vấn',
    'Điện thoại TVL': 'Không có thông tin đơn vị tư vấn', 'Điện thoại TVT': 'Không có thông tin đơn vị tư vấn',
    'Mã số thuế TVL': 'Không có thông tin đơn vị tư vấn', 'Mã số thuế TVT': 'Không có thông tin đơn vị tư vấn',
    'Tài khoản TVL': 'Không có thông tin đơn vị tư vấn', 'Tài khoản TVT': 'Không có thông tin đơn vị tư vấn',
    'Ngân hàng TVL': 'Không có thông tin đơn vị tư vấn', 'Ngân hàng TVT': 'Không có thông tin đơn vị tư vấn',
    'Citad TVL': 'Không có thông tin đơn vị tư vấn', 'Citad TVT': 'Không có thông tin đơn vị tư vấn',
    'Dấu TVL': 'Không có ảnh dấu của đơn vị tư vấn', 'Dấu TVT': 'Không có ảnh dấu của đơn vị tư vấn',
}


# ---------------------------------------------------------------- inferred values (suy luận)
_PROV = [
    ('hà nội', 'Hà Nội'), (' huế', 'Huế'), ('lai châu', 'Lai Châu'), ('điện biên', 'Điện Biên'),
    ('sơn la', 'Sơn La'), ('lạng sơn', 'Lạng Sơn'), ('quảng ninh', 'Quảng Ninh'), ('thanh hóa', 'Thanh Hóa'),
    ('thanh hoá', 'Thanh Hóa'), ('nghệ an', 'Nghệ An'), ('hà tĩnh', 'Hà Tĩnh'), ('cao bằng', 'Cao Bằng'),
    ('tuyên quang', 'Tuyên Quang'), ('lào cai', 'Lào Cai'), ('thái nguyên', 'Thái Nguyên'), ('phú thọ', 'Phú Thọ'),
    ('bắc ninh', 'Bắc Ninh'), ('hưng yên', 'Hưng Yên'), ('hải phòng', 'Hải Phòng'), ('ninh bình', 'Ninh Bình'),
    ('quảng trị', 'Quảng Trị'), ('đà nẵng', 'Đà Nẵng'), ('quảng ngãi', 'Quảng Ngãi'), ('gia lai', 'Gia Lai'),
    ('khánh hòa', 'Khánh Hòa'), ('khánh hoà', 'Khánh Hòa'), ('lâm đồng', 'Lâm Đồng'), ('đắk lắk', 'Đắk Lắk'),
    ('đắc lắc', 'Đắk Lắk'), ('hồ chí minh', 'Thành phố Hồ Chí Minh'), ('đồng nai', 'Đồng Nai'), ('tây ninh', 'Tây Ninh'),
    ('cần thơ', 'Cần Thơ'), ('vĩnh long', 'Vĩnh Long'), ('đồng tháp', 'Đồng Tháp'), ('cà mau', 'Cà Mau'),
    ('an giang', 'An Giang'),
    # tên tỉnh cũ (trước 01/7/2025) -> tỉnh mới
    ('hà giang', 'Tuyên Quang'), ('yên bái', 'Lào Cai'), ('bắc kạn', 'Thái Nguyên'), ('bắc cạn', 'Thái Nguyên'),
    ('vĩnh phúc', 'Phú Thọ'), ('hòa bình', 'Phú Thọ'), ('hoà bình', 'Phú Thọ'), ('bắc giang', 'Bắc Ninh'),
    ('thái bình', 'Hưng Yên'), ('hải dương', 'Hải Phòng'), ('hà nam', 'Ninh Bình'), ('nam định', 'Ninh Bình'),
    ('quảng bình', 'Quảng Trị'), ('quảng nam', 'Đà Nẵng'), ('kon tum', 'Quảng Ngãi'), ('bình định', 'Gia Lai'),
    ('ninh thuận', 'Khánh Hòa'), ('đắk nông', 'Lâm Đồng'), ('đắc nông', 'Lâm Đồng'), ('bình thuận', 'Lâm Đồng'),
    ('phú yên', 'Đắk Lắk'), ('bình dương', 'Thành phố Hồ Chí Minh'), ('vũng tàu', 'Thành phố Hồ Chí Minh'),
    ('bình phước', 'Đồng Nai'), ('long an', 'Tây Ninh'), ('sóc trăng', 'Cần Thơ'), ('hậu giang', 'Cần Thơ'),
    ('bến tre', 'Vĩnh Long'), ('trà vinh', 'Vĩnh Long'), ('tiền giang', 'Đồng Tháp'), ('bạc liêu', 'Cà Mau'),
    ('kiên giang', 'An Giang'),
]


def _d(path):
    return "%s|default('', true)" % path


def _date_pick(first, second, short):
    def s(p):
        if not short:
            return p
        head, _, last = p.rpartition('.')
        return head + '.S_' + last
    return ("{%% if %s %%}{{ %s }}{%% else %%}{{ %s }}{%% endif %%}"
            % (_d(s(first)), _d(s(first)), _d(s(second))))


def _total(lst, field, marker):
    return ("{%% for x in %s %%}{%% if loop.length == 1 %%}{{ x.%s|default('', true) }}"
            "{%% elif loop.first %%}[[%s]]{%% endif %%}{%% else %%}0{%% endfor %%}" % (lst, field, marker))


INFER = {
    # Địa danh: tỉnh/thành phố tìm thấy trong địa chỉ chủ đầu tư (tên cũ quy về tỉnh mới)
    'Địa danh': lambda short: (
        "{%% for dd in [%s] if dd[0] in (%s|lower) %%}{%% if loop.first %%}{{ dd[1] }}{%% endif %%}"
        "{%% else %%}[[Địa danh]]{%% endfor %%}"
        % (','.join("('%s','%s')" % kv for kv in _PROV), _d(' chu_dau_tu.dia_chi'.strip()))),
    # Phê duyệt: có QĐ dự toán riêng (khác số/ngày QĐ kế hoạch) -> "kế hoạch"; dự toán mua sắm -> "dự toán và kế hoạch"
    'Phê duyệt': lambda short: (
        "{%% if ke_hoach.phe_duyet|default('', true)|trim %%}{{ ke_hoach.phe_duyet|lower|trim }}{%% elif (%s and %s != %s) or (%s|trim and %s|trim != %s|trim) %%}kế hoạch"
        "{%% elif 'toán' in (%s|lower) %%}dự toán và kế hoạch{%% else %%}kế hoạch{%% endif %%}"
        % (_d('ke_hoach.ngay_phe_duyet_du_toan'), _d('ke_hoach.ngay_phe_duyet_du_toan'), _d('ke_hoach.ngay_phe_duyet'),
           _d('ke_hoach.so_qd_phe_duyet_du_toan'), _d('ke_hoach.so_qd_phe_duyet_du_toan'), _d('ke_hoach.quyet_dinh_phe_duyet'),
           _d('ke_hoach.loai_hinh_mua_sam'))),
    # Số QĐ thành lập tổ của CĐT: theo quy ước ".../QĐ-<tên viết tắt CĐT>"
    'Số QĐ thành lập tổ': lambda short: ".../QĐ-{{ %s }}" % _d('chu_dau_tu.ten_viet_tat'),
    # Ngày thành lập tổ: ngày tờ trình dự toán, không có thì ngày tờ trình kế hoạch
    'Ngày thành lập tổ': lambda short: _date_pick('ke_hoach.ngay_trinh_du_toan', 'ke_hoach.ngay_trinh_ke_hoach', short),
    # Ngày tờ trình KQ: ngày QĐ phê duyệt kết quả, chưa có thì ngày thương thảo
    'Ngày tờ trình KQ': lambda short: _date_pick('goi_thau.ngay_quyet_dinh_ket_qua', 'goi_thau.ngay_doi_chieu', short),
    # Tổng: chính xác khi danh sách có 0 hoặc 1 dòng; nhiều dòng thì giữ [[...]] để điền tay
    'Giá tổng gói thầu': lambda short: _total('goi_thau_trong_ke_hoach', 'gia_goi_thau', 'Giá tổng gói thầu'),
    'Giá không áp dụng tổng': lambda short: _total('ke_hoach.cv_khong_ap_dung', 'gia_tri', 'Giá không áp dụng tổng'),
    'Giá trị đã thực hiện tổng': lambda short: _total('ke_hoach.cv_da_thuc_hien', 'gia_tri', 'Giá trị đã thực hiện tổng'),
    'Giá tổng dự toán': lambda short: (
        "{%% for x in ke_hoach.cv_da_thuc_hien %%}{%% if loop.first %%}[[Giá tổng dự toán]]{%% endif %%}"
        "{%% else %%}{{ %s }}{%% endfor %%}" % _d('ke_hoach.tong_muc_dau_tu')),
    # phần bổ sung tên: không có dữ liệu -> để trống
    'Tên gói thầu BS': lambda short: '',
    'Tên KHLCNTBS': lambda short: '',
}
# placeholders inside a package row of the plan (loop variable "item")
INFER_PKG = {
    'Áp dụng Hình thức KHLCNT': (
        "{% if (item.hinh_thuc_lua_chon|default('', true)|lower|trim) == 'chỉ định thầu rút gọn' %}"
        "áp dụng Khoản 4 Điều 78 và Khoản 2 Điều 80 Nghị định 214/2025/NĐ-CP ngày 04/08/2025 được sửa đổi, "
        "bổ sung bởi Nghị định số 349/2026/NĐ-CP ngày 09/9/2026;{% else %}[[Áp dụng Hình thức KHLCNT]]{% endif %}"),
    'Áp dụng Phương thức KHLCNT': (
        "{% if (item.phuong_thuc_lua_chon|default('', true)|lower|trim) in ['', 'không có', 'không áp dụng'] %}"
        "Không có phương thức lựa chọn nhà thầu{% else %}[[Áp dụng Phương thức KHLCNT]]{% endif %}"),
    'Áp dụng Loại hợp đồng KHLCNT': (
        "{% if 'đơn giá cố định' in (item.loai_hop_dong|default('', true)|lower) %}"
        "Tại thời điểm lựa chọn nhà thầu bản chất công việc đã xác định được rõ ràng nhưng chưa xác định được "
        "chính xác số lượng, khối lượng công việc thực tế phải hoàn thành. Giá hợp đồng ban đầu dựa trên số lượng, "
        "khối lượng công việc, đơn giá cố định theo hợp đồng và chi phí dự phòng cho số lượng, khối lượng công việc "
        "có thể phát sinh được xác định theo quy định pháp luật vì vậy áp dụng hợp đồng theo đơn giá cố định cho gói "
        "thầu căn cứ theo Khoản 2, Điều 64 của Luật đấu thầu số 22/2023/QH15 ngày 23 tháng 6 năm 2023"
        "{% else %}[[Áp dụng Loại hợp đồng KHLCNT]]{% endif %}"),
}
# simple root aliases added by inference
ROOT.update({
    'Ngày thư mời xác nhận năng lực': ('ngay_phe_duyet_kh', KH + 'ngay_phe_duyet', 'date'),
    'Ngày thư chấp thuận': ('ngay_qd_kq', GT + 'ngay_quyet_dinh_ket_qua', 'date'),
})
for _k in list(INFER) + list(INFER_PKG) + ['Ngày thư mời xác nhận năng lực', 'Ngày thư chấp thuận']:
    UNMAPPED.pop(_k, None)


# ---------------------------------------------------------------------------
# ADR 0099 (Bidding): số/ngày văn bản theo mốc tiến độ -> biến so_* / ngay_*
# ---------------------------------------------------------------------------
def _td(kind, slug):
    name = '%s_%s' % (kind, slug)
    return (name, name, 'date' if kind == 'ngay' else 'text')


TIMELINE_ROOT = {
    'Số QĐ thành lập TVL': _td('so', 'qd_tl_tcg'),
    'Ngày thành lập TVL': _td('ngay', 'qd_tl_tcg'),
    'Số QĐ thành lập TVT': _td('so', 'qd_tl_ttd'),
    'Ngày thành lập TVT': _td('ngay', 'qd_tl_ttd'),
    'Ngày gửi giấy mời TVL': _td('ngay', 'thu_moi_tvl'),
    'Ngày gửi giấy mời TVT': _td('ngay', 'thu_moi_tvt'),
    'Ngày đơn xin TVL': _td('ngay', 'don_xin_tvl'),
    'Ngày đơn xin TVT': _td('ngay', 'don_xin_tvt'),
    'Ngày ký BBHT TVL': _td('ngay', 'bbht_tvl'),
    'Ngày trình TVL': _td('ngay', 'ttr_chi_dinh_tvl'),
    'Ngày trình TVT': _td('ngay', 'ttr_chi_dinh_tvt'),
    'Số BCĐG': _td('so', 'bcdg'),
    'Ngày trình BCĐG': _td('ngay', 'bcdg'),
    'Số BCTĐ KT': _td('so', 'bctd_kt'),
    'Ngày BCTĐ KT': _td('ngay', 'bctd_kt'),
    'Số QĐ KT': _td('so', 'qd_kt'),
    'Ngày QĐ KT': _td('ngay', 'qd_kt'),
    'Số BC TC': _td('so', 'bcdg_tc'),
    'Ngày BC TC': _td('ngay', 'bcdg_tc'),
    'Số BBĐC': _td('so', 'bbdc'),
    'Số BCTĐ KQ': _td('so', 'bctd_kq'),
    'Ngày BCTĐKQ': _td('ngay', 'bctd_kq'),
    'Ngày hoàn thiện hợp đồng': _td('ngay', 'bbht_hd'),
}
ROOT.update(TIMELINE_ROOT)
FORCE_SHORT.update({'Ngày trình BCĐGS': 'Ngày trình BCĐG', 'Ngày QĐ KTS': 'Ngày QĐ KT', 'Ngày BC TCS': 'Ngày BC TC'})
# BBHT của tư vấn thẩm định dùng nhầm tên biến TVL trong mẫu -> lấy mốc BBHT TVT
FOLDER_ROOT = {
    ('5. TVTB1', 'Ngày ký BBHT TVL'): _td('ngay', 'bbht_tvt'),
}


def _root_or(var, fallback):
    """Timeline variable when filled, otherwise the earlier fallback expression."""
    return "{%% if %s %%}{{ %s }}{%% else %%}%s{%% endif %%}" % (_d(var), _d(var), fallback)


def _td_date(slug, short):
    return ('S_' if short else '') + 'ngay_' + slug


INFER.update({
    'Số QĐ thành lập tổ': lambda short: _root_or('so_qd_tl_to', ".../QĐ-{{ %s }}" % _d('chu_dau_tu.ten_viet_tat')),
    'Ngày thành lập tổ': lambda short: (
        "{%% if %s %%}{{ %s }}{%% else %%}%s{%% endif %%}"
        % (_d('ngay_qd_tl_to'), _d(_td_date('qd_tl_to', short)),
           _date_pick('ke_hoach.ngay_trinh_du_toan', 'ke_hoach.ngay_trinh_ke_hoach', short))),
    'Ngày thư chấp thuận': lambda short: (
        "{%% if %s %%}{{ %s }}{%% else %%}{{ %s }}{%% endif %%}"
        % (_d('ngay_thu_chap_thuan'), _d(_td_date('thu_chap_thuan', short)),
           _d('goi_thau.%sngay_quyet_dinh_ket_qua' % ('S_' if short else '')))),
})


def _chung_thu(prev):
    # "... thẩm định giá số [[Chứng thư thẩm định]]": không lặp chữ "số" đã có trong mẫu
    so_word = '' if re.search(r'số\s*$', prev or '', re.I) else 'số '
    return ("{%% if %(so)s or %(ng)s %%}{%% if %(so)s %%}%(w)s{{ %(so)s }}{%% endif %%}"
            "{%% if %(so)s and %(ng)s %%} {%% endif %%}{%% if %(ng)s %%}ngày {{ %(sng)s }}{%% endif %%}"
            "{%% else %%}[[Chứng thư thẩm định]]{%% endif %%}"
            % {'so': _d('so_chung_thu_tdg'), 'ng': _d('ngay_chung_thu_tdg'),
               'sng': _d('S_ngay_chung_thu_tdg'), 'w': so_word})


# INFER variants that need the text written just before the placeholder
INFER_PREV = {'Chứng thư thẩm định': _chung_thu}
ROOT.pop('Ngày thư chấp thuận', None)
for _k in list(TIMELINE_ROOT) + list(FORCE_SHORT) + ['Chứng thư thẩm định', 'Ngày thư chấp thuận']:
    UNMAPPED.pop(_k, None)


# ---------------------------------------------------------------------------
# ADR 0100 (Bidding): thông tin đơn vị tư vấn lập / thẩm định -> biến *_tvl / *_tvt
# Nguồn: nhà thầu của hợp đồng phân loại "Tư vấn" / "Thẩm định" gắn với gói thầu.
# ---------------------------------------------------------------------------
# mã trong tên placeholder -> (hậu tố biến, khóa gốc Bidding, placeholder tên đơn vị)
_CONSULTANT = {
    'TVL': ('tvl', 'don_vi_tu_van_lap.', 'Tư vấn lập'),
    'TVT': ('tvt', 'don_vi_tu_van_tham.', 'Tư vấn thẩm'),
}
# phần đầu placeholder -> (gốc tên biến, trường nhà thầu)
_CONSULTANT_ITEMS = {
    'Chức vụ': ('chuc_vu_dai_dien', 'chuc_vu_dai_dien'),
    'Danh xưng': ('danh_xung', 'danh_xung'),
    'Đại diện': ('dai_dien', 'nguoi_dai_dien'),
    'Địa chỉ': ('dia_chi', 'dia_chi'),
    'Điện thoại': ('sdt', 'so_dien_thoai'),
    'Mã số thuế': ('mst', 'ma_so_thue'),
    'Tài khoản': ('stk', 'so_tai_khoan'),
    'Ngân hàng': ('noi_mo_tk', 'noi_mo_tai_khoan'),
    'Citad': ('ma_ngan_hang', 'ma_ngan_hang'),
    'Dấu': ('anh_dau', 'anh_dau'),
}
CONSULTANT_ROOT = {}
for _code, (_suffix, _path, _name_ph) in _CONSULTANT.items():
    CONSULTANT_ROOT[_name_ph] = ('ten_' + _suffix, _path + 'ten_nha_thau', 'text')
    for _label, (_stem, _field) in _CONSULTANT_ITEMS.items():
        CONSULTANT_ROOT['%s %s' % (_label, _code)] = ('%s_%s' % (_stem, _suffix), _path + _field, 'text')
ROOT.update(CONSULTANT_ROOT)


def _dia_danh(address_path, marker):
    """Tỉnh/thành phố tìm thấy trong một địa chỉ; không thấy thì giữ [[marker]]."""
    return lambda short: (
        "{%% for dd in [%s] if dd[0] in (%s|lower) %%}{%% if loop.first %%}{{ dd[1] }}{%% endif %%}"
        "{%% else %%}[[%s]]{%% endfor %%}"
        % (','.join("('%s','%s')" % kv for kv in _PROV), _d(address_path), marker))


# Địa danh của đơn vị tư vấn: suy từ địa chỉ đơn vị (như Địa danh của chủ đầu tư)
INFER.update({
    'Địa danh TVL': _dia_danh('don_vi_tu_van_lap.dia_chi', 'Địa danh TVL'),
    'Địa danh TVT': _dia_danh('don_vi_tu_van_tham.dia_chi', 'Địa danh TVT'),
})
for _k in list(CONSULTANT_ROOT) + ['Địa danh TVL', 'Địa danh TVT']:
    UNMAPPED.pop(_k, None)
