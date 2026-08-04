import hashlib

from .field_manifest import build_field_manifest, field_format, field_label
from .schema_contract import json_key_for_column
from backend.shared.workspace_scope import personal_scope_id


WORD_DEFAULT_MAPPINGS_VERSION = 14


WORD_SINGLE_SOURCES = {
    "chu_dau_tu": [
        "phien_ban",
        "ma_chu_dau_tu",
        "ten_chu_dau_tu",
        "ngay_ap_dung",
        "ten_viet_tat",
        "ma_so_thue",
        "chuc_vu_nguoi_dung_dau",
        "dai_dien_cdt",
        "chuc_vu_dai_dien",
        "danh_xung",
        "dia_chi",
        "so_dien_thoai",
        "so_tai_khoan",
        "noi_mo_tai_khoan",
        "email",
        "ma_qhns",
        "co_quan_chu_quan",
    ],
    "ke_hoach_lcnt": [
        "ma_ke_hoach",
        "ma_du_an",
        "phien_ban",
        "ten_ke_hoach",
        "ten_du_an_du_toan",
        "loai_hinh_mua_sam",
        "don_vi_trinh_cdt",
        "ten_viet_tat_don_vi_trinh",
        "tong_muc_dau_tu",
        "ngay_phe_duyet",
        "quyet_dinh_phe_duyet",
        "thoi_gian_dang_tai",
        "nguon_von",
        "thoi_gian_du_an",
        "dia_diem_quy_mo",
        "thong_tin_khac",
        "so_qd_phe_duyet_du_an",
        "ngay_qd_phe_duyet_du_an",
        "co_quan_phe_duyet_du_an",
        "phe_duyet",
        "so_to_trinh_du_toan",
        "ngay_trinh_du_toan",
        "ngay_phe_duyet_du_toan",
        "so_qd_phe_duyet_du_toan",
        "so_to_trinh_ke_hoach",
        "so_to_trinh_du_toan_ke_hoach",
        "ngay_trinh_ke_hoach",
    ],
    "goi_thau": [
        "ma_goi_thau",
        "phien_ban",
        "ten_goi_thau",
        "gia_goi_thau",
        "loai_hop_dong",
        "hinh_thuc_lua_chon",
        "phuong_thuc_lua_chon",
        "thoi_gian_thuc_hien",
        "nguon_von",
        "gia_trung_thau",
        "linh_vuc",
        "tuy_chon_mua_them",
        "thoi_gian_to_chuc",
        "thoi_gian_bat_dau_to_chuc",
        "phan_lo",
        "thoi_gian_dang_tai",
        "thoi_gian_dong_thau",
        "thoi_gian_mo_thau",
        "thoi_gian_mo_ehsdxtc",
        "so_quyet_dinh",
        "ngay_quyet_dinh",
        "so_quyet_dinh_ket_qua",
        "ngay_quyet_dinh_ket_qua",
        "thoi_gian_goi_thau",
        "thoi_gian_hop_dong",
        "gia_tri_dam_bao_du_thau",
        "hieu_luc_hsdt",
        "hieu_luc_dam_bao_du_thau",
        "phuong_phap_danh_gia",
        "trong_so_ky_thuat",
        "ty_le_bao_dam_hop_dong",
        "is_thuoc",
        "trang_thai",
        "yeu_cau_tham_dinh_hsmt",
        "so_bao_cao_tham_dinh_hsmt",
        "ngay_bao_cao_tham_dinh_hsmt",
        "so_to_trinh_hsmt",
        "ngay_trinh_hsmt",
        "ngay_moi_doi_chieu",
        "ngay_doi_chieu",
        "qua_mang",
        "trong_nuoc_quoc_te",
        "is_rebid",
    ],
    "nha_thau": [
        "phien_ban",
        "ma_nha_thau",
        "ten_nha_thau",
        "ngay_ap_dung",
        "ten_viet_tat",
        "loai_nha_thau",
        "ma_so_thue",
        "nguoi_dai_dien",
        "chuc_vu_dai_dien",
        "danh_xung",
        "so_dien_thoai",
        "email",
        "dia_chi",
        "so_tai_khoan",
        "noi_mo_tai_khoan",
        "ma_ngan_hang",
        "anh_dau",
        "ten_anh_dau",
    ],
    "thong_tin_mo_thau": [
        "ma_phan_lo",
        "ten_phan_lo",
        "ma_dinh_danh",
        "gia_du_thau",
        "ty_le_giam_gia",
        "gia_sau_giam_gia",
        "hieu_luc_hsdt",
        "gia_tri_dam_bao",
        "hieu_luc_bao_dam_ngay",
        "thoi_gian_thuc_hien",
        "ten_nha_thau",
        "loai_nha_thau",
        "danh_gia_hop_le",
        "danh_gia_nang_luc",
        "danh_gia_ky_thuat",
        "danh_gia_tai_chinh",
        "gia_xep_hang",
        "gia_de_nghi_trung_thau",
        "chap_thuan_gia_de_nghi_trung_thau_duoi_50",
        "danh_gia_ket_luan",
        "ly_do_truot",
        "lam_ro_hop_le",
        "lam_ro_nang_luc",
        "lam_ro_ky_thuat",
        "lam_ro_tai_chinh",
        "nguyen_nhan_khong_dat_hop_le",
        "nguyen_nhan_khong_dat_nang_luc",
        "nguyen_nhan_khong_dat_ky_thuat",
    ],
    "chuyen_gia": [
        "phien_ban",
        "ho_ten",
        "so_chung_chi",
        "ngay_cap_chung_chi",
        "don_vi_cap_chung_chi",
        "so_cccd",
        "ngay_cap_cccd",
        "noi_cap_cccd",
        "anh_chung_chi",
        "ten_anh_chung_chi",
        "anh_chu_ky",
        "ten_anh_chu_ky",
        "chuc_vu",
        "cong_viec",
    ],
    "hop_dong": [
        "phien_ban",
        "ten_hop_dong",
        "so_hop_dong",
        "ngay_ky",
        "ngay_thanh_ly",
        "gia_tri",
        "loai_hop_dong",
        "thoi_gian_thuc_hien",
        "trang_thai_hop_dong",
        "phan_loai",
        "co_qd_chi_dinh",
        "so_qd_chi_dinh",
        "ngay_qd_chi_dinh",
    ],
    "tai_khoan": [
        "ten_dang_nhap",
        "ho_ten",
        "vai_tro",
        "email",
        "anh_dai_dien",
        "da_xac_minh",
    ],
    "to_chuc": [
        "ten_to_chuc",
    ],
    "goi_dich_vu": [
        "ten_goi",
        "gia_ca",
        "han_muc_nhan_su",
        "mo_ta",
    ],
}


WORD_SINGLE_PREFIXES = {
    "chu_dau_tu": "cdt",
    "ke_hoach_lcnt": "kh",
    "goi_thau": "gt",
    "nha_thau": "nt",
    "thong_tin_mo_thau": "mt",
    "chuyen_gia": "cg",
    "hop_dong": "hd",
    "tai_khoan": "tk",
    "to_chuc": "tc",
    "goi_dich_vu": "gdv",
}

WORD_SINGLE_NAME_OVERRIDES = {
    ("chu_dau_tu", "ma_chu_dau_tu"): "ma_cdt",
    ("chu_dau_tu", "ten_chu_dau_tu"): "ten_cdt",
    ("chu_dau_tu", "ngay_ap_dung"): "ngay_ap_dung_cdt",
    ("chu_dau_tu", "ten_viet_tat"): "ten_tat_cdt",
    ("chu_dau_tu", "ma_so_thue"): "mst_cdt",
    ("chu_dau_tu", "chuc_vu_nguoi_dung_dau"): "chuc_vu_nguoi_dung_dau_cdt",
    ("chu_dau_tu", "dai_dien_cdt"): "dai_dien_cdt",
    ("chu_dau_tu", "chuc_vu_dai_dien"): "chuc_vu_dai_dien_cdt",
    ("chu_dau_tu", "danh_xung"): "danh_xung_cdt",
    ("chu_dau_tu", "dia_chi"): "dia_chi_cdt",
    ("chu_dau_tu", "so_dien_thoai"): "sdt_cdt",
    ("chu_dau_tu", "so_tai_khoan"): "stk_cdt",
    ("chu_dau_tu", "noi_mo_tai_khoan"): "noi_mo_tk_cdt",
    ("chu_dau_tu", "email"): "email_cdt",
    ("chu_dau_tu", "co_quan_chu_quan"): "cq_chu_quan",

    ("ke_hoach_lcnt", "ma_ke_hoach"): "ma_kh",
    ("ke_hoach_lcnt", "ten_ke_hoach"): "ten_kh",
    ("ke_hoach_lcnt", "ma_du_an"): "ma_du_an",
    ("ke_hoach_lcnt", "ten_du_an_du_toan"): "ten_du_an_du_toan",
    ("ke_hoach_lcnt", "loai_hinh_mua_sam"): "loai_ke_hoach",
    ("ke_hoach_lcnt", "don_vi_trinh_cdt"): "don_vi_trinh_cdt",
    ("ke_hoach_lcnt", "ten_viet_tat_don_vi_trinh"): "ten_tat_dv_trinh",
    ("ke_hoach_lcnt", "tong_muc_dau_tu"): "tong_muc_dau_tu_du_toan",
    ("ke_hoach_lcnt", "ngay_phe_duyet"): "ngay_phe_duyet_kh",
    ("ke_hoach_lcnt", "quyet_dinh_phe_duyet"): "qd_phe_duyet_kh",
    ("ke_hoach_lcnt", "thoi_gian_dang_tai"): "tg_dang_tai_kh",
    ("ke_hoach_lcnt", "thoi_gian_du_an"): "tg_du_an",
    ("ke_hoach_lcnt", "dia_diem_quy_mo"): "dia_diem_quy_mo",
    ("ke_hoach_lcnt", "thong_tin_khac"): "thong_tin_khac_kh",
    ("ke_hoach_lcnt", "so_qd_phe_duyet_du_an"): "so_qd_du_an",
    ("ke_hoach_lcnt", "ngay_qd_phe_duyet_du_an"): "ngay_qd_du_an",
    ("ke_hoach_lcnt", "co_quan_phe_duyet_du_an"): "cq_phe_duyet_du_an",
    ("ke_hoach_lcnt", "phe_duyet"): "nguoi_phe_duyet_kh",
    ("ke_hoach_lcnt", "so_to_trinh_du_toan"): "so_ttr_du_toan",
    ("ke_hoach_lcnt", "ngay_trinh_du_toan"): "ngay_trinh_du_toan",
    ("ke_hoach_lcnt", "ngay_phe_duyet_du_toan"): "ngay_phe_duyet_du_toan",
    ("ke_hoach_lcnt", "so_qd_phe_duyet_du_toan"): "so_qd_du_toan",
    ("ke_hoach_lcnt", "so_to_trinh_ke_hoach"): "so_ttr_ke_hoach",
    ("ke_hoach_lcnt", "so_to_trinh_du_toan_ke_hoach"): "so_ttr_du_toan_ke_hoach",
    ("ke_hoach_lcnt", "ngay_trinh_ke_hoach"): "ngay_trinh_kh",

    ("goi_thau", "ma_goi_thau"): "ma_gt",
    ("goi_thau", "ten_goi_thau"): "ten_gt",
    ("goi_thau", "gia_goi_thau"): "gia_gt",
    ("goi_thau", "loai_hop_dong"): "loai_hd_gt",
    ("goi_thau", "hinh_thuc_lua_chon"): "hinh_thuc_lcnt",
    ("goi_thau", "phuong_thuc_lua_chon"): "phuong_thuc_lcnt",
    ("goi_thau", "thoi_gian_thuc_hien"): "tg_thuc_hien_gt",
    ("goi_thau", "gia_trung_thau"): "gia_trung_thau",
    ("goi_thau", "tuy_chon_mua_them"): "co_mua_them",
    ("goi_thau", "thoi_gian_to_chuc"): "tg_to_chuc_lcnt",
    ("goi_thau", "thoi_gian_bat_dau_to_chuc"): "tg_bat_dau_lcnt",
    ("goi_thau", "thoi_gian_dang_tai"): "tg_dang_tai_tbmt",
    ("goi_thau", "thoi_gian_dong_thau"): "tg_dong_thau",
    ("goi_thau", "thoi_gian_mo_thau"): "tg_mo_thau",
    ("goi_thau", "thoi_gian_mo_ehsdxtc"): "tg_mo_ehsdxtc",
    ("goi_thau", "so_quyet_dinh"): "so_qd_hsmt",
    ("goi_thau", "ngay_quyet_dinh"): "ngay_qd_hsmt",
    ("goi_thau", "so_quyet_dinh_ket_qua"): "so_qd_kq",
    ("goi_thau", "ngay_quyet_dinh_ket_qua"): "ngay_qd_kq",
    ("goi_thau", "thoi_gian_goi_thau"): "tg_goi_thau",
    ("goi_thau", "thoi_gian_hop_dong"): "tg_hop_dong",
    ("goi_thau", "gia_tri_dam_bao_du_thau"): "gia_tri_bddt",
    ("goi_thau", "hieu_luc_hsdt"): "hieu_luc_hsdt",
    ("goi_thau", "hieu_luc_dam_bao_du_thau"): "hieu_luc_bddt",
    ("goi_thau", "phuong_phap_danh_gia"): "pp_danh_gia",
    ("goi_thau", "trong_so_ky_thuat"): "trong_so_ky_thuat",
    ("goi_thau", "ty_le_bao_dam_hop_dong"): "ty_le_bdhdt",
    ("goi_thau", "yeu_cau_tham_dinh_hsmt"): "yc_tham_dinh_hsmt",
    ("goi_thau", "so_bao_cao_tham_dinh_hsmt"): "so_bc_tham_dinh_hsmt",
    ("goi_thau", "ngay_bao_cao_tham_dinh_hsmt"): "ngay_bc_tham_dinh_hsmt",
    ("goi_thau", "so_to_trinh_hsmt"): "so_ttr_hsmt",
    ("goi_thau", "ngay_trinh_hsmt"): "ngay_trinh_hsmt",
    ("goi_thau", "ngay_moi_doi_chieu"): "ngay_moi_doi_chieu",
    ("goi_thau", "ngay_doi_chieu"): "ngay_doi_chieu",

    ("nha_thau", "ma_nha_thau"): "ma_nt",
    ("nha_thau", "ten_nha_thau"): "ten_nt",
    ("nha_thau", "ngay_ap_dung"): "ngay_ap_dung_nt",
    ("nha_thau", "ten_viet_tat"): "ten_tat_nt",
    ("nha_thau", "loai_nha_thau"): "loai_nt",
    ("nha_thau", "ma_so_thue"): "mst_nt",
    ("nha_thau", "nguoi_dai_dien"): "dai_dien_nt",
    ("nha_thau", "chuc_vu_dai_dien"): "chuc_vu_dai_dien_nt",
    ("nha_thau", "danh_xung"): "danh_xung_nt",
    ("nha_thau", "so_dien_thoai"): "sdt_nt",
    ("nha_thau", "email"): "email_nt",
    ("nha_thau", "dia_chi"): "dia_chi_nt",
    ("nha_thau", "so_tai_khoan"): "stk_nt",
    ("nha_thau", "noi_mo_tai_khoan"): "noi_mo_tk_nt",
    ("nha_thau", "ma_ngan_hang"): "ma_ngan_hang_nt",
    ("nha_thau", "anh_dau"): "anh_dau_nt",
    ("nha_thau", "ten_anh_dau"): "ten_anh_dau_nt",

    ("thong_tin_mo_thau", "ma_phan_lo"): "mt_ma_phan_lo",
    ("thong_tin_mo_thau", "ten_phan_lo"): "mt_ten_phan_lo",
    ("thong_tin_mo_thau", "ma_dinh_danh"): "mt_ma_dinh_danh",
    ("thong_tin_mo_thau", "gia_du_thau"): "mt_gia_du_thau",
    ("thong_tin_mo_thau", "ty_le_giam_gia"): "mt_ty_le_giam_gia",
    ("thong_tin_mo_thau", "gia_sau_giam_gia"): "mt_gia_sau_giam_gia",
    ("thong_tin_mo_thau", "hieu_luc_hsdt"): "mt_hieu_luc_hsdt",
    ("thong_tin_mo_thau", "gia_tri_dam_bao"): "mt_gia_tri_dam_bao",
    ("thong_tin_mo_thau", "hieu_luc_bao_dam_ngay"): "mt_hieu_luc_bao_dam_ngay",
    ("thong_tin_mo_thau", "thoi_gian_thuc_hien"): "mt_tg_thuc_hien",
    ("thong_tin_mo_thau", "ten_nha_thau"): "mt_ten_nt",
    ("thong_tin_mo_thau", "loai_nha_thau"): "mt_loai_nt",
    ("thong_tin_mo_thau", "danh_gia_hop_le"): "mt_dg_hop_le",
    ("thong_tin_mo_thau", "danh_gia_nang_luc"): "mt_dg_nang_luc",
    ("thong_tin_mo_thau", "danh_gia_ky_thuat"): "mt_dg_ky_thuat",
    ("thong_tin_mo_thau", "danh_gia_tai_chinh"): "mt_dg_tai_chinh",
    ("thong_tin_mo_thau", "gia_xep_hang"): "mt_gia_xep_hang",
    ("thong_tin_mo_thau", "gia_de_nghi_trung_thau"): "mt_gia_de_nghi_trung_thau",
    ("thong_tin_mo_thau", "chap_thuan_gia_de_nghi_trung_thau_duoi_50"): "mt_chap_thuan_gia_duoi_50",
    ("thong_tin_mo_thau", "danh_gia_ket_luan"): "mt_dg_ket_luan",
    ("thong_tin_mo_thau", "ly_do_truot"): "mt_ly_do_truot",
    ("thong_tin_mo_thau", "lam_ro_hop_le"): "mt_lam_ro_hop_le",
    ("thong_tin_mo_thau", "lam_ro_nang_luc"): "mt_lam_ro_nang_luc",
    ("thong_tin_mo_thau", "lam_ro_ky_thuat"): "mt_lam_ro_ky_thuat",
    ("thong_tin_mo_thau", "lam_ro_tai_chinh"): "mt_lam_ro_tai_chinh",
    ("thong_tin_mo_thau", "nguyen_nhan_khong_dat_hop_le"): "mt_nn_khong_dat_hop_le",
    ("thong_tin_mo_thau", "nguyen_nhan_khong_dat_nang_luc"): "mt_nn_khong_dat_nang_luc",
    ("thong_tin_mo_thau", "nguyen_nhan_khong_dat_ky_thuat"): "mt_nn_khong_dat_ky_thuat",

    ("chuyen_gia", "ho_ten"): "ten_cg",
    ("chuyen_gia", "so_chung_chi"): "so_chung_chi_cg",
    ("chuyen_gia", "ngay_cap_chung_chi"): "ngay_cap_chung_chi_cg",
    ("chuyen_gia", "don_vi_cap_chung_chi"): "dv_cap_chung_chi_cg",
    ("chuyen_gia", "so_cccd"): "cccd_cg",
    ("chuyen_gia", "ngay_cap_cccd"): "ngay_cap_cccd_cg",
    ("chuyen_gia", "noi_cap_cccd"): "noi_cap_cccd_cg",
    ("chuyen_gia", "anh_chung_chi"): "anh_chung_chi_cg",
    ("chuyen_gia", "ten_anh_chung_chi"): "ten_anh_chung_chi_cg",
    ("chuyen_gia", "anh_chu_ky"): "anh_chu_ky_cg",
    ("chuyen_gia", "ten_anh_chu_ky"): "ten_anh_chu_ky_cg",
    ("chuyen_gia", "chuc_vu"): "chuc_vu_cg",
    ("chuyen_gia", "cong_viec"): "cong_viec_cg",

    ("hop_dong", "ten_hop_dong"): "ten_hd",
    ("hop_dong", "so_hop_dong"): "so_hd",
    ("hop_dong", "ngay_ky"): "ngay_ky_hd",
    ("hop_dong", "ngay_thanh_ly"): "ngay_thanh_ly_hd",
    ("hop_dong", "loai_hop_dong"): "loai_hd",
    ("hop_dong", "thoi_gian_thuc_hien"): "tg_thuc_hien_hd",
    ("hop_dong", "trang_thai_hop_dong"): "trang_thai_hd",
    ("hop_dong", "co_qd_chi_dinh"): "co_qd_chi_dinh",
    ("hop_dong", "so_qd_chi_dinh"): "so_qd_chi_dinh",
    ("hop_dong", "ngay_qd_chi_dinh"): "ngay_qd_chi_dinh",

    ("tai_khoan", "ten_dang_nhap"): "tk_ten_dang_nhap",
    ("tai_khoan", "ho_ten"): "tk_ho_ten",
    ("tai_khoan", "vai_tro"): "tk_vai_tro",
    ("tai_khoan", "anh_dai_dien"): "tk_anh_dai_dien",
    ("tai_khoan", "da_xac_minh"): "tk_da_xac_minh",

    ("to_chuc", "ten_to_chuc"): "ten_to_chuc",
    ("goi_dich_vu", "ten_goi"): "ten_goi_dv",
    ("goi_dich_vu", "gia_ca"): "gia_goi_dv",
    ("goi_dich_vu", "han_muc_nhan_su"): "han_muc_nhan_su_dv",
    ("goi_dich_vu", "mo_ta"): "mo_ta_goi_dv",
}


WORD_LIST_MAPPINGS = [
    ("ds_gt", "goi_thau_trong_ke_hoach", "Danh sách gói thầu của kế hoạch"),
    ("ds_phien_ban_gt", "goi_thau_versions", "Danh sách phiên bản của gói thầu"),
    ("ds_phien_ban_kh", "ke_hoach_versions", "Danh sách phiên bản của kế hoạch LCNT"),
    ("ds_to_chuyen_gia", "to_chuyen_gia", "Tổ chuyên gia của gói thầu"),
    ("ds_to_tham_dinh", "to_tham_dinh", "Tổ thẩm định của gói thầu"),
    ("ds_mo_thau", "thong_tin_mo_thau", "Danh sách thông tin mở thầu"),
    ("ds_bao_cao_dgct", "detailed_evaluation_reports", "Báo cáo đánh giá chi tiết theo nhà thầu và vòng"),
    ("ds_dgct", "detailed_evaluation_rows", "Tất cả dòng đánh giá chi tiết"),
    ("ds_dgct_hop_le", "detailed_evaluation_validity_rows", "Đánh giá chi tiết tính hợp lệ"),
    ("ds_dgct_nang_luc", "detailed_evaluation_capacity_rows", "Đánh giá chi tiết năng lực và kinh nghiệm"),
    ("ds_dgct_ky_thuat", "detailed_evaluation_technical_rows", "Đánh giá chi tiết kỹ thuật"),
    ("ds_dgct_tai_chinh", "detailed_evaluation_financial_rows", "Đánh giá chi tiết tài chính"),
    ("ds_tat_ca_phan_lo", "ds_phan_lo", "Danh sách phần lô tổng hợp"),
    ("ds_lo_co_nt", "ds_phan_lo_co_nha_thau_tham_du", "Phần lô có nhà thầu tham dự"),
    ("ds_lo_khong_nt", "ds_phan_lo_khong_co_nha_thau_tham_du", "Phần lô không có nhà thầu tham dự"),
    ("ds_lo_co_nt_trung", "ds_phan_lo_co_nha_thau_trung", "Phần lô có nhà thầu trúng thầu"),
    ("ds_lo_co_nt_khong_trung", "ds_phan_lo_co_nha_thau_tham_du_khong_trung", "Phần lô có nhà thầu tham dự nhưng không có nhà thầu trúng"),
    ("ds_nt_tham_du", "ds_nha_thau_tham_du", "Danh sách nhà thầu tham dự"),
    ("ds_nt_trung", "ds_nha_thau_trung_thau", "Danh sách nhà thầu trúng thầu"),
    ("ds_nt_truot", "ds_nha_thau_truot_thau", "Danh sách nhà thầu trượt thầu"),
    ("ds_nt_khong_dat", "ds_nha_thau_khong_dat", "Danh sách nhà thầu không đạt"),
    ("ds_nt_dat_khong_hang_1", "ds_nha_thau_dat_khong_xep_hang_1", "Nhà thầu đạt nhưng không xếp hạng 1"),
    ("ds_nt_khong_danh_gia", "ds_nha_thau_khong_duoc_danh_gia", "Nhà thầu không được đánh giá"),
    ("ds_nt_trung_kem_lo", "ds_nha_thau_trung_theo_phan_lo", "Nhà thầu trúng thầu, kèm danh sách phần lô trúng"),
    ("ds_mua_them", "tuy_chon_mua_them_list", "Danh sách tùy chọn mua thêm"),
    ("ds_gia_han", "gia_han_list", "Danh sách gia hạn"),
    ("ds_yc_lam_ro", "yeu_cau_lam_ro_list", "Danh sách yêu cầu làm rõ"),
    ("ds_tl_lam_ro", "tra_loi_lam_ro_list", "Danh sách trả lời làm rõ"),
    ("ds_tv_lien_danh", "thanh_vien_lien_danh", "Danh sách thành viên liên danh"),
    ("ds_cv_da_thuc_hien", "cv_da_thuc_hien", "Danh sách công việc đã thực hiện"),
    ("ds_cv_khong_ap_dung", "cv_khong_ap_dung", "Danh sách công việc không áp dụng LCNT"),
    ("ds_cv_chua_du_dk", "cv_chua_du_dieu_kien", "Danh sách công việc chưa đủ điều kiện LCNT"),
]


WORD_CONTEXT_MAPPINGS = [
    ("tong_so_lo", "tong_so_phan_lo", "Tổng số phần lô"),
    ("so_lo_co_nt", "so_phan_lo_co_nha_thau_tham_du", "Số phần lô có nhà thầu tham dự"),
    ("so_lo_khong_nt", "so_phan_lo_khong_co_nha_thau_tham_du", "Số phần lô không có nhà thầu tham dự"),
    ("so_lo_co_nt_khong_trung", "so_phan_lo_tham_du_khong_trung", "Số phần lô có nhà thầu tham dự nhưng không có nhà thầu trúng"),
    ("so_lo_co_nt_trung", "so_phan_lo_co_nha_thau_trung", "Số phần lô có nhà thầu trúng thầu"),
    ("tong_so_nt_tham_du", "tong_so_nha_thau_tham_du", "Tổng số nhà thầu tham dự"),
    ("so_nt_trung", "so_nha_thau_trung_thau", "Số nhà thầu trúng thầu"),
    ("so_nt_truot", "so_nha_thau_truot_thau", "Số nhà thầu trượt thầu"),
    ("so_nt_khong_dat", "so_nha_thau_khong_dat", "Số nhà thầu không đạt"),
    ("so_nt_dat_khong_hang_1", "so_nha_thau_dat_khong_xep_hang_1", "Số nhà thầu đạt nhưng không xếp hạng 1"),
    ("so_nt_khong_danh_gia", "so_nha_thau_khong_duoc_danh_gia", "Số nhà thầu không được đánh giá"),
]


def _stable_word_mapping_id(organization_id, ten_bien):
    digest = hashlib.sha256(
        f"{organization_id}:{ten_bien}".encode("utf-8")
    ).hexdigest()[:16]
    return f"wdef-{digest}"


def _default_single_name(source_table, column):
    return WORD_SINGLE_NAME_OVERRIDES.get((source_table, column), f"{WORD_SINGLE_PREFIXES[source_table]}_{column}")


def _is_default_mapping_description(description):
    normalized = str(description or "").casefold()
    return any(
        marker in normalized
        for marker in (
            "mac dinh tu cau_truc_db.md",
            "mac dinh tu schema he thong",
            "mặc định từ schema hệ thống",
        )
    )


def build_default_word_mappings():
    mappings = []
    field_manifest = build_field_manifest(json_key_for_column)
    for source_table, columns in WORD_SINGLE_SOURCES.items():
        for column in columns:
            field = field_manifest["tables"].get(source_table, {}).get("fields", {}).get(column)
            if not field:
                field = {
                    "format": field_format(column),
                    "label": field_label(column, source_table),
                }
            mappings.append({
                "mapping_key": f"field:{source_table}.{column}",
                "ten_bien": _default_single_name(source_table, column),
                "source_table": source_table,
                "source_column": column,
                "format": field["format"],
                "mo_ta": f"Biến đơn mặc định từ schema hệ thống: {source_table}.{column}",
            })

    for ten_bien, source_table, mo_ta in WORD_CONTEXT_MAPPINGS:
        mappings.append({
            "mapping_key": f"context:{source_table}",
            "ten_bien": ten_bien,
            "source_table": "__context__",
            "source_column": source_table,
            "mo_ta": f"Thực thể động mặc định từ schema hệ thống: {mo_ta}",
        })

    for ten_bien, source_table, mo_ta in WORD_LIST_MAPPINGS:
        mappings.append({
            "mapping_key": f"list:{source_table}",
            "ten_bien": ten_bien,
            "source_table": source_table,
            "source_column": "",
            "mo_ta": f"Danh sách mặc định từ schema hệ thống: {mo_ta}",
        })

    return mappings


def ensure_default_word_mappings(cursor, organization_id):
    """Compatibility no-op: defaults are now resolved from the shared catalog."""

    del cursor, organization_id
    return 0


def ensure_personal_word_workspace(cursor, user_id):
    """Create the personal sync scope and default Word variables for an account."""

    user_id = str(user_id or "").strip()
    if not user_id:
        return 0
    account = cursor.execute(
        "SELECT 1 FROM tai_khoan WHERE id = ? AND vai_tro != 'super_admin'",
        (user_id,),
    ).fetchone()
    if not account:
        return 0
    scope_id = personal_scope_id(user_id)
    cursor.execute(
        """INSERT INTO sync_metadata (organization_id, current_version)
           VALUES (?, 1)
           ON CONFLICT (organization_id) DO NOTHING""",
        (scope_id,),
    )
    return 0
