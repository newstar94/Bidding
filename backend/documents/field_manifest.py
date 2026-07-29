"""Shared field metadata for persistence, UI, Word and Excel integrations."""

from backend.shared.date_utils import DATETIME_COLUMNS
from backend.db.schema import SCHEMA_DINH_NGHIA


DATE_ONLY_COLUMNS = {
    column
    for table in SCHEMA_DINH_NGHIA.values()
    for column in table.get("columns", {})
    if column.startswith("ngay_")
}

PERCENT_COLUMNS = {
    "trong_so_ky_thuat",
    "ty_le",
    "ty_le_bao_dam_hop_dong",
    "ty_le_giam_gia",
}

CURRENCY_COLUMNS = {
    "bao_dam_du_thau",
    "gia_ca",
    "gia_du_thau",
    "gia_goi_thau",
    "gia_xep_hang",
    "gia_de_nghi_trung_thau",
    "gia_sau_giam_gia",
    "gia_tri",
    "gia_tri_dam_bao",
    "gia_tri_dam_bao_du_thau",
    "gia_tri_phan_lo",
    "gia_tri_uoc_tinh",
    "gia_trung_thau",
    "tong_muc_dau_tu",
}

FIELD_LABELS_BY_TABLE = {
    "chu_dau_tu": {
        "phien_ban": "Phiên bản dữ liệu",
        "ma_chu_dau_tu": "Mã chủ đầu tư",
        "ten_chu_dau_tu": "Tên chủ đầu tư",
        "ngay_ap_dung": "Ngày áp dụng",
        "ten_viet_tat": "Tên viết tắt chủ đầu tư",
        "ma_so_thue": "Mã số thuế chủ đầu tư",
        "chuc_vu_nguoi_dung_dau": "Chức vụ người đứng đầu",
        "dai_dien_cdt": "Họ tên người đại diện chủ đầu tư",
        "chuc_vu_dai_dien": "Chức vụ người đại diện chủ đầu tư",
        "danh_xung": "Danh xưng người đại diện chủ đầu tư",
        "dia_chi": "Địa chỉ chủ đầu tư",
        "so_dien_thoai": "Số điện thoại chủ đầu tư",
        "so_tai_khoan": "Số tài khoản chủ đầu tư",
        "noi_mo_tai_khoan": "Nơi mở tài khoản chủ đầu tư",
        "email": "Email chủ đầu tư",
        "ma_qhns": "Mã QHNS của chủ đầu tư",
        "co_quan_chu_quan": "Cơ quan chủ quản của chủ đầu tư",
    },
    "ke_hoach_lcnt": {
        "ma_ke_hoach": "Mã kế hoạch lựa chọn nhà thầu",
        "ma_du_an": "Mã dự án đầu tư",
        "phien_ban": "Phiên bản dữ liệu",
        "ten_ke_hoach": "Tên kế hoạch lựa chọn nhà thầu",
        "ten_du_an_du_toan": "Tên dự án / Dự toán mua sắm",
        "loai_hinh_mua_sam": "Loại kế hoạch (Dự án / Dự toán mua sắm)",
        "don_vi_trinh_cdt": "Đơn vị trình của chủ đầu tư",
        "ten_viet_tat_don_vi_trinh": "Tên viết tắt đơn vị trình",
        "tong_muc_dau_tu": "Tổng mức đầu tư dự án / Tổng dự toán",
        "ngay_phe_duyet": "Ngày phê duyệt kế hoạch lựa chọn nhà thầu",
        "quyet_dinh_phe_duyet": "Số quyết định phê duyệt kế hoạch lựa chọn nhà thầu",
        "thoi_gian_dang_tai": "Thời gian đăng tải kế hoạch lựa chọn nhà thầu",
        "nguon_von": "Nguồn vốn",
        "thoi_gian_du_an": "Thời gian thực hiện dự án",
        "dia_diem_quy_mo": "Địa điểm và quy mô xây dựng/mua sắm",
        "thong_tin_khac": "Thông tin bổ sung khác",
        "so_qd_phe_duyet_du_an": "Số quyết định phê duyệt dự án đầu tư",
        "ngay_qd_phe_duyet_du_an": "Ngày quyết định phê duyệt dự án đầu tư",
        "co_quan_phe_duyet_du_an": "Cơ quan ban hành quyết định phê duyệt dự án",
        "phe_duyet": "Họ tên người phê duyệt kế hoạch lựa chọn nhà thầu",
        "so_to_trinh_du_toan": "Số tờ trình dự toán",
        "ngay_trinh_du_toan": "Ngày trình duyệt dự toán",
        "ngay_phe_duyet_du_toan": "Ngày phê duyệt dự toán",
        "so_qd_phe_duyet_du_toan": "Số quyết định phê duyệt dự toán",
        "so_to_trinh_ke_hoach": "Số tờ trình kế hoạch lựa chọn nhà thầu",
        "so_to_trinh_du_toan_ke_hoach": "Số tờ trình dự toán và kế hoạch lựa chọn nhà thầu",
        "ngay_trinh_ke_hoach": "Ngày trình phê duyệt kế hoạch lựa chọn nhà thầu",
    },
    "goi_thau": {
        "ma_goi_thau": "Mã gói thầu (Mã TBMT)",
        "phien_ban": "Phiên bản dữ liệu",
        "ten_goi_thau": "Tên gói thầu",
        "gia_goi_thau": "Giá gói thầu",
        "loai_hop_dong": "Loại hợp đồng gói thầu",
        "hinh_thuc_lua_chon": "Hình thức lựa chọn nhà thầu",
        "phuong_thuc_lua_chon": "Phương thức lựa chọn nhà thầu",
        "thoi_gian_thuc_hien": "Thời gian thực hiện gói thầu",
        "nguon_von": "Nguồn vốn gói thầu",
        "gia_trung_thau": "Giá trúng thầu",
        "linh_vuc": "Lĩnh vực gói thầu",
        "tuy_chon_mua_them": "Tùy chọn mua thêm",
        "thoi_gian_to_chuc": "Thời gian tổ chức lựa chọn nhà thầu",
        "thoi_gian_bat_dau_to_chuc": "Thời gian bắt đầu tổ chức lựa chọn nhà thầu",
        "phan_lo": "Phần lô gói thầu",
        "thoi_gian_dang_tai": "Thời gian đăng tải thông báo mời thầu",
        "thoi_gian_dong_thau": "Thời gian đóng thầu",
        "thoi_gian_mo_thau": "Thời gian mở thầu",
        "thoi_gian_mo_ehsdxtc": "Thời gian mở E-HSĐXTC",
        "so_quyet_dinh": "Số quyết định phê duyệt HSMT / Hồ sơ yêu cầu",
        "ngay_quyet_dinh": "Ngày quyết định phê duyệt HSMT / Hồ sơ yêu cầu",
        "so_quyet_dinh_ket_qua": "Số quyết định phê duyệt kết quả lựa chọn nhà thầu",
        "ngay_quyet_dinh_ket_qua": "Ngày quyết định phê duyệt kết quả lựa chọn nhà thầu",
        "thoi_gian_goi_thau": "Thời gian thực hiện gói thầu của nhà thầu trúng thầu",
        "thoi_gian_hop_dong": "Thời gian thực hiện hợp đồng",
        "gia_tri_dam_bao_du_thau": "Giá trị bảo đảm dự thầu",
        "hieu_luc_hsdt": "Hiệu lực hồ sơ dự thầu",
        "hieu_luc_dam_bao_du_thau": "Hiệu lực bảo đảm dự thầu",
        "phuong_phap_danh_gia": "Phương pháp đánh giá hồ sơ dự thầu",
        "trong_so_ky_thuat": "Trọng số điểm kỹ thuật",
        "ty_le_bao_dam_hop_dong": "Tỷ lệ bảo đảm thực hiện hợp đồng",
        "is_thuoc": "Là gói thầu thuốc",
        "trang_thai": "Trạng thái gói thầu",
        "yeu_cau_tham_dinh_hsmt": "Yêu cầu thẩm định HSMT",
        "so_bao_cao_tham_dinh_hsmt": "Số báo cáo thẩm định HSMT",
        "ngay_bao_cao_tham_dinh_hsmt": "Ngày báo cáo thẩm định HSMT",
        "so_to_trinh_hsmt": "Số tờ trình phê duyệt HSMT",
        "ngay_trinh_hsmt": "Ngày trình phê duyệt HSMT",
        "ngay_moi_doi_chieu": "Ngày mời đối chiếu tài liệu / thương thảo",
        "ngay_doi_chieu": "Ngày đối chiếu tài liệu / thương thảo",
        "qua_mang": "Hình thức thực hiện qua mạng",
        "trong_nuoc_quoc_te": "Phạm vi trong nước / quốc tế",
        "is_rebid": "Gói thầu tổ chức lại",
    },
    "nha_thau": {
        "phien_ban": "Phiên bản dữ liệu",
        "ma_nha_thau": "Mã nhà thầu",
        "ten_nha_thau": "Tên nhà thầu",
        "ngay_ap_dung": "Ngày áp dụng",
        "ten_viet_tat": "Tên viết tắt nhà thầu",
        "loai_nha_thau": "Loại nhà thầu",
        "ma_so_thue": "Mã số thuế nhà thầu",
        "nguoi_dai_dien": "Người đại diện nhà thầu",
        "chuc_vu_dai_dien": "Chức vụ người đại diện nhà thầu",
        "danh_xung": "Danh xưng người đại diện nhà thầu",
        "so_dien_thoai": "Số điện thoại nhà thầu",
        "email": "Email nhà thầu",
        "dia_chi": "Địa chỉ nhà thầu",
        "so_tai_khoan": "Số tài khoản nhà thầu",
        "noi_mo_tai_khoan": "Nơi mở tài khoản nhà thầu",
        "ma_ngan_hang": "Mã ngân hàng nhà thầu",
        "anh_dau": "Ảnh dấu nhà thầu",
        "ten_anh_dau": "Tên ảnh dấu nhà thầu",
    },
    "thong_tin_mo_thau": {
        "ma_phan_lo": "Mã phần lô mở thầu",
        "ten_phan_lo": "Tên phần lô mở thầu",
        "ma_dinh_danh": "Mã định danh mở thầu",
        "gia_du_thau": "Giá dự thầu mở thầu",
        "ty_le_giam_gia": "Tỷ lệ giảm giá mở thầu",
        "gia_sau_giam_gia": "Giá sau giảm giá mở thầu",
        "hieu_luc_hsdt": "Hiệu lực hồ sơ dự thầu",
        "gia_tri_dam_bao": "Giá trị bảo đảm dự thầu",
        "hieu_luc_bao_dam_ngay": "Hiệu lực bảo đảm dự thầu",
        "thoi_gian_thuc_hien": "Thời gian thực hiện",
        "ten_nha_thau": "Tên nhà thầu",
        "loai_nha_thau": "Loại nhà thầu",
        "danh_gia_hop_le": "Đánh giá tính hợp lệ",
        "danh_gia_nang_luc": "Đánh giá năng lực và kinh nghiệm",
        "danh_gia_ky_thuat": "Đánh giá kỹ thuật",
        "danh_gia_tai_chinh": "Đánh giá tài chính",
        "gia_xep_hang": "Giá xếp hạng",
        "gia_de_nghi_trung_thau": "Giá đề nghị trúng thầu",
        "chap_thuan_gia_de_nghi_trung_thau_duoi_50": "Chấp thuận giá đề nghị trúng thầu dưới 50%",
        "danh_gia_ket_luan": "Kết luận đánh giá",
        "ly_do_truot": "Lý do trượt thầu",
        "lam_ro_hop_le": "Làm rõ tính hợp lệ",
        "lam_ro_nang_luc": "Làm rõ năng lực và kinh nghiệm",
        "lam_ro_ky_thuat": "Làm rõ kỹ thuật",
        "lam_ro_tai_chinh": "Làm rõ tài chính",
        "nguyen_nhan_khong_dat_hop_le": "Nguyên nhân không đạt tính hợp lệ",
        "nguyen_nhan_khong_dat_nang_luc": "Nguyên nhân không đạt năng lực và kinh nghiệm",
        "nguyen_nhan_khong_dat_ky_thuat": "Nguyên nhân không đạt kỹ thuật",
    },
    "chuyen_gia": {
        "phien_ban": "Phiên bản dữ liệu",
        "ho_ten": "Họ tên chuyên gia",
        "so_chung_chi": "Số chứng chỉ chuyên gia",
        "ngay_cap_chung_chi": "Ngày cấp chứng chỉ chuyên gia",
        "don_vi_cap_chung_chi": "Đơn vị cấp chứng chỉ chuyên gia",
        "so_cccd": "Số CCCD chuyên gia",
        "ngay_cap_cccd": "Ngày cấp CCCD chuyên gia",
        "noi_cap_cccd": "Nơi cấp CCCD chuyên gia",
        "anh_chung_chi": "Ảnh chứng chỉ chuyên gia",
        "ten_anh_chung_chi": "Tên ảnh chứng chỉ chuyên gia",
        "anh_chu_ky": "Ảnh chữ ký chuyên gia",
        "ten_anh_chu_ky": "Tên ảnh chữ ký chuyên gia",
        "chuc_vu": "Chức vụ trong tổ chuyên gia / tổ thẩm định",
        "cong_viec": "Công việc được phân công",
    },
    "hop_dong": {
        "phien_ban": "Phiên bản dữ liệu",
        "ten_hop_dong": "Tên hợp đồng",
        "so_hop_dong": "Số hợp đồng",
        "ngay_ky": "Ngày ký hợp đồng",
        "ngay_thanh_ly": "Ngày thanh lý hợp đồng",
        "gia_tri": "Giá trị hợp đồng",
        "loai_hop_dong": "Loại hợp đồng",
        "thoi_gian_thuc_hien": "Thời gian thực hiện hợp đồng",
        "trang_thai_hop_dong": "Trạng thái hợp đồng",
        "phan_loai": "Phân loại hợp đồng",
        "co_qd_chi_dinh": "Có quyết định chỉ định thầu",
        "so_qd_chi_dinh": "Số quyết định chỉ định thầu",
        "ngay_qd_chi_dinh": "Ngày quyết định chỉ định thầu",
    },
    "tai_khoan": {
        "ten_dang_nhap": "Tên đăng nhập hệ thống",
        "ho_ten": "Họ tên tài khoản",
        "vai_tro": "Vai trò tài khoản",
        "email": "Email tài khoản",
        "anh_dai_dien": "Ảnh đại diện tài khoản",
        "da_xac_minh": "Trạng thái xác minh tài khoản",
    },
    "to_chuc": {
        "ten_to_chuc": "Tên tổ chức / Doanh nghiệp",
    },
    "goi_dich_vu": {
        "ten_goi": "Tên gói dịch vụ",
        "gia_ca": "Giá gói dịch vụ",
        "han_muc_nhan_su": "Hạn mức nhân sự tối đa",
        "mo_ta": "Mô tả chi tiết gói dịch vụ",
    },
    "__context__": {
        "tong_so_phan_lo": "Tổng số phần lô",
        "so_phan_lo_co_nha_thau_tham_du": "Số phần lô có nhà thầu tham dự",
        "so_phan_lo_khong_co_nha_thau_tham_du": "Số phần lô không có nhà thầu tham dự",
        "so_phan_lo_tham_du_khong_trung": "Số phần lô có nhà thầu tham dự nhưng không có nhà thầu trúng",
        "so_phan_lo_co_nha_thau_trung": "Số phần lô có nhà thầu trúng thầu",
        "tong_so_nha_thau_tham_du": "Tổng số nhà thầu tham dự",
        "so_nha_thau_trung_thau": "Số nhà thầu trúng thầu",
        "so_nha_thau_truot_thau": "Số nhà thầu trượt thầu",
        "so_nha_thau_khong_dat": "Số nhà thầu không đạt",
        "so_nha_thau_dat_khong_xep_hang_1": "Số nhà thầu đạt nhưng không xếp hạng 1",
        "so_nha_thau_khong_duoc_danh_gia": "Số nhà thầu không được đánh giá",
    },
}

LABEL_WORDS = {
    "anh": "Ảnh", "bao": "bảo", "cao": "cáo", "cap": "cấp",
    "chi": "chỉ", "chuc": "chức", "dai": "đại", "dang": "đăng",
    "dau": "đấu", "dia": "địa", "dien": "điện", "dong": "đóng",
    "du": "dự", "gia": "giá", "gian": "gian", "goi": "gói",
    "hop": "hợp", "ke": "kế", "ky": "ký", "lua": "lựa",
    "ma": "mã", "mo": "mở", "ngay": "ngày", "nguoi": "người",
    "nha": "nhà", "phe": "phê", "quyet": "quyết", "so": "số",
    "tai": "tài", "ten": "tên", "thau": "thầu", "thoi": "thời",
    "thuc": "thực", "tien": "tiền", "tinh": "tỉnh", "trang": "trạng",
    "tri": "trị", "xung": "xưng",
}


def _base_type(sql_type):
    normalized = str(sql_type or "TEXT").strip().upper()
    if normalized.startswith("INTEGER"):
        return "integer"
    if normalized.startswith(("REAL", "NUMERIC", "DECIMAL")):
        return "number"
    if normalized.startswith("BLOB"):
        return "binary"
    return "string"


def field_format(column_name):
    if column_name in DATETIME_COLUMNS:
        return "datetime"
    if column_name in DATE_ONLY_COLUMNS:
        return "date"
    if column_name in CURRENCY_COLUMNS:
        return "currency"
    if column_name in PERCENT_COLUMNS:
        return "percent"
    return "text"


def field_label(column_name, table_name=None):
    explicit_label = FIELD_LABELS_BY_TABLE.get(table_name, {}).get(column_name)
    if explicit_label:
        return explicit_label
    words = [LABEL_WORDS.get(part, part.upper() if len(part) <= 3 else part) for part in column_name.split("_")]
    return " ".join(words).capitalize()


def build_field_manifest(json_key_resolver, word_mappings=None):
    word_by_source = {}
    for mapping in word_mappings or []:
        source = (mapping.get("source_table"), mapping.get("source_column"))
        if source[0] in SCHEMA_DINH_NGHIA and source[1]:
            word_by_source[source] = mapping.get("ten_bien")

    tables = {}
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        fields = {}
        for column, sql_type in table_spec.get("columns", {}).items():
            fields[column] = {
                "column": column,
                "jsonKey": json_key_resolver(table_name, column),
                "dataType": _base_type(sql_type),
                "label": field_label(column, table_name),
                "format": field_format(column),
                "wordVariable": word_by_source.get((table_name, column)),
                "excelCompatible": _base_type(sql_type) != "binary",
            }
        tables[table_name] = {"fields": fields}
    return {"version": 1, "tables": tables}
