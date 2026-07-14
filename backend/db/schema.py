import re


SCHEMA_DINH_NGHIA = {
    "goi_dich_vu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_goi": "TEXT",
            "gia_ca": "REAL",
            "han_muc_nhan_su": "INTEGER",
            "mo_ta": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },
    "tai_khoan": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_dang_nhap": "TEXT UNIQUE",
            "mat_khau": "TEXT",
            "ho_ten": "TEXT",
            "vai_tro": "TEXT NOT NULL DEFAULT 'user' CHECK(vai_tro IN ('super_admin', 'user'))",
            "email": "TEXT",
            "token_phien": "TEXT",
            "anh_dai_dien": "TEXT",
            "goi_dich_vu_id": "TEXT",
            "ngay_bat_dau_goi": "TEXT",
            "ngay_het_han_goi": "TEXT",
            "han_su_dung_token": "INTEGER",
            "privileged_reauth_at": "INTEGER",
            "thong_tin_thiet_bi_cuoi": "TEXT",
            "da_xac_minh": "INTEGER DEFAULT 0",
            "ma_xac_minh": "TEXT",
            "han_xac_minh": "INTEGER",
            "google_id": "TEXT",
            "username_da_dat": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        },
        "foreign_keys": ["FOREIGN KEY (goi_dich_vu_id) REFERENCES goi_dich_vu(id) ON DELETE SET NULL"],
        "field_map": {
            "ma_so_thue": "maSoThue",
            "so_cccd": "soCCCD",
            "ma_qhns": "maQHNS",
            "id_goc": "rootId"
        }
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
    "chu_dau_tu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "archived_at": "TEXT",
            "ngay_ap_dung": "TEXT NOT NULL DEFAULT (date('now', 'localtime'))",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        },
        "field_map": {
            "ma_qhns": "maQHNS"
        }
    },
    "ke_hoach_lcnt": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "ma_ke_hoach": "TEXT",
            "ma_du_an": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "archived_at": "TEXT",
            "ten_ke_hoach": "TEXT NOT NULL",
            "ten_du_an_du_toan": "TEXT",
            "loai_hinh_mua_sam": "TEXT",
            "chu_dau_tu_id": "TEXT",
            "don_vi_trinh_cdt": "TEXT",
            "ten_viet_tat_don_vi_trinh": "TEXT",
            "tong_muc_dau_tu": "REAL",
            "is_tong_muc_tu_dong": "INTEGER DEFAULT 0",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "ke_hoach_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL CHECK(loai IN ('da_thuc_hien', 'khong_ap_dung', 'chua_du_dieu_kien'))",
            "ten_cong_viec": "TEXT",
            "gia_tri": "REAL",
            "don_vi_thuc_hien": "TEXT",
            "van_ban_phe_duyet": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT"
        ]
    },
    "nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "archived_at": "TEXT",
            "ngay_ap_dung": "TEXT NOT NULL DEFAULT (date('now', 'localtime'))",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },
    "nha_thau_lien_danh_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "ma_goi_thau": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "archived_at": "TEXT",
            "ke_hoach_id": "TEXT",
            "ten_goi_thau": "TEXT NOT NULL",
            "gia_goi_thau": "REAL",
            "loai_hop_dong": "TEXT",
            "hinh_thuc_lua_chon": "TEXT",
            "phuong_thuc_lua_chon": "TEXT",
            "thoi_gian_thuc_hien": "TEXT",
            "nguon_von": "TEXT",
            "nha_thau_trung_thau_id": "TEXT",
            "gia_trung_thau": "REAL",
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
            "gia_tri_dam_bao_du_thau": "REAL",
            "hieu_luc_hsdt": "INTEGER",
            "hieu_luc_dam_bao_du_thau": "INTEGER",
            "danh_gia_hsdt_metadata": "TEXT",
            "phuong_phap_danh_gia": "TEXT",
            "trong_so_ky_thuat": "INTEGER",
            "ty_le_bao_dam_hop_dong": "REAL",
            "is_thuoc": "INTEGER DEFAULT 0",
            "trang_thai": "TEXT CHECK(trang_thai IN ('Chuẩn bị', 'Đang mời thầu', 'Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả', 'Hủy thầu') OR trang_thai IS NULL)",
            "yeu_cau_tham_dinh_hsmt": "TEXT DEFAULT 'Không' CHECK(yeu_cau_tham_dinh_hsmt IN ('Có', 'Không') OR yeu_cau_tham_dinh_hsmt IS NULL)",
            "so_bao_cao_tham_dinh_hsmt": "TEXT",
            "ngay_bao_cao_tham_dinh_hsmt": "TEXT",
            "so_to_trinh_hsmt": "TEXT",
            "ngay_trinh_hsmt": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "goi_thau_id": "TEXT NOT NULL",
            "ma_phan_lo": "TEXT",
            "ten_phan_lo": "TEXT",
            "gia_tri_phan_lo": "REAL",
            "bao_dam_du_thau": "REAL",
            "thoi_gian_thuc_hien": "TEXT",
            "nha_thau_trung_thau_id": "TEXT",
            "gia_trung_thau": "REAL",
            "thoi_gian_goi_thau": "TEXT",
            "thoi_gian_hop_dong": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "goi_thau_id": "TEXT NOT NULL",
            "hang_muc": "TEXT",
            "don_vi": "TEXT",
            "so_luong": "REAL",
            "ty_le": "REAL",
            "gia_tri_uoc_tinh": "REAL",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_gia_han": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "goi_thau_id": "TEXT NOT NULL",
            "thoi_gian_dong_thau": "TEXT",
            "ly_do_gia_han": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ]
    },
    "goi_thau_lam_ro": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "goi_thau_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL CHECK(loai IN ('yeu_cau', 'tra_loi'))",
            "thoi_gian": "TEXT",
            "noi_dung": "TEXT",
            "sort_order": "INTEGER DEFAULT 0",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
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
            "gia_tri": "REAL",
            "loai_hop_dong": "TEXT",
            "thoi_gian_thuc_hien": "TEXT",
            "trang_thai_ho_so": "TEXT",
            "phan_loai": "TEXT",
            "co_qd_chi_dinh": "INTEGER DEFAULT 0",
            "so_qd_chi_dinh": "TEXT",
            "ngay_qd_chi_dinh": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (chu_dau_tu_thanh_ly_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_thanh_ly_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT"
        ],
        "field_map": {
            "thoi_gian_thuc_hien": "soNgayThucHien",
            "ke_hoach_id": "keHoachId"
        }
    },
    "hop_dong_goi_thau": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "hop_dong_id": "TEXT NOT NULL",
            "goi_thau_id": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "id_nhan_vien": "TEXT NOT NULL",
            "id_muc_tieu": "TEXT NOT NULL",
            "loai_doi_tuong": "TEXT NOT NULL",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "name": "TEXT NOT NULL",
            "color": "TEXT NOT NULL DEFAULT '#64748b'",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },






    "thong_tin_mo_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "archived_at": "TEXT",
            "goi_thau_id": "TEXT",
            "nha_thau_id": "TEXT",
            "ma_phan_lo": "TEXT",
            "ten_phan_lo": "TEXT",
            "ma_dinh_danh": "TEXT",
            "gia_du_thau": "REAL",
            "dam_bao_du_thau": "REAL",
            "hieu_luc_dam_bao": "TEXT",
            "hieu_luc_hsdxt": "TEXT",
            "ty_le_giam_gia": "REAL",
            "gia_sau_giam_gia": "REAL",
            "hieu_luc_hsdt": "INTEGER",
            "gia_tri_dam_bao": "REAL",
            "hieu_luc_bao_dam_ngay": "INTEGER",
            "thoi_gian_thuc_hien": "TEXT",
            "ten_nha_thau": "TEXT",
            "loai_nha_thau": "TEXT",
            "danh_gia_hop_le": "TEXT",
            "danh_gia_nang_luc": "TEXT",
            "danh_gia_ky_thuat": "TEXT",
            "danh_gia_tai_chinh": "TEXT",
            "danh_gia_ket_luan": "TEXT",
            "ly_do_truot": "TEXT",
            "lam_ro_hop_le": "TEXT",
            "lam_ro_nang_luc": "TEXT",
            "lam_ro_ky_thuat": "TEXT",
            "lam_ro_tai_chinh": "TEXT",
            "nguyen_nhan_khong_dat_hop_le": "TEXT",
            "nguyen_nhan_khong_dat_nang_luc": "TEXT",
            "nguyen_nhan_khong_dat_ky_thuat": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "dam_bao_du_thau": "damBaoDuThau",
            "hieu_luc_dam_bao": "hieuLucDamBao",
            "hieu_luc_hsdxt": "hieuLucHsdxt",
            "ty_le_giam_gia": "tyLeGiamGia",
            "gia_sau_giam_gia": "giaSauGiamGia",
            "hieu_luc_hsdt": "hieuLucHsdt",
            "gia_tri_dam_bao": "giaTriDamBao",
            "hieu_luc_bao_dam_ngay": "hieuLucBaoDamNgay",
            "thoi_gian_thuc_hien": "thoiGianThucHien",
            "ten_nha_thau": "tenNhaThau",
            "loai_nha_thau": "loaiNhaThau",
            "danh_gia_hop_le": "danhGiaHopLe",
            "danh_gia_nang_luc": "danhGiaNangLuc",
            "danh_gia_ky_thuat": "danhGiaKyThuat",
            "danh_gia_tai_chinh": "danhGiaTaiChinh",
            "danh_gia_ket_luan": "danhGiaKetLuan",
            "ly_do_truot": "lyDoTruot",
            "lam_ro_hop_le": "lamRoHopLe",
            "lam_ro_nang_luc": "lamRoNangLuc",
            "lam_ro_ky_thuat": "lamRoKyThuat",
            "lam_ro_tai_chinh": "lamRoTaiChinh",
            "nguyen_nhan_khong_dat_hop_le": "nguyenNhanKhongDatHopLe",
            "nguyen_nhan_khong_dat_nang_luc": "nguyenNhanKhongDatNangLuc",
            "nguyen_nhan_khong_dat_ky_thuat": "nguyenNhanKhongDatKyThuat"
        }
    },
    "thong_tin_mo_thau_lien_danh_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
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
            "quan_ly_id": "TEXT",
            "trang_thai": "TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai IN ('active', 'suspended'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        },
        "foreign_keys": ["FOREIGN KEY (quan_ly_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"]
    },
    "thanh_vien_to_chuc": {
        "columns": {
            "user_id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "vai_tro_trong_to_chuc": "TEXT NOT NULL DEFAULT 'employee' CHECK(vai_tro_trong_to_chuc IN ('owner', 'manager', 'employee', 'viewer'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "goi_thau_id": "TEXT NOT NULL",
            "chuyen_gia_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL DEFAULT 'chuyen_gia'",
            "chuc_vu": "TEXT",
            "cong_viec": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "deleted_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },
    "cau_hinh_bien_word": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "ten_bien": "TEXT NOT NULL",
            "source_table": "TEXT NOT NULL",
            "source_column": "TEXT NOT NULL",
            "mo_ta": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
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
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type = 'organization')",
            "emp_id": "TEXT NOT NULL",
            "kehoach": "TEXT",
            "goithau": "TEXT",
            "chudautu": "TEXT",
            "nhathau": "TEXT",
            "chuyengia": "TEXT",
            "hopdong": "TEXT",
            "thongtinmothau": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, emp_id)"
        ]
    },
    "sync_metadata": {
        "columns": {
            "organization_id": "TEXT PRIMARY KEY CHECK(organization_id != '')",
            "current_version": "INTEGER NOT NULL DEFAULT 0",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },
    "word_default_seeds": {
        "columns": {
            "organization_id": "TEXT PRIMARY KEY CHECK(organization_id != '')",
            "mappings_version": "INTEGER NOT NULL CHECK(mappings_version > 0)",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    },
    "sync_mutations": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "client_mutation_id": "TEXT NOT NULL",
            "response_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        },
        "primary_keys": ["organization_id", "client_mutation_id"]
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))"
        }
    }
}


_SIMPLE_ID_FK = re.compile(
    r"^FOREIGN KEY \((?P<column>[a-zA-Z0-9_]+)\) "
    r"REFERENCES (?P<table>[a-zA-Z0-9_]+)\(id\)(?P<suffix>.*)$"
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

        if not any("REFERENCES to_chuc(id)" in fk for fk in upgraded_foreign_keys):
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


_apply_tenant_constraints(SCHEMA_DINH_NGHIA)
