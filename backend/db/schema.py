import re


MONEY_COLUMNS = frozenset({
    ("goi_dich_vu", "gia_ca"),
    ("ke_hoach_lcnt", "tong_muc_dau_tu"),
    ("ke_hoach_cong_viec", "gia_tri"),
    ("goi_thau", "gia_goi_thau"),
    ("goi_thau", "gia_trung_thau"),
    ("goi_thau", "gia_tri_dam_bao_du_thau"),
    ("goi_thau_phan_lo", "gia_tri_phan_lo"),
    ("goi_thau_phan_lo", "bao_dam_du_thau"),
    ("goi_thau_phan_lo", "gia_trung_thau"),
    ("goi_thau_tuy_chon_mua_them", "gia_tri_uoc_tinh"),
    ("hop_dong", "gia_tri"),
    ("thong_tin_mo_thau", "gia_du_thau"),
    ("thong_tin_mo_thau", "gia_sau_giam_gia"),
    ("thong_tin_mo_thau", "gia_tri_dam_bao"),
})


SCHEMA_DINH_NGHIA = {
    "goi_dich_vu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_goi": "TEXT",
            "gia_ca": "INTEGER NOT NULL CHECK(typeof(gia_ca) = 'integer' AND gia_ca >= 0)",
            "han_muc_nhan_su": "INTEGER NOT NULL CHECK(han_muc_nhan_su > 0)",
            "trang_thai": "TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai IN ('active', 'inactive'))",
            "mo_ta": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "tai_khoan": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_dang_nhap": "TEXT",
            "username_norm": "TEXT UNIQUE",
            "mat_khau": "TEXT NOT NULL",
            "ho_ten": "TEXT",
            "vai_tro": "TEXT NOT NULL DEFAULT 'user' CHECK(vai_tro IN ('super_admin', 'user'))",
            "email": "TEXT NOT NULL",
            "email_norm": "TEXT NOT NULL UNIQUE CHECK(email_norm != '')",
            "token_phien": "TEXT",
            "anh_dai_dien": "TEXT",
            "han_su_dung_token": "INTEGER",
            "privileged_reauth_at": "INTEGER",
            "thong_tin_thiet_bi_cuoi": "TEXT",
            "da_xac_minh": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(da_xac_minh) = 'integer' AND da_xac_minh IN (0,1))",
            "ma_xac_minh": "TEXT",
            "han_xac_minh": "INTEGER",
            "username_da_dat": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(username_da_dat) = 'integer' AND username_da_dat IN (0,1))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "field_map": {
            "ma_so_thue": "maSoThue",
            "so_cccd": "soCCCD",
            "ma_qhns": "maQHNS",
            "id_goc": "rootId"
        }
    },
    "dinh_danh_ngoai": {
        "columns": {
            "issuer": "TEXT NOT NULL",
            "subject": "TEXT NOT NULL",
            "user_id": "TEXT NOT NULL",
            "email_norm": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "primary_keys": ["issuer", "subject"],
        "unique_constraints": ["UNIQUE (user_id, issuer)"],
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "password_reset_tokens": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT NOT NULL",
            "token_hash": "TEXT NOT NULL UNIQUE",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > 0)",
            "used_at": "INTEGER",
            "requested_ip": "TEXT",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "rate_limit_buckets": {
        "columns": {
            "bucket_key": "TEXT PRIMARY KEY",
            "window_started_at": "INTEGER NOT NULL",
            "attempt_count": "INTEGER NOT NULL CHECK(attempt_count >= 0)",
            "expires_at": "INTEGER NOT NULL"
        }
    },
    "websocket_events": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "event_type": "TEXT NOT NULL CHECK(event_type IN ('broadcast', 'revoke_user'))",
            "organization_id": "TEXT",
            "user_id": "TEXT",
            "payload_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
    "chu_dau_tu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ngay_ap_dung": "TEXT NOT NULL DEFAULT (date('now'))",
            "ma_chu_dau_tu": "TEXT",
            "ten_chu_dau_tu": "TEXT NOT NULL",
            "ten_viet_tat": "TEXT",
            "ma_so_thue": "TEXT",
            "chuc_vu_nguoi_dung_dau": "TEXT",
            "dai_dien_cdt": "TEXT",
            "chuc_vu_dai_dien": "TEXT",
            "danh_xung": "TEXT DEFAULT 'Ông'",
            "dia_chi": "TEXT",
            "dia_chi_goc": "TEXT",
            "so_dien_thoai": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "email": "TEXT",
            "ma_qhns": "TEXT",
            "co_quan_chu_quan": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "field_map": {
            "ma_qhns": "maQHNS"
        }
    },
    "ke_hoach_lcnt": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "ma_ke_hoach": "TEXT",
            "ma_du_an": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ten_ke_hoach": "TEXT NOT NULL",
            "ten_du_an_du_toan": "TEXT",
            "loai_hinh_mua_sam": "TEXT",
            "chu_dau_tu_id": "TEXT",
            "don_vi_trinh_cdt": "TEXT",
            "ten_viet_tat_don_vi_trinh": "TEXT",
            "tong_muc_dau_tu": "INTEGER CHECK(tong_muc_dau_tu IS NULL OR (typeof(tong_muc_dau_tu) = 'integer' AND tong_muc_dau_tu >= 0))",
            "is_tong_muc_tu_dong": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_tong_muc_tu_dong) = 'integer' AND is_tong_muc_tu_dong IN (0,1))",
            "ngay_phe_duyet": "TEXT",
            "quyet_dinh_phe_duyet": "TEXT",
            "thoi_gian_dang_tai": "TEXT",
            "nguon_von": "TEXT",
            "thoi_gian_du_an": "TEXT",
            "dia_diem_quy_mo": "TEXT",
            "thong_tin_khac": "TEXT",
            "so_qd_phe_duyet_du_an": "TEXT",
            "ngay_qd_phe_duyet_du_an": "TEXT",
            "co_quan_phe_duyet_du_an": "TEXT",
            "phe_duyet": "TEXT",
            "ngay_trinh_du_toan": "TEXT",
            "ngay_phe_duyet_du_toan": "TEXT",
            "so_qd_phe_duyet_du_toan": "TEXT",
            "ngay_trinh_ke_hoach": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "foreign_keys": ["FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT"],
        "field_map": {
            "thoi_gian_dang_tai": "thoiGianDangMa",
            "don_vi_trinh_cdt": "donViTrinhCdt",
            "ten_viet_tat_don_vi_trinh": "tenVietTatDonViTrinh",
            "phe_duyet": "pheDuyet",
            "ngay_trinh_du_toan": "ngayTrinhDuToan",
            "ngay_phe_duyet_du_toan": "ngayPheDuyetDuToan",
            "so_qd_phe_duyet_du_toan": "soQdPheDuyetDuToan",
            "ngay_trinh_ke_hoach": "ngayTrinhKeHoach"
        }
    },
    "ke_hoach_cong_viec": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "ke_hoach_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL CHECK(loai IN ('da_thuc_hien', 'khong_ap_dung', 'chua_du_dieu_kien'))",
            "ten_cong_viec": "TEXT",
            "gia_tri": "INTEGER CHECK(gia_tri IS NULL OR (typeof(gia_tri) = 'integer' AND gia_tri >= 0))",
            "don_vi_thuc_hien": "TEXT",
            "van_ban_phe_duyet": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT"
        ]
    },
    "nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ngay_ap_dung": "TEXT NOT NULL DEFAULT (date('now'))",
            "ma_nha_thau": "TEXT",
            "ten_nha_thau": "TEXT NOT NULL",
            "ten_viet_tat": "TEXT",
            "loai_nha_thau": "TEXT",
            "ma_so_thue": "TEXT",
            "nguoi_dai_dien": "TEXT",
            "chuc_vu_dai_dien": "TEXT",
            "danh_xung": "TEXT DEFAULT 'Ông'",
            "so_dien_thoai": "TEXT",
            "email": "TEXT",
            "dia_chi": "TEXT",
            "dia_chi_goc": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "ma_ngan_hang": "TEXT",
            "anh_dau": "TEXT",
            "ten_anh_dau": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "nha_thau_lien_danh_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "nha_thau_id": "TEXT NOT NULL",
            "thanh_vien_nha_thau_id": "TEXT",
            "ten_nha_thau": "TEXT",
            "ma_nha_thau": "TEXT",
            "ma_so_thue": "TEXT",
            "vai_tro": "TEXT",
            "nguoi_dai_dien": "TEXT",
            "danh_xung": "TEXT",
            "so_dien_thoai": "TEXT",
            "email": "TEXT",
            "dia_chi": "TEXT",
            "dia_chi_goc": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "ma_ngan_hang": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (thanh_vien_nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ]
    },
    "goi_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "ma_goi_thau": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ke_hoach_id": "TEXT",
            "ten_goi_thau": "TEXT NOT NULL",
            "gia_goi_thau": "INTEGER CHECK(gia_goi_thau IS NULL OR (typeof(gia_goi_thau) = 'integer' AND gia_goi_thau >= 0))",
            "loai_hop_dong": "TEXT",
            "hinh_thuc_lua_chon": "TEXT",
            "phuong_thuc_lua_chon": "TEXT",
            "thoi_gian_thuc_hien": "TEXT",
            "nguon_von": "TEXT",
            "nha_thau_trung_thau_id": "TEXT",
            "gia_trung_thau": "INTEGER CHECK(gia_trung_thau IS NULL OR (typeof(gia_trung_thau) = 'integer' AND gia_trung_thau >= 0))",
            "linh_vuc": "TEXT",
            "tuy_chon_mua_them": "TEXT DEFAULT 'Không' CHECK(tuy_chon_mua_them IN ('Có', 'Không') OR tuy_chon_mua_them IS NULL)",
            "thoi_gian_to_chuc": "TEXT",
            "thoi_gian_bat_dau_to_chuc": "TEXT",
            "phan_lo": "TEXT DEFAULT 'Không' CHECK(phan_lo IN ('Có', 'Không') OR phan_lo IS NULL)",
            "thoi_gian_dang_tai": "TEXT",
            "thoi_gian_dong_thau": "TEXT",
            "thoi_gian_mo_thau": "TEXT",
            "thoi_gian_mo_ehsdxtc": "TEXT",
            "so_quyet_dinh": "TEXT",
            "ngay_quyet_dinh": "TEXT",
            "so_quyet_dinh_ket_qua": "TEXT",
            "ngay_quyet_dinh_ket_qua": "TEXT",
            "thoi_gian_goi_thau": "TEXT",
            "thoi_gian_hop_dong": "TEXT",
            "gia_tri_dam_bao_du_thau": "INTEGER CHECK(gia_tri_dam_bao_du_thau IS NULL OR (typeof(gia_tri_dam_bao_du_thau) = 'integer' AND gia_tri_dam_bao_du_thau >= 0))",
            "hieu_luc_hsdt": "INTEGER CHECK(hieu_luc_hsdt IS NULL OR hieu_luc_hsdt >= 0)",
            "hieu_luc_dam_bao_du_thau": "INTEGER CHECK(hieu_luc_dam_bao_du_thau IS NULL OR hieu_luc_dam_bao_du_thau >= 0)",
            "danh_gia_hsdt_metadata": "TEXT CHECK(danh_gia_hsdt_metadata IS NULL OR (json_valid(danh_gia_hsdt_metadata) AND COALESCE(json_extract(danh_gia_hsdt_metadata, '$.schemaVersion'), 0) = 1 AND length(CAST(danh_gia_hsdt_metadata AS BLOB)) <= 65536))",
            "phuong_phap_danh_gia": "TEXT",
            "trong_so_ky_thuat": "INTEGER CHECK(trong_so_ky_thuat IS NULL OR (typeof(trong_so_ky_thuat) = 'integer' AND trong_so_ky_thuat BETWEEN 0 AND 100))",
            "ty_le_bao_dam_hop_dong": "REAL CHECK(ty_le_bao_dam_hop_dong IS NULL OR (typeof(ty_le_bao_dam_hop_dong) IN ('integer', 'real') AND ty_le_bao_dam_hop_dong BETWEEN 0 AND 100))",
            "is_thuoc": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_thuoc) = 'integer' AND is_thuoc IN (0,1))",
            "trang_thai": "TEXT CHECK(trang_thai IN ('Chuẩn bị', 'Đang mời thầu', 'Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả', 'Hủy thầu') OR trang_thai IS NULL)",
            "yeu_cau_tham_dinh_hsmt": "TEXT DEFAULT 'Không' CHECK(yeu_cau_tham_dinh_hsmt IN ('Có', 'Không') OR yeu_cau_tham_dinh_hsmt IS NULL)",
            "so_bao_cao_tham_dinh_hsmt": "TEXT",
            "ngay_bao_cao_tham_dinh_hsmt": "TEXT",
            "so_to_trinh_hsmt": "TEXT",
            "ngay_trinh_hsmt": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "CHECK(NULLIF(thoi_gian_dang_tai, '') IS NULL OR NULLIF(thoi_gian_dong_thau, '') IS NULL OR (datetime(thoi_gian_dang_tai) IS NOT NULL AND datetime(thoi_gian_dong_thau) IS NOT NULL AND datetime(thoi_gian_dong_thau) > datetime(thoi_gian_dang_tai)))",
            "CHECK(NULLIF(thoi_gian_dong_thau, '') IS NULL OR NULLIF(thoi_gian_mo_thau, '') IS NULL OR (datetime(thoi_gian_dong_thau) IS NOT NULL AND datetime(thoi_gian_mo_thau) IS NOT NULL AND datetime(thoi_gian_mo_thau) >= datetime(thoi_gian_dong_thau)))"
        ],
        "field_map": {
            "nha_thau_trung_thau_id": "nhaThauTrungThauId",
            "thoi_gian_dang_tai": "thoiGianDangTai",
            "thoi_gian_dong_thau": "thoiGianDongThau",
            "thoi_gian_mo_thau": "thoiGianMoThau",
            "thoi_gian_mo_ehsdxtc": "thoiGianMoEhsdxtc",
            "so_quyet_dinh": "soQuyetDinh",
            "ngay_quyet_dinh": "ngayQuyetDinh",
            "so_quyet_dinh_ket_qua": "soQuyetDinhKetQua",
            "ngay_quyet_dinh_ket_qua": "ngayQuyetDinhKetQua",
            "gia_tri_dam_bao_du_thau": "giaTriDamBaoDuThau",
            "hieu_luc_hsdt": "hieuLucHsdt",
            "hieu_luc_dam_bao_du_thau": "hieuLucDamBaoDuThau",
            "danh_gia_hsdt_metadata": "danhGiaHsdtMetadata",
            "ty_le_bao_dam_hop_dong": "tyLeBaoDamHopDong",
            "phuong_phap_danh_gia": "phuongPhapDanhGia",
            "trong_so_ky_thuat": "trongSoKyThuat",
            "is_thuoc": "isThuoc",
            "yeu_cau_tham_dinh_hsmt": "yeuCauThamDinhHsmt",
            "so_bao_cao_tham_dinh_hsmt": "soBaoCaoThamDinhHsmt",
            "ngay_bao_cao_tham_dinh_hsmt": "ngayBaoCaoThamDinhHsmt",
            "so_to_trinh_hsmt": "soToTrinhHsmt",
            "ngay_trinh_hsmt": "ngayTrinhHsmt"
        }
    },
    "goi_thau_phan_lo": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "ma_phan_lo": "TEXT",
            "ten_phan_lo": "TEXT",
            "gia_tri_phan_lo": "INTEGER CHECK(gia_tri_phan_lo IS NULL OR (typeof(gia_tri_phan_lo) = 'integer' AND gia_tri_phan_lo >= 0))",
            "bao_dam_du_thau": "INTEGER CHECK(bao_dam_du_thau IS NULL OR (typeof(bao_dam_du_thau) = 'integer' AND bao_dam_du_thau >= 0))",
            "thoi_gian_thuc_hien": "TEXT",
            "nha_thau_trung_thau_id": "TEXT",
            "gia_trung_thau": "INTEGER CHECK(gia_trung_thau IS NULL OR (typeof(gia_trung_thau) = 'integer' AND gia_trung_thau >= 0))",
            "thoi_gian_goi_thau": "TEXT",
            "thoi_gian_hop_dong": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ]
    },
    "goi_thau_tuy_chon_mua_them": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "hang_muc": "TEXT",
            "don_vi": "TEXT",
            "so_luong": "REAL CHECK(so_luong IS NULL OR (typeof(so_luong) IN ('integer', 'real') AND so_luong >= 0))",
            "ty_le": "REAL CHECK(ty_le IS NULL OR (typeof(ty_le) IN ('integer', 'real') AND ty_le BETWEEN 0 AND 100))",
            "gia_tri_uoc_tinh": "INTEGER CHECK(gia_tri_uoc_tinh IS NULL OR (typeof(gia_tri_uoc_tinh) = 'integer' AND gia_tri_uoc_tinh >= 0))",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_gia_han": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "thoi_gian_dong_thau": "TEXT",
            "ly_do_gia_han": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ]
    },
    "goi_thau_lam_ro": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL CHECK(loai IN ('yeu_cau', 'tra_loi'))",
            "thoi_gian": "TEXT",
            "noi_dung": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ]
    },
    "chuyen_gia": {
        "json_fields": [],
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ho_ten": "TEXT NOT NULL",
            "so_chung_chi": "TEXT",
            "ngay_cap_chung_chi": "TEXT",
            "don_vi_cap_chung_chi": "TEXT",
            "so_cccd": "TEXT",
            "ngay_cap_cccd": "TEXT",
            "noi_cap_cccd": "TEXT",
            "anh_chung_chi": "TEXT",
            "ten_anh_chung_chi": "TEXT",
            "anh_chu_ky": "TEXT",
            "ten_anh_chu_ky": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "field_map": {
            "so_cccd": "soCCCD",
            "ngay_cap_cccd": "ngayCapCCCD",
            "noi_cap_cccd": "noiCapCCCD"
        }
    },
    "hop_dong": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_latest) = 'integer' AND is_latest IN (0,1))",
            "archived_at": "TEXT",
            "ten_hop_dong": "TEXT",
            "so_hop_dong": "TEXT",
            "ngay_ky": "TEXT",
            "chu_dau_tu_id": "TEXT",
            "nha_thau_id": "TEXT",
            "ngay_thanh_ly": "TEXT",
            "chu_dau_tu_thanh_ly_id": "TEXT",
            "nha_thau_thanh_ly_id": "TEXT",
            "ke_hoach_id": "TEXT",
            "gia_tri": "INTEGER CHECK(gia_tri IS NULL OR (typeof(gia_tri) = 'integer' AND gia_tri >= 0))",
            "loai_hop_dong": "TEXT",
            "thoi_gian_thuc_hien": "TEXT",
            "trang_thai_ho_so": "TEXT",
            "phan_loai": "TEXT",
            "co_qd_chi_dinh": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(co_qd_chi_dinh) = 'integer' AND co_qd_chi_dinh IN (0,1))",
            "so_qd_chi_dinh": "TEXT",
            "ngay_qd_chi_dinh": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (chu_dau_tu_thanh_ly_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_thanh_ly_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "CHECK(NULLIF(ngay_ky, '') IS NULL OR NULLIF(ngay_thanh_ly, '') IS NULL OR (date(ngay_ky) IS NOT NULL AND date(ngay_thanh_ly) IS NOT NULL AND date(ngay_thanh_ly) >= date(ngay_ky)))"
        ],
        "field_map": {
            "thoi_gian_thuc_hien": "soNgayThucHien",
            "ke_hoach_id": "keHoachId"
        }
    },
    "hop_dong_goi_thau": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "hop_dong_id": "TEXT NOT NULL",
            "goi_thau_id": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "primary_keys": ["organization_id", "hop_dong_id", "goi_thau_id"],
        "foreign_keys": [
            "FOREIGN KEY (hop_dong_id) REFERENCES hop_dong(id) ON DELETE RESTRICT",
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ]
    },
    "phan_cong_nhan_su": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "id_nhan_vien": "TEXT NOT NULL",
            "id_muc_tieu": "TEXT NOT NULL",
            "loai_doi_tuong": "TEXT NOT NULL CHECK(loai_doi_tuong IN ('kehoach', 'goithau', 'hopdong'))",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (id_nhan_vien) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ],
        "field_map": {
            "id_nhan_vien": "empId",
            "id_muc_tieu": "targetId",
            "loai_doi_tuong": "type"
        }
    },



    "trang_thai_ho_so_giay": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "name": "TEXT NOT NULL",
            "color": "TEXT NOT NULL DEFAULT '#64748b'",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },






    "thong_tin_mo_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "archived_at": "TEXT",
            "goi_thau_id": "TEXT NOT NULL",
            "nha_thau_id": "TEXT NOT NULL",
            "ma_phan_lo": "TEXT NOT NULL DEFAULT ''",
            "ten_phan_lo": "TEXT",
            "ma_dinh_danh": "TEXT",
            "gia_du_thau": "INTEGER CHECK(gia_du_thau IS NULL OR (typeof(gia_du_thau) = 'integer' AND gia_du_thau >= 0))",
            "ty_le_giam_gia": "REAL CHECK(ty_le_giam_gia IS NULL OR (typeof(ty_le_giam_gia) IN ('integer', 'real') AND ty_le_giam_gia BETWEEN 0 AND 100))",
            "gia_sau_giam_gia": "INTEGER CHECK(gia_sau_giam_gia IS NULL OR (typeof(gia_sau_giam_gia) = 'integer' AND gia_sau_giam_gia >= 0))",
            "hieu_luc_hsdt": "INTEGER CHECK(hieu_luc_hsdt IS NULL OR hieu_luc_hsdt >= 0)",
            "gia_tri_dam_bao": "INTEGER CHECK(gia_tri_dam_bao IS NULL OR (typeof(gia_tri_dam_bao) = 'integer' AND gia_tri_dam_bao >= 0))",
            "hieu_luc_bao_dam_ngay": "INTEGER CHECK(hieu_luc_bao_dam_ngay IS NULL OR hieu_luc_bao_dam_ngay >= 0)",
            "thoi_gian_thuc_hien": "TEXT",
            "ten_nha_thau": "TEXT",
            "loai_nha_thau": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ],
        "field_map": {
            "goi_thau_id": "goiThauId",
            "nha_thau_id": "nhaThauId",
            "ma_phan_lo": "maPhanLo",
            "ten_phan_lo": "tenPhanLo",
            "ma_dinh_danh": "maDinhDanh",
            "gia_du_thau": "giaDuThau",
            "ty_le_giam_gia": "tyLeGiamGia",
            "gia_sau_giam_gia": "giaSauGiamGia",
            "hieu_luc_hsdt": "hieuLucHsdt",
            "gia_tri_dam_bao": "giaTriDamBao",
            "hieu_luc_bao_dam_ngay": "hieuLucBaoDamNgay",
            "thoi_gian_thuc_hien": "thoiGianThucHien",
            "ten_nha_thau": "tenNhaThau",
            "loai_nha_thau": "loaiNhaThau",
        }
    },
    "thong_tin_mo_thau_lien_danh_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "thong_tin_mo_thau_id": "TEXT NOT NULL",
            "thanh_vien_nha_thau_id": "TEXT",
            "ten_nha_thau": "TEXT",
            "ma_nha_thau": "TEXT",
            "ma_so_thue": "TEXT",
            "vai_tro": "TEXT",
            "nguoi_dai_dien": "TEXT",
            "danh_xung": "TEXT",
            "so_dien_thoai": "TEXT",
            "email": "TEXT",
            "dia_chi": "TEXT",
            "dia_chi_goc": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "ma_ngan_hang": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (thanh_vien_nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ]
    },
    "to_chuc": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_to_chuc": "TEXT UNIQUE NOT NULL",
            "scope_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(scope_type IN ('organization', 'personal'))",
            "personal_owner_user_id": "TEXT UNIQUE",
            "trang_thai": "TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai IN ('active', 'suspended'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (personal_owner_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
            "CHECK((scope_type = 'organization' AND personal_owner_user_id IS NULL) OR (scope_type = 'personal' AND personal_owner_user_id IS NOT NULL))"
        ],
        "unique_constraints": ["UNIQUE(id, scope_type)"]
    },
    "thanh_vien_to_chuc": {
        "columns": {
            "user_id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "vai_tro_trong_to_chuc": "TEXT NOT NULL DEFAULT 'employee' CHECK(vai_tro_trong_to_chuc IN ('owner', 'manager', 'employee'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "primary_keys": ["user_id", "organization_id"],
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
            "FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_chuyen_gia": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "chuyen_gia_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL DEFAULT 'chuyen_gia'",
            "chuc_vu": "TEXT",
            "cong_viec": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "primary_keys": ["organization_id", "goi_thau_id", "chuyen_gia_id", "loai"],
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (chuyen_gia_id) REFERENCES chuyen_gia(id) ON DELETE RESTRICT"
        ]
    },
    "deleted_records": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "table_name": "TEXT NOT NULL",
            "record_id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "delete_version": "INTEGER DEFAULT 0",
            "deleted_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "cau_hinh_bien_word": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "ten_bien": "TEXT NOT NULL",
            "source_table": "TEXT NOT NULL",
            "source_column": "TEXT NOT NULL",
            "mo_ta": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, ten_bien)",
            "UNIQUE(organization_id, source_table, source_column)"
        ]
    },



    "ma_tran_phan_quyen": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "emp_id": "TEXT NOT NULL",
            "kehoach": "TEXT NOT NULL DEFAULT '' CHECK(kehoach IN ('', 'view', 'edit'))",
            "goithau": "TEXT NOT NULL DEFAULT '' CHECK(goithau IN ('', 'view', 'edit'))",
            "chudautu": "TEXT NOT NULL DEFAULT '' CHECK(chudautu IN ('', 'view', 'edit'))",
            "nhathau": "TEXT NOT NULL DEFAULT '' CHECK(nhathau IN ('', 'view', 'edit'))",
            "chuyengia": "TEXT NOT NULL DEFAULT '' CHECK(chuyengia IN ('', 'view', 'edit'))",
            "hopdong": "TEXT NOT NULL DEFAULT '' CHECK(hopdong IN ('', 'view', 'edit'))",
            "thongtinmothau": "TEXT NOT NULL DEFAULT '' CHECK(thongtinmothau IN ('', 'view', 'edit'))",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, emp_id)"
        ]
    },
    "sync_metadata": {
        "columns": {
            "organization_id": "TEXT PRIMARY KEY CHECK(organization_id != '')",
            "current_version": "INTEGER NOT NULL DEFAULT 0",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "organization_subscriptions": {
        "columns": {
            "organization_id": "TEXT PRIMARY KEY",
            "package_id": "TEXT NOT NULL",
            "status": "TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'expired', 'cancelled'))",
            "starts_at": "INTEGER NOT NULL CHECK(starts_at > 0)",
            "expires_at": "INTEGER CHECK(expires_at IS NULL OR expires_at > starts_at)",
            "member_quota": "INTEGER NOT NULL CHECK(member_quota > 0)",
            "revision": "INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE",
            "FOREIGN KEY (package_id) REFERENCES goi_dich_vu(id) ON DELETE RESTRICT"
        ]
    },
    "vong_danh_gia": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "loai_vong": "TEXT NOT NULL CHECK(loai_vong IN ('single', 'technical', 'financial'))",
            "thu_tu": "INTEGER NOT NULL DEFAULT 0 CHECK(thu_tu >= 0)",
            "trang_thai": "TEXT NOT NULL DEFAULT 'draft' CHECK(trang_thai IN ('draft', 'completed', 'approved'))",
            "so_bao_cao": "TEXT",
            "ngay_bao_cao": "TEXT",
            "da_luu_danh_sach_dat": "INTEGER NOT NULL DEFAULT 0 CHECK(da_luu_danh_sach_dat IN (0,1))",
            "nguoi_cham_id": "TEXT",
            "hoan_thanh_luc": "TEXT",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (nguoi_cham_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"
        ],
        "unique_constraints": ["UNIQUE(organization_id, goi_thau_id, loai_vong)"]
    },
    "tieu_chi_danh_gia": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "vong_danh_gia_id": "TEXT NOT NULL",
            "ma_tieu_chi": "TEXT NOT NULL",
            "ten_tieu_chi": "TEXT NOT NULL",
            "diem_toi_da": "REAL CHECK(diem_toi_da IS NULL OR diem_toi_da >= 0)",
            "trong_so": "REAL CHECK(trong_so IS NULL OR (trong_so >= 0 AND trong_so <= 100))",
            "thu_tu": "INTEGER NOT NULL DEFAULT 0 CHECK(thu_tu >= 0)",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": ["FOREIGN KEY (vong_danh_gia_id) REFERENCES vong_danh_gia(id) ON DELETE CASCADE"],
        "unique_constraints": ["UNIQUE(organization_id, vong_danh_gia_id, ma_tieu_chi)"]
    },
    "ket_qua_danh_gia_nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "thong_tin_mo_thau_id": "TEXT NOT NULL",
            "danh_gia_hop_le": "TEXT",
            "danh_gia_nang_luc": "TEXT",
            "danh_gia_ky_thuat": "TEXT",
            "danh_gia_tai_chinh": "TEXT",
            "danh_gia_ket_luan": "TEXT",
            "diem": "REAL CHECK(diem IS NULL OR diem >= 0)",
            "ly_do_loai": "TEXT",
            "lam_ro_hop_le": "TEXT",
            "lam_ro_nang_luc": "TEXT",
            "lam_ro_ky_thuat": "TEXT",
            "lam_ro_tai_chinh": "TEXT",
            "nguyen_nhan_khong_dat_hop_le": "TEXT",
            "nguyen_nhan_khong_dat_nang_luc": "TEXT",
            "nguyen_nhan_khong_dat_ky_thuat": "TEXT",
            "nguoi_cham_id": "TEXT",
            "danh_gia_luc": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (nguoi_cham_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"
        ],
        "unique_constraints": ["UNIQUE(organization_id, thong_tin_mo_thau_id)"]
    },
    "api_idempotency": {
        "columns": {
            "actor_user_id": "TEXT NOT NULL",
            "operation": "TEXT NOT NULL",
            "idempotency_key": "TEXT NOT NULL",
            "response_json": "TEXT NOT NULL",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)"
        },
        "primary_keys": ["actor_user_id", "operation", "idempotency_key"],
        "foreign_keys": [
            "FOREIGN KEY (actor_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "word_default_seeds": {
        "columns": {
            "organization_id": "TEXT PRIMARY KEY CHECK(organization_id != '')",
            "mappings_version": "INTEGER NOT NULL CHECK(mappings_version > 0)",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "sync_mutations": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "actor_user_id": "TEXT NOT NULL",
            "client_mutation_id": "TEXT NOT NULL",
            "response_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "primary_keys": ["organization_id", "actor_user_id", "client_mutation_id"],
        "foreign_keys": [
            "FOREIGN KEY (actor_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "audit_log": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "actor_user_id": "TEXT",
            "organization_id": "TEXT",
            "action": "TEXT NOT NULL",
            "target_type": "TEXT",
            "target_id": "TEXT",
            "ip_address": "TEXT",
            "metadata_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    }
}


_SIMPLE_ID_FK = re.compile(
    r"^FOREIGN KEY \((?P<column>[a-zA-Z0-9_]+)\) "
    r"REFERENCES (?P<table>[a-zA-Z0-9_]+)\(id\)(?P<suffix>.*)$"
)

ROW_VERSION_TABLES = frozenset({
    "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "chuyen_gia", "nha_thau",
    "hop_dong", "phan_cong_nhan_su", "trang_thai_ho_so_giay",
    "thong_tin_mo_thau", "ma_tran_phan_quyen",
})


def _apply_row_versions(schema):
    for table_name in ROW_VERSION_TABLES:
        columns = schema[table_name]["columns"]
        if "row_version" not in columns:
            columns["row_version"] = (
                "INTEGER NOT NULL DEFAULT 1 "
                "CHECK(typeof(row_version) = 'integer' AND row_version > 0)"
            )


def _apply_tenant_constraints(schema):
    """Materialize tenant isolation in every clean-schema table.

    A globally unique ``id`` is not sufficient: child and parent must also carry
    the same organization key so SQLite itself rejects cross-tenant links.
    """
    tenant_tables = {
        table_name
        for table_name, table_spec in schema.items()
        if "organization_id" in table_spec.get("columns", {})
    }

    for table_name in tenant_tables:
        table_spec = schema[table_name]
        columns = table_spec.get("columns", {})
        foreign_keys = list(table_spec.get("foreign_keys", []))
        upgraded_foreign_keys = []

        for foreign_key in foreign_keys:
            match = _SIMPLE_ID_FK.match(foreign_key)
            if (
                match
                and match.group("column") != "organization_id"
                and match.group("table") in tenant_tables
            ):
                upgraded_foreign_keys.append(
                    "FOREIGN KEY (organization_id, {column}) "
                    "REFERENCES {table}(organization_id, id){suffix}".format(
                        column=match.group("column"),
                        table=match.group("table"),
                        suffix=match.group("suffix"),
                    )
                )
            else:
                upgraded_foreign_keys.append(foreign_key)

        if not any("REFERENCES to_chuc(" in fk for fk in upgraded_foreign_keys):
            if "owner_type" in columns:
                upgraded_foreign_keys.append(
                    "FOREIGN KEY (organization_id, owner_type) "
                    "REFERENCES to_chuc(id, scope_type) ON DELETE RESTRICT"
                )
            else:
                upgraded_foreign_keys.append(
                    "FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE RESTRICT"
                )

        if table_name == "phan_cong_nhan_su":
            upgraded_foreign_keys.append(
                "FOREIGN KEY (id_nhan_vien, organization_id) "
                "REFERENCES thanh_vien_to_chuc(user_id, organization_id) ON DELETE CASCADE"
            )
        elif table_name == "ma_tran_phan_quyen":
            upgraded_foreign_keys.append(
                "FOREIGN KEY (emp_id, organization_id) "
                "REFERENCES thanh_vien_to_chuc(user_id, organization_id) ON DELETE CASCADE"
            )

        table_spec["foreign_keys"] = list(dict.fromkeys(upgraded_foreign_keys))

        if "id" in columns:
            tenant_unique = "UNIQUE(organization_id, id)"
            unique_constraints = list(table_spec.get("unique_constraints", []))
            if tenant_unique not in unique_constraints:
                unique_constraints.append(tenant_unique)
            table_spec["unique_constraints"] = unique_constraints


_apply_row_versions(SCHEMA_DINH_NGHIA)
_apply_tenant_constraints(SCHEMA_DINH_NGHIA)
