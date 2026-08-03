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
    ("goi_thau_hang_hoa", "don_gia_du_toan"),
    ("goi_thau_hang_hoa", "thanh_tien_du_toan"),
    ("hang_hoa_du_thau_nha_thau", "don_gia_du_thau"),
    ("hang_hoa_du_thau_nha_thau", "thanh_tien_du_thau"),
    ("hang_hoa_du_thau_nha_thau", "gia_tri_co_so_sau_giam_gia"),
    ("hang_hoa_du_thau_nha_thau", "gia_tri_cong_uu_dai"),
    ("hang_hoa_du_thau_nha_thau", "thanh_tien_sau_uu_dai"),
    ("goi_thau_tuy_chon_mua_them", "gia_tri_uoc_tinh"),
    ("hop_dong", "gia_tri"),
    ("thong_tin_mo_thau", "gia_du_thau"),
    ("thong_tin_mo_thau", "gia_sau_giam_gia"),
    ("thong_tin_mo_thau", "tong_gia_tri_cong_uu_dai"),
    ("thong_tin_mo_thau", "gia_so_sanh_sau_uu_dai"),
    ("thong_tin_mo_thau", "gia_danh_gia_sau_uu_dai"),
    ("thong_tin_mo_thau", "gia_tri_dam_bao"),
    ("ket_qua_danh_gia_nha_thau", "gia_xep_hang"),
    ("ket_qua_danh_gia_nha_thau", "gia_de_nghi_trung_thau"),
})


SCHEMA_DINH_NGHIA = {
    "database_metadata": {
        "columns": {
            "id": "INTEGER PRIMARY KEY CHECK(id = 1)",
            "schema_version": "INTEGER NOT NULL CHECK(schema_version > 0)",
            "baseline": "TEXT NOT NULL CHECK(baseline != '')",
            "installation_id": "TEXT NOT NULL CHECK(installation_id != '')",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
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
            "anh_dai_dien": "TEXT",
            "da_xac_minh": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(da_xac_minh) = 'integer' AND da_xac_minh IN (0,1))",
            "ma_xac_minh": "TEXT",
            "han_xac_minh": "INTEGER",
            "username_da_dat": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(username_da_dat) = 'integer' AND username_da_dat IN (0,1))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
    "auth_sessions": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT NOT NULL",
            "token_hash": "TEXT NOT NULL UNIQUE CHECK(token_hash != '')",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)",
            "last_seen_at": "INTEGER NOT NULL CHECK(last_seen_at > 0)",
            "idle_expires_at": "INTEGER NOT NULL CHECK(idle_expires_at > 0)",
            "absolute_expires_at": "INTEGER NOT NULL CHECK(absolute_expires_at > 0)",
            "revoked_at": "INTEGER",
            "remember_me": "INTEGER NOT NULL DEFAULT 0 CHECK(remember_me IN (0,1))",
            "device_info": "TEXT",
            "privileged_reauth_at": "INTEGER",
            "active_role": "TEXT CHECK(active_role IS NULL OR active_role IN ('super_admin', 'manager', 'employee'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
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
    "email_delivery_status": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT NOT NULL",
            "purpose": "TEXT NOT NULL CHECK(purpose IN ('google_temporary_password', 'user_notification'))",
            "recipient_hash": "TEXT NOT NULL CHECK(recipient_hash != '')",
            "recipient_ciphertext": "TEXT",
            "subject_ciphertext": "TEXT",
            "body_ciphertext": "TEXT",
            "sensitive_content": "INTEGER NOT NULL DEFAULT 1 CHECK(sensitive_content IN (0,1))",
            "status": "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'retry', 'sent', 'failed'))",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
            "last_error_code": "TEXT",
            "next_attempt_at": "INTEGER",
            "locked_at": "INTEGER",
            "locked_by": "TEXT",
            "accepted_at": "INTEGER",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "user_notifications": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT NOT NULL",
            "organization_id": "TEXT",
            "kind": "TEXT NOT NULL CHECK(kind IN ('assignment_added', 'assignment_removed', 'organization_added', 'organization_removed'))",
            "severity": "TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info', 'warning'))",
            "title": "TEXT NOT NULL CHECK(trim(title) != '')",
            "message": "TEXT NOT NULL CHECK(trim(message) != '')",
            "target_type": "TEXT CHECK(target_type IS NULL OR target_type IN ('goithau', 'hopdong'))",
            "target_id": "TEXT",
            "route": "TEXT",
            "read_at": "INTEGER",
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
    "partner_lookup_cache": {
        "columns": {
            "cache_key": "TEXT PRIMARY KEY",
            "result_json": "TEXT",
            "found": "INTEGER NOT NULL CHECK(found IN (0,1))",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        }
    },
    "partner_upstream_health": {
        "columns": {
            "upstream": "TEXT PRIMARY KEY CHECK(upstream IN ('muasamcong', 'vietqr', 'escodata'))",
            "failure_count": "INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0)",
            "opened_until": "INTEGER NOT NULL DEFAULT 0 CHECK(opened_until >= 0)",
            "probe_locked_until": "INTEGER NOT NULL DEFAULT 0 CHECK(probe_locked_until >= 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        }
    },
    "partner_enrichment_jobs": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "contractor_id": "TEXT NOT NULL CHECK(contractor_id != '')",
            "status": "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'retry', 'completed', 'failed'))",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
            "available_at": "INTEGER NOT NULL CHECK(available_at > 0)",
            "locked_at": "INTEGER",
            "locked_by": "TEXT",
            "last_error_code": "TEXT",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, contractor_id)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (organization_id, contractor_id) REFERENCES nha_thau(organization_id, id) ON DELETE CASCADE"
        ]
    },
    "websocket_events": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "event_type": "TEXT NOT NULL CHECK(event_type IN ('broadcast', 'revoke_user'))",
            "organization_id": "TEXT",
            "user_id": "TEXT",
            "payload_json": "TEXT",
            "status": "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'retry', 'delivered', 'dead_letter'))",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
            "available_at": "INTEGER NOT NULL DEFAULT 0 CHECK(available_at >= 0)",
            "delivered_at": "INTEGER",
            "last_error_code": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
    "websocket_connection_leases": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT",
            "organization_id": "TEXT",
            "client_ip_hash": "TEXT NOT NULL CHECK(client_ip_hash != '')",
            "worker_id": "TEXT NOT NULL CHECK(worker_id != '')",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > 0)",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "document_jobs": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "operation": "TEXT NOT NULL CHECK(operation != '')",
            "organization_id": "TEXT",
            "user_id": "TEXT",
            "package_id": "TEXT",
            "filename": "TEXT",
            "content_type": "TEXT",
            "cancelled_at": "INTEGER",
            "status": "TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'retry', 'completed', 'failed'))",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
            "available_at": "INTEGER NOT NULL CHECK(available_at > 0)",
            "locked_at": "INTEGER",
            "locked_by": "TEXT",
            "last_error_code": "TEXT",
            "last_error_message": "TEXT",
            "completed_at": "INTEGER",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > 0)",
            "created_at": "INTEGER NOT NULL CHECK(created_at > 0)",
            "updated_at": "INTEGER NOT NULL CHECK(updated_at > 0)"
        }
    },
    "asset_journal": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "client_mutation_id": "TEXT NOT NULL CHECK(client_mutation_id != '')",
            "staging_path": "TEXT NOT NULL CHECK(staging_path != '')",
            "managed_path": "TEXT NOT NULL CHECK(managed_path != '')",
            "sha256": "TEXT NOT NULL CHECK(length(sha256) = 64)",
            "size_bytes": "INTEGER NOT NULL CHECK(size_bytes > 0)",
            "status": "TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged', 'promoted', 'failed'))",
            "attempt_count": "INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0)",
            "last_error_code": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, client_mutation_id, managed_path)"
        ]
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
            "ten_du_an_du_toan": "TEXT NOT NULL CHECK(trim(ten_du_an_du_toan) != '')",
            "loai_hinh_mua_sam": "TEXT NOT NULL CHECK(trim(loai_hinh_mua_sam) != '')",
            "chu_dau_tu_id": "TEXT NOT NULL CHECK(trim(chu_dau_tu_id) != '')",
            "don_vi_trinh_cdt": "TEXT",
            "ten_viet_tat_don_vi_trinh": "TEXT",
            "tong_muc_dau_tu": "INTEGER CHECK(tong_muc_dau_tu IS NULL OR (typeof(tong_muc_dau_tu) = 'integer' AND tong_muc_dau_tu >= 0))",
            "is_tong_muc_tu_dong": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_tong_muc_tu_dong) = 'integer' AND is_tong_muc_tu_dong IN (0,1))",
            "ngay_phe_duyet": "TEXT NOT NULL CHECK(date(ngay_phe_duyet) IS NOT NULL)",
            "quyet_dinh_phe_duyet": "TEXT NOT NULL CHECK(trim(quyet_dinh_phe_duyet) != '')",
            "thoi_gian_dang_tai": "TEXT",
            "nguon_von": "TEXT",
            "thoi_gian_du_an": "TEXT",
            "dia_diem_quy_mo": "TEXT",
            "thong_tin_khac": "TEXT",
            "so_qd_phe_duyet_du_an": "TEXT",
            "ngay_qd_phe_duyet_du_an": "TEXT",
            "co_quan_phe_duyet_du_an": "TEXT",
            "phe_duyet": "TEXT",
            "so_to_trinh_du_toan": "TEXT",
            "ngay_trinh_du_toan": "TEXT",
            "ngay_phe_duyet_du_toan": "TEXT",
            "so_qd_phe_duyet_du_toan": "TEXT",
            "so_to_trinh_ke_hoach": "TEXT",
            "so_to_trinh_du_toan_ke_hoach": "TEXT",
            "ngay_trinh_ke_hoach": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "foreign_keys": ["FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE RESTRICT"],
        "field_map": {
            "ma_du_an": "maDuan",
            "thoi_gian_dang_tai": "thoiGianDangMa",
            "don_vi_trinh_cdt": "donViTrinhCdt",
            "ten_viet_tat_don_vi_trinh": "tenVietTatDonViTrinh",
            "phe_duyet": "pheDuyet",
            "so_to_trinh_du_toan": "soToTrinhDuToan",
            "ngay_trinh_du_toan": "ngayTrinhDuToan",
            "ngay_phe_duyet_du_toan": "ngayPheDuyetDuToan",
            "so_qd_phe_duyet_du_toan": "soQdPheDuyetDuToan",
            "so_to_trinh_ke_hoach": "soToTrinhKeHoach",
            "so_to_trinh_du_toan_ke_hoach": "soToTrinhDuToanKeHoach",
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
            "thanh_vien_nha_thau_id": "TEXT NOT NULL",
            "ten_nha_thau": "TEXT",
            "ma_nha_thau": "TEXT",
            "ma_so_thue": "TEXT",
            "vai_tro": "TEXT NOT NULL CHECK(vai_tro IN ('Đứng đầu liên danh', 'Thành viên liên danh'))",
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
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, nha_thau_id, thanh_vien_nha_thau_id)"
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
            "ke_hoach_id": "TEXT NOT NULL CHECK(trim(ke_hoach_id) != '')",
            "ten_goi_thau": "TEXT NOT NULL",
            "gia_goi_thau": "INTEGER NOT NULL CHECK(typeof(gia_goi_thau) = 'integer' AND gia_goi_thau >= 0)",
            "loai_hop_dong": "TEXT",
            "hinh_thuc_lua_chon": "TEXT",
            "phuong_thuc_lua_chon": "TEXT",
            "qua_mang": "TEXT NOT NULL DEFAULT 'Qua mạng' CHECK(qua_mang IN ('Qua mạng', 'Không qua mạng'))",
            "trong_nuoc_quoc_te": "TEXT NOT NULL DEFAULT 'Trong nước' CHECK(trong_nuoc_quoc_te IN ('Trong nước', 'Quốc tế'))",
            "thoi_gian_thuc_hien": "TEXT NOT NULL CHECK(trim(thoi_gian_thuc_hien) != '')",
            "nguon_von": "TEXT NOT NULL CHECK(trim(nguon_von) != '')",
            "nha_thau_trung_thau_id": "TEXT",
            "gia_trung_thau": "INTEGER CHECK(gia_trung_thau IS NULL OR (typeof(gia_trung_thau) = 'integer' AND gia_trung_thau >= 0))",
            "linh_vuc": "TEXT",
            "tuy_chon_mua_them": "TEXT DEFAULT 'Không' CHECK(tuy_chon_mua_them IN ('Có', 'Không') OR tuy_chon_mua_them IS NULL)",
            "thoi_gian_to_chuc": "TEXT NOT NULL CHECK(trim(thoi_gian_to_chuc) != '')",
            "thoi_gian_bat_dau_to_chuc": "TEXT NOT NULL CHECK(trim(thoi_gian_bat_dau_to_chuc) != '')",
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
            "phuong_phap_danh_gia": "TEXT",
            "trong_so_ky_thuat": "INTEGER CHECK(trong_so_ky_thuat IS NULL OR (typeof(trong_so_ky_thuat) = 'integer' AND trong_so_ky_thuat BETWEEN 0 AND 100))",
            "ty_le_bao_dam_hop_dong": "REAL CHECK(ty_le_bao_dam_hop_dong IS NULL OR (typeof(ty_le_bao_dam_hop_dong) IN ('integer', 'real') AND ty_le_bao_dam_hop_dong BETWEEN 0 AND 100 AND ty_le_bao_dam_hop_dong = round(ty_le_bao_dam_hop_dong, 4)))",
            "is_thuoc": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_thuoc) = 'integer' AND is_thuoc IN (0,1))",
            "is_rebid": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_rebid) = 'integer' AND is_rebid IN (0,1))",
            "rebid_from_package_id": "TEXT",
            "trang_thai": "TEXT NOT NULL DEFAULT 'PREPARING' CHECK(trang_thai IN ('PREPARING', 'INVITED', 'OPENED', 'EVALUATING', 'PARTIALLY_AWARDED', 'AWARDED', 'CANCELLED'))",
            "yeu_cau_tham_dinh_hsmt": "TEXT DEFAULT 'Không' CHECK(yeu_cau_tham_dinh_hsmt IN ('Có', 'Không') OR yeu_cau_tham_dinh_hsmt IS NULL)",
            "yeu_cau_tham_dinh_hsmt_code": "TEXT NOT NULL DEFAULT 'UNDETERMINED' CHECK(yeu_cau_tham_dinh_hsmt_code IN ('UNDETERMINED', 'REQUIRED', 'NOT_REQUIRED'))",
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
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (rebid_from_package_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "CHECK(NULLIF(thoi_gian_dang_tai, '') IS NULL OR NULLIF(thoi_gian_dong_thau, '') IS NULL OR (datetime(thoi_gian_dang_tai) IS NOT NULL AND datetime(thoi_gian_dong_thau) IS NOT NULL AND datetime(thoi_gian_dong_thau) > datetime(thoi_gian_dang_tai)))",
            "CHECK(NULLIF(thoi_gian_dong_thau, '') IS NULL OR NULLIF(thoi_gian_mo_thau, '') IS NULL OR (datetime(thoi_gian_dong_thau) IS NOT NULL AND datetime(thoi_gian_mo_thau) IS NOT NULL AND datetime(thoi_gian_mo_thau) >= datetime(thoi_gian_dong_thau)))",
            "CHECK((is_rebid = 0 AND rebid_from_package_id IS NULL) OR (is_rebid = 1 AND rebid_from_package_id IS NOT NULL AND rebid_from_package_id != id))",
            "CHECK(trang_thai != 'AWARDED' OR (gia_trung_thau IS NOT NULL AND so_quyet_dinh_ket_qua IS NOT NULL AND trim(so_quyet_dinh_ket_qua) != '' AND ngay_quyet_dinh_ket_qua IS NOT NULL AND date(ngay_quyet_dinh_ket_qua) IS NOT NULL AND (phan_lo = 'Có' OR (nha_thau_trung_thau_id IS NOT NULL AND trim(nha_thau_trung_thau_id) != ''))))"
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
            "ty_le_bao_dam_hop_dong": "tyLeBaoDamHopDong",
            "phuong_phap_danh_gia": "phuongPhapDanhGia",
            "trong_so_ky_thuat": "trongSoKyThuat",
            "is_thuoc": "isThuoc",
            "yeu_cau_tham_dinh_hsmt": "yeuCauThamDinhHsmt",
            "yeu_cau_tham_dinh_hsmt_code": "yeuCauThamDinhHsmtCode",
            "so_bao_cao_tham_dinh_hsmt": "soBaoCaoThamDinhHsmt",
            "ngay_bao_cao_tham_dinh_hsmt": "ngayBaoCaoThamDinhHsmt",
            "so_to_trinh_hsmt": "soToTrinhHsmt",
            "ngay_trinh_hsmt": "ngayTrinhHsmt"
        }
    },
    "tai_lieu_goi_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "evaluation_batch_id": "TEXT",
            "document_type": "TEXT NOT NULL CHECK(document_type IN ('HSMT', 'HSMT_APPRAISAL_REPORT', 'BID_EVALUATION_REPORT', 'TECHNICAL_EVALUATION_REPORT', 'TECHNICAL_APPRAISAL_REPORT', 'FINANCIAL_EVALUATION_REPORT', 'RESULT_APPRAISAL_REPORT'))",
            "original_filename": "TEXT NOT NULL CHECK(trim(original_filename) != '')",
            "storage_key": "TEXT NOT NULL CHECK(trim(storage_key) != '')",
            "content_type": "TEXT NOT NULL CHECK(trim(content_type) != '')",
            "size_bytes": "INTEGER NOT NULL CHECK(typeof(size_bytes) = 'integer' AND size_bytes > 0)",
            "sha256": "TEXT NOT NULL CHECK(length(sha256) = 64)",
            "uploaded_by_id": "TEXT",
            "uploaded_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (evaluation_batch_id) REFERENCES dot_xu_ly_phan_lo(id) ON DELETE RESTRICT",
            "FOREIGN KEY (uploaded_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"
        ],
        "unique_constraints": []
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
            "archived_at": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ]
    },
    "goi_thau_hang_hoa": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL CHECK(trim(goi_thau_id) != '')",
            "phan_lo_id": "TEXT",
            "ma_hang_hoa": "TEXT NOT NULL CHECK(trim(ma_hang_hoa) != '')",
            "ten_hang_hoa": "TEXT NOT NULL CHECK(trim(ten_hang_hoa) != '')",
            "nhom_hang_hoa": "TEXT",
            "don_vi_tinh": "TEXT NOT NULL CHECK(trim(don_vi_tinh) != '')",
            "so_luong": "REAL NOT NULL CHECK(typeof(so_luong) IN ('integer', 'real') AND so_luong > 0)",
            "yeu_cau_ky_thuat": "TEXT",
            "ky_ma_hieu_tham_chieu": "TEXT",
            "xuat_xu_yeu_cau": "TEXT",
            "dia_diem_giao_hang": "TEXT",
            "thoi_gian_giao_hang": "TEXT",
            "don_gia_du_toan": "INTEGER CHECK(don_gia_du_toan IS NULL OR (typeof(don_gia_du_toan) = 'integer' AND don_gia_du_toan >= 0))",
            "thanh_tien_du_toan": "INTEGER CHECK(thanh_tien_du_toan IS NULL OR (typeof(thanh_tien_du_toan) = 'integer' AND thanh_tien_du_toan >= 0))",
            "ghi_chu": "TEXT",
            "sort_order": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sort_order) = 'integer' AND sort_order >= 0)",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (phan_lo_id) REFERENCES goi_thau_phan_lo(id) ON DELETE RESTRICT"
        ]
    },
    "hang_hoa_du_thau_nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL CHECK(trim(goi_thau_id) != '')",
            "thong_tin_mo_thau_id": "TEXT NOT NULL CHECK(trim(thong_tin_mo_thau_id) != '')",
            "phan_lo_id": "TEXT",
            "goi_thau_hang_hoa_id": "TEXT",
            "stt_nguon": "TEXT NOT NULL DEFAULT '' CHECK(length(stt_nguon) <= 80)",
            "ma_phan_lo_nguon": "TEXT NOT NULL DEFAULT '' CHECK(length(ma_phan_lo_nguon) <= 200)",
            "ten_phan_lo_nguon": "TEXT NOT NULL DEFAULT '' CHECK(length(ten_phan_lo_nguon) <= 1000)",
            "danh_muc_hang_hoa": "TEXT NOT NULL CHECK(length(trim(danh_muc_hang_hoa)) BETWEEN 1 AND 4000)",
            "ky_ma_hieu": "TEXT NOT NULL DEFAULT '' CHECK(length(ky_ma_hieu) <= 10000)",
            "nhan_hieu": "TEXT NOT NULL DEFAULT '' CHECK(length(nhan_hieu) <= 4000)",
            "nam_san_xuat": "TEXT NOT NULL DEFAULT '' CHECK(length(nam_san_xuat) <= 500)",
            "xuat_xu": "TEXT NOT NULL DEFAULT '' CHECK(length(xuat_xu) <= 2000)",
            "hang_san_xuat": "TEXT NOT NULL DEFAULT '' CHECK(length(hang_san_xuat) <= 2000)",
            "cau_hinh_tinh_nang_ky_thuat": "TEXT NOT NULL DEFAULT '' CHECK(length(cau_hinh_tinh_nang_ky_thuat) <= 100000)",
            "don_vi_tinh": "TEXT NOT NULL DEFAULT '' CHECK(length(don_vi_tinh) <= 200)",
            "khoi_luong": "REAL CHECK(khoi_luong IS NULL OR (typeof(khoi_luong) IN ('integer', 'real') AND khoi_luong > 0))",
            "ma_hs": "TEXT NOT NULL DEFAULT '' CHECK(length(ma_hs) <= 2000)",
            "don_gia_du_thau": "INTEGER CHECK(don_gia_du_thau IS NULL OR (typeof(don_gia_du_thau) = 'integer' AND don_gia_du_thau >= 0))",
            "thanh_tien_du_thau": "INTEGER CHECK(thanh_tien_du_thau IS NULL OR (typeof(thanh_tien_du_thau) = 'integer' AND thanh_tien_du_thau >= 0))",
            "ma_uu_dai": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(ma_uu_dai) = 'integer' AND ma_uu_dai BETWEEN 0 AND 5)",
            "he_so_uu_dai_goc_bp": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(he_so_uu_dai_goc_bp) = 'integer' AND he_so_uu_dai_goc_bp BETWEEN 0 AND 1500)",
            "he_so_cong_uu_dai_bp": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(he_so_cong_uu_dai_bp) = 'integer' AND he_so_cong_uu_dai_bp BETWEEN 0 AND 1500)",
            "gia_tri_co_so_sau_giam_gia": "INTEGER CHECK(gia_tri_co_so_sau_giam_gia IS NULL OR (typeof(gia_tri_co_so_sau_giam_gia) = 'integer' AND gia_tri_co_so_sau_giam_gia >= 0))",
            "gia_tri_cong_uu_dai": "INTEGER CHECK(gia_tri_cong_uu_dai IS NULL OR (typeof(gia_tri_cong_uu_dai) = 'integer' AND gia_tri_cong_uu_dai >= 0))",
            "thanh_tien_sau_uu_dai": "INTEGER CHECK(thanh_tien_sau_uu_dai IS NULL OR (typeof(thanh_tien_sau_uu_dai) = 'integer' AND thanh_tien_sau_uu_dai >= 0))",
            "uu_dai_source_sheet": "TEXT NOT NULL DEFAULT '' CHECK(length(uu_dai_source_sheet) <= 500)",
            "uu_dai_source_row": "INTEGER CHECK(uu_dai_source_row IS NULL OR uu_dai_source_row > 0)",
            "uu_dai_match_method": "TEXT NOT NULL DEFAULT 'no_15a' CHECK(uu_dai_match_method IN ('no_15a', 'normalized_name_occurrence', 'position', 'manual', 'unmatched'))",
            "uu_dai_match_status": "TEXT NOT NULL DEFAULT 'matched' CHECK(uu_dai_match_status IN ('matched', 'ambiguous', 'conflict'))",
            "uu_dai_source_payload": "TEXT NOT NULL DEFAULT '' CHECK(length(uu_dai_source_payload) <= 20000)",
            "uu_dai_manual_override": "INTEGER NOT NULL DEFAULT 0 CHECK(uu_dai_manual_override IN (0, 1))",
            "uu_dai_manual_actor_id": "TEXT",
            "uu_dai_manual_updated_at": "TEXT",
            "uu_dai_manual_reason": "TEXT NOT NULL DEFAULT '' CHECK(length(uu_dai_manual_reason) <= 1000)",
            "trang_thai_uu_dai": "TEXT NOT NULL DEFAULT 'empty' CHECK(trang_thai_uu_dai IN ('empty', 'draft', 'ready', 'stale'))",
            "mapping_method": "TEXT NOT NULL DEFAULT 'unmatched' CHECK(mapping_method IN ('unmatched', 'auto', 'manual'))",
            "mapping_status": "TEXT NOT NULL DEFAULT 'unmatched' CHECK(mapping_status IN ('matched', 'unmatched', 'duplicate', 'wrong_lot', 'lot_not_found'))",
            "sort_order": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sort_order) = 'integer' AND sort_order >= 0)",
            "import_batch_id": "TEXT NOT NULL DEFAULT '' CHECK(length(import_batch_id) <= 160)",
            "is_draft": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(is_draft) = 'integer' AND is_draft IN (0, 1))",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (phan_lo_id) REFERENCES goi_thau_phan_lo(id) ON DELETE RESTRICT",
            "FOREIGN KEY (goi_thau_hang_hoa_id) REFERENCES goi_thau_hang_hoa(id) ON DELETE RESTRICT",
            "FOREIGN KEY (uu_dai_manual_actor_id) REFERENCES tai_khoan(id) ON DELETE SET NULL",
            "FOREIGN KEY (organization_id, goi_thau_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, goi_thau_id, id) ON DELETE CASCADE"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, thong_tin_mo_thau_id, goi_thau_hang_hoa_id)"
        ]
    },
    "dot_xu_ly_phan_lo": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "sequence_no": "INTEGER NOT NULL CHECK(sequence_no > 0)",
            "procedure_kind": "TEXT NOT NULL CHECK(procedure_kind IN ('1G1T', '1G2T'))",
            "approval_mode": "TEXT NOT NULL DEFAULT 'CONSOLIDATED_APPROVAL' CHECK(approval_mode IN ('CONSOLIDATED_APPROVAL', 'STAGED_APPROVAL'))",
            "status": "TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'VOID'))",
            "policy_version": "INTEGER NOT NULL DEFAULT 1 CHECK(policy_version > 0)",
            "staged_approval_authorized": "INTEGER NOT NULL DEFAULT 0 CHECK(staged_approval_authorized IN (0,1))",
            "authorization_basis": "TEXT",
            "created_by_id": "TEXT",
            "closed_at": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (created_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, goi_thau_id, sequence_no)"
        ]
    },
    "dot_xu_ly_phan_lo_chi_tiet": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "batch_id": "TEXT NOT NULL",
            "lot_id": "TEXT NOT NULL",
            "current_stage": "TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(current_stage IN ('NOT_STARTED', 'EVALUATION_DRAFT', 'EVALUATION_FINALIZED', 'TECHNICAL_DRAFT', 'TECHNICAL_EVALUATED', 'TECHNICAL_APPRAISED', 'TECHNICAL_APPROVED', 'FINANCIAL_OPENED', 'FINANCIAL_EVALUATED', 'RESULT_APPRAISED', 'RESULT_APPROVED'))",
            "lifecycle_revision": "INTEGER NOT NULL DEFAULT 1 CHECK(lifecycle_revision > 0)",
            "outcome": "TEXT CHECK(outcome IS NULL OR outcome IN ('AWARDED', 'NO_BID', 'NO_TECHNICAL_QUALIFIER', 'NO_FINANCIAL_QUALIFIER', 'NO_RESPONSIVE_BID', 'CANCELLED_LOT', 'REPROCUREMENT_REQUIRED', 'OTHER_APPROVED_OUTCOME'))",
            "is_active": "INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (batch_id) REFERENCES dot_xu_ly_phan_lo(id) ON DELETE RESTRICT",
            "FOREIGN KEY (lot_id) REFERENCES goi_thau_phan_lo(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, batch_id, lot_id)",
            "CHECK((current_stage = 'RESULT_APPROVED' AND outcome IS NOT NULL) OR (current_stage != 'RESULT_APPROVED' AND outcome IS NULL))"
        ]
    },
    "nhom_phu_thuoc_phan_lo": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL",
            "dependency_kind": "TEXT NOT NULL CHECK(dependency_kind IN ('HSMT_GROUP_EVALUATION', 'CROSS_LOT_DISCOUNT', 'AGGREGATE_CAPACITY', 'AWARD_OPTIMIZATION', 'FINANCIAL_DISCLOSURE'))",
            "reason": "TEXT NOT NULL CHECK(trim(reason) != '')",
            "must_move_together": "INTEGER NOT NULL DEFAULT 1 CHECK(must_move_together IN (0,1))",
            "policy_version": "INTEGER NOT NULL DEFAULT 1 CHECK(policy_version > 0)",
            "is_active": "INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE RESTRICT"
        ]
    },
    "nhom_phu_thuoc_phan_lo_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "dependency_group_id": "TEXT NOT NULL",
            "lot_id": "TEXT NOT NULL",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (dependency_group_id) REFERENCES nhom_phu_thuoc_phan_lo(id) ON DELETE CASCADE",
            "FOREIGN KEY (lot_id) REFERENCES goi_thau_phan_lo(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, dependency_group_id, lot_id)"
        ]
    },
    "ho_so_nghiep_vu_lcnt": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "batch_id": "TEXT NOT NULL",
            "artifact_type": "TEXT NOT NULL CHECK(artifact_type IN ('SINGLE_STAGE_EVALUATION_REPORT', 'TECHNICAL_EVALUATION_REPORT', 'TECHNICAL_APPRAISAL_REPORT', 'TECHNICAL_APPROVAL_DECISION', 'FINANCIAL_OPENING_MINUTES', 'FINANCIAL_EVALUATION_REPORT', 'RESULT_APPRAISAL_REPORT', 'RESULT_APPROVAL_DECISION'))",
            "status": "TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'FINAL', 'VOID', 'SUPERSEDED'))",
            "document_number": "TEXT",
            "document_date": "TEXT",
            "revision": "INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)",
            "snapshot_schema_version": "INTEGER NOT NULL DEFAULT 1 CHECK(snapshot_schema_version > 0)",
            "snapshot_json": "TEXT NOT NULL DEFAULT '{}'",
            "scope_hash": "TEXT NOT NULL CHECK(trim(scope_hash) != '')",
            "content_digest": "TEXT",
            "finalized_by_id": "TEXT",
            "finalized_at": "TEXT",
            "voided_by_id": "TEXT",
            "voided_at": "TEXT",
            "void_reason": "TEXT",
            "supersedes_id": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (batch_id) REFERENCES dot_xu_ly_phan_lo(id) ON DELETE RESTRICT",
            "FOREIGN KEY (finalized_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL",
            "FOREIGN KEY (voided_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL",
            "FOREIGN KEY (supersedes_id) REFERENCES ho_so_nghiep_vu_lcnt(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, batch_id, artifact_type, revision)",
            "CHECK((status != 'FINAL') OR (document_number IS NOT NULL AND trim(document_number) != '' AND document_date IS NOT NULL))",
            "CHECK((status != 'VOID') OR (void_reason IS NOT NULL AND trim(void_reason) != ''))"
        ]
    },
    "ho_so_nghiep_vu_lcnt_phan_lo": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "artifact_id": "TEXT NOT NULL",
            "lot_id": "TEXT NOT NULL",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (artifact_id) REFERENCES ho_so_nghiep_vu_lcnt(id) ON DELETE RESTRICT",
            "FOREIGN KEY (lot_id) REFERENCES goi_thau_phan_lo(id) ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, artifact_id, lot_id)"
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
            "ty_le": "REAL CHECK(ty_le IS NULL OR (typeof(ty_le) IN ('integer', 'real') AND ty_le BETWEEN 0 AND 100 AND ty_le = round(ty_le, 4)))",
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
            "ten_hop_dong": "TEXT NOT NULL CHECK(trim(ten_hop_dong) != '')",
            "so_hop_dong": "TEXT NOT NULL CHECK(trim(so_hop_dong) != '')",
            "ngay_ky": "TEXT NOT NULL CHECK(date(ngay_ky) IS NOT NULL)",
            "chu_dau_tu_id": "TEXT NOT NULL CHECK(trim(chu_dau_tu_id) != '')",
            "nha_thau_id": "TEXT NOT NULL CHECK(trim(nha_thau_id) != '')",
            "ngay_thanh_ly": "TEXT",
            "chu_dau_tu_thanh_ly_id": "TEXT",
            "nha_thau_thanh_ly_id": "TEXT",
            "ke_hoach_id": "TEXT NOT NULL CHECK(trim(ke_hoach_id) != '')",
            "gia_tri": "INTEGER NOT NULL CHECK(typeof(gia_tri) = 'integer' AND gia_tri >= 0)",
            "loai_hop_dong": "TEXT NOT NULL CHECK(trim(loai_hop_dong) != '')",
            "thoi_gian_thuc_hien": "TEXT NOT NULL CHECK(trim(thoi_gian_thuc_hien) != '')",
            "trang_thai_hop_dong": "TEXT NOT NULL DEFAULT 'Đang thực hiện' CHECK(trim(trang_thai_hop_dong) != '')",
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
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE RESTRICT",
            "FOREIGN KEY (organization_id, trang_thai_hop_dong) REFERENCES danh_muc_trang_thai_hop_dong(organization_id, name) ON UPDATE CASCADE ON DELETE RESTRICT"
        ],
        "unique_constraints": [
            "CHECK(NULLIF(ngay_ky, '') IS NULL OR NULLIF(ngay_thanh_ly, '') IS NULL OR (date(ngay_ky) IS NOT NULL AND date(ngay_thanh_ly) IS NOT NULL AND date(ngay_thanh_ly) >= date(ngay_ky)))",
            "CHECK((co_qd_chi_dinh = 0 AND COALESCE(trim(so_qd_chi_dinh), '') = '' AND COALESCE(trim(ngay_qd_chi_dinh), '') = '') OR (co_qd_chi_dinh = 1 AND COALESCE(trim(so_qd_chi_dinh), '') != '' AND date(ngay_qd_chi_dinh) IS NOT NULL AND date(ngay_qd_chi_dinh) <= date(ngay_ky)))"
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



    "danh_muc_trang_thai_hop_dong": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "name": "TEXT NOT NULL",
            "color": "TEXT NOT NULL DEFAULT '#64748b'",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "unique_constraints": ["UNIQUE(organization_id, name)"]
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
            "ty_le_giam_gia": "REAL CHECK(ty_le_giam_gia IS NULL OR (typeof(ty_le_giam_gia) IN ('integer', 'real') AND ty_le_giam_gia BETWEEN 0 AND 100 AND ty_le_giam_gia = round(ty_le_giam_gia, 4)))",
            "gia_sau_giam_gia": "INTEGER CHECK(gia_sau_giam_gia IS NULL OR (typeof(gia_sau_giam_gia) = 'integer' AND gia_sau_giam_gia >= 0))",
            "tong_gia_tri_cong_uu_dai": "INTEGER CHECK(tong_gia_tri_cong_uu_dai IS NULL OR (typeof(tong_gia_tri_cong_uu_dai) = 'integer' AND tong_gia_tri_cong_uu_dai >= 0))",
            "gia_so_sanh_sau_uu_dai": "INTEGER CHECK(gia_so_sanh_sau_uu_dai IS NULL OR (typeof(gia_so_sanh_sau_uu_dai) = 'integer' AND gia_so_sanh_sau_uu_dai >= 0))",
            "gia_danh_gia_sau_uu_dai": "INTEGER CHECK(gia_danh_gia_sau_uu_dai IS NULL OR (typeof(gia_danh_gia_sau_uu_dai) = 'integer' AND gia_danh_gia_sau_uu_dai >= 0))",
            "trang_thai_tinh_uu_dai": "TEXT NOT NULL DEFAULT 'empty' CHECK(trang_thai_tinh_uu_dai IN ('empty', 'draft', 'ready', 'stale'))",
            "uu_dai_tinh_luc": "TEXT",
            "uu_dai_input_hash": "TEXT NOT NULL DEFAULT '' CHECK(length(uu_dai_input_hash) <= 128)",
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
        },
        "unique_constraints": [
            "UNIQUE(organization_id, goi_thau_id, id)"
        ]
    },
    "thong_tin_mo_thau_lien_danh_thanh_vien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "thong_tin_mo_thau_id": "TEXT NOT NULL",
            "thanh_vien_nha_thau_id": "TEXT NOT NULL",
            "ten_nha_thau": "TEXT",
            "ma_nha_thau": "TEXT",
            "ma_so_thue": "TEXT",
            "vai_tro": "TEXT NOT NULL CHECK(vai_tro IN ('Đứng đầu liên danh', 'Thành viên liên danh'))",
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
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, thong_tin_mo_thau_id, thanh_vien_nha_thau_id)"
        ]
    },
    "nha_thau_tham_du_mo_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "thong_tin_mo_thau_id": "TEXT NOT NULL",
            "goi_thau_id": "TEXT NOT NULL",
            "lot_scope": "TEXT NOT NULL CHECK(trim(lot_scope) != '')",
            "nha_thau_goc_id": "TEXT NOT NULL",
            "nha_thau_phien_ban_id": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, thong_tin_mo_thau_id, nha_thau_goc_id)",
            "UNIQUE(organization_id, goi_thau_id, lot_scope, nha_thau_goc_id)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (nha_thau_goc_id) REFERENCES nha_thau(id) ON DELETE RESTRICT",
            "FOREIGN KEY (nha_thau_phien_ban_id) REFERENCES nha_thau(id) ON DELETE RESTRICT"
        ]
    },
    "to_chuc": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_to_chuc": "TEXT NOT NULL",
            "trang_thai": "TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai IN ('active', 'suspended'))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        }
    },
    "thanh_vien_to_chuc": {
        "columns": {
            "user_id": "TEXT NOT NULL",
            "organization_id": "TEXT NOT NULL",
            "vai_tro_trong_to_chuc": "TEXT NOT NULL DEFAULT 'employee' CHECK(vai_tro_trong_to_chuc IN ('manager', 'employee'))",
            "ten_nhan_su": "TEXT",
            "so_dien_thoai": "TEXT",
            "trang_thai_thanh_vien": "TEXT NOT NULL DEFAULT 'active' CHECK(trang_thai_thanh_vien IN ('active', 'left'))",
            "left_at": "TEXT",
            "left_by": "TEXT",
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
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
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
            "deleted_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "record_snapshot_json": "TEXT",
            "delete_actor_user_id": "TEXT",
            "delete_mutation_id": "TEXT"
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

    "word_mapping_overrides": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL CHECK(owner_type IN ('organization', 'personal'))",
            "mapping_key": "TEXT NOT NULL CHECK(mapping_key != '')",
            "ten_bien_override": "TEXT",
            "source_table_override": "TEXT",
            "source_column_override": "TEXT",
            "mo_ta_override": "TEXT",
            "disabled": "INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1))",
            "base_version": "INTEGER NOT NULL CHECK(base_version > 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "primary_keys": ["organization_id", "mapping_key"]
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
            "min_available_version": "INTEGER NOT NULL DEFAULT 0 CHECK(min_available_version >= 0)",
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
    "account_subscriptions": {
        "columns": {
            "user_id": "TEXT PRIMARY KEY",
            "package_id": "TEXT NOT NULL",
            "status": "TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'expired', 'cancelled'))",
            "starts_at": "INTEGER NOT NULL CHECK(starts_at > 0)",
            "expires_at": "INTEGER CHECK(expires_at IS NULL OR expires_at > starts_at)",
            "revision": "INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
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
            "hoan_thanh_luc": "TEXT",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE"
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
            "diem_toi_da": "REAL CHECK(diem_toi_da IS NULL OR (diem_toi_da >= 0 AND diem_toi_da = round(diem_toi_da, 4)))",
            "trong_so": "REAL CHECK(trong_so IS NULL OR (trong_so >= 0 AND trong_so <= 100 AND trong_so = round(trong_so, 4)))",
            "nhom_danh_gia": "TEXT NOT NULL DEFAULT 'technical' CHECK(nhom_danh_gia IN ('validity', 'capacity', 'technical', 'financial'))",
            "loai_ket_qua": "TEXT NOT NULL DEFAULT 'pass_fail' CHECK(loai_ket_qua IN ('pass_fail', 'score', 'text', 'number'))",
            "bat_buoc": "INTEGER NOT NULL DEFAULT 1 CHECK(bat_buoc IN (0,1))",
            "tieu_chi_cha_id": "TEXT",
            "thu_tu": "INTEGER NOT NULL DEFAULT 0 CHECK(thu_tu >= 0)",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (vong_danh_gia_id) REFERENCES vong_danh_gia(id) ON DELETE CASCADE",
            "FOREIGN KEY (tieu_chi_cha_id) REFERENCES tieu_chi_danh_gia(id) ON DELETE SET NULL",
        ],
        "unique_constraints": ["UNIQUE(organization_id, vong_danh_gia_id, ma_tieu_chi)"]
    },
    "bao_cao_danh_gia_nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "vong_danh_gia_id": "TEXT NOT NULL",
            "thong_tin_mo_thau_id": "TEXT NOT NULL",
            "trang_thai": "TEXT NOT NULL DEFAULT 'draft' CHECK(trang_thai IN ('draft', 'completed'))",
            "ket_luan": "TEXT",
            "hoan_thanh_luc": "TEXT",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
        "foreign_keys": [
            "FOREIGN KEY (vong_danh_gia_id) REFERENCES vong_danh_gia(id) ON DELETE CASCADE",
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, vong_danh_gia_id, thong_tin_mo_thau_id)"
        ],
    },
    "chi_tiet_danh_gia_nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "bao_cao_danh_gia_nha_thau_id": "TEXT NOT NULL",
            "tieu_chi_danh_gia_id": "TEXT NOT NULL",
            "ket_qua": "TEXT NOT NULL DEFAULT 'pending' CHECK(ket_qua IN ('pending', 'pass', 'fail', 'not_applicable'))",
            "diem": "REAL CHECK(diem IS NULL OR (diem >= 0 AND diem = round(diem, 4)))",
            "noi_dung_hsdt": "TEXT",
            "nhan_xet": "TEXT",
            "ly_do_khong_dat": "TEXT",
            "yeu_cau_lam_ro": "TEXT",
            "ket_qua_lam_ro": "TEXT",
            "tai_lieu_tham_chieu": "TEXT",
            "extension_json": "TEXT NOT NULL DEFAULT '{\"schemaVersion\":1}' CHECK(json_valid(extension_json) AND length(CAST(extension_json AS BLOB)) <= 65536)",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
        "foreign_keys": [
            "FOREIGN KEY (bao_cao_danh_gia_nha_thau_id) REFERENCES bao_cao_danh_gia_nha_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (tieu_chi_danh_gia_id) REFERENCES tieu_chi_danh_gia(id) ON DELETE CASCADE",
        ],
        "unique_constraints": [
            "UNIQUE(organization_id, bao_cao_danh_gia_nha_thau_id, tieu_chi_danh_gia_id)"
        ],
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
            "gia_xep_hang": "INTEGER CHECK(gia_xep_hang IS NULL OR (typeof(gia_xep_hang) = 'integer' AND gia_xep_hang >= 0))",
            "gia_de_nghi_trung_thau": "INTEGER CHECK(gia_de_nghi_trung_thau IS NULL OR (typeof(gia_de_nghi_trung_thau) = 'integer' AND gia_de_nghi_trung_thau >= 0))",
            "chap_thuan_gia_de_nghi_trung_thau_duoi_50": "INTEGER CHECK(chap_thuan_gia_de_nghi_trung_thau_duoi_50 IS NULL OR (typeof(chap_thuan_gia_de_nghi_trung_thau_duoi_50) = 'integer' AND chap_thuan_gia_de_nghi_trung_thau_duoi_50 IN (0, 1)))",
            "danh_gia_ket_luan": "TEXT",
            "diem": "REAL CHECK(diem IS NULL OR (diem >= 0 AND diem = round(diem, 4)))",
            "ly_do_loai": "TEXT",
            "lam_ro_hop_le": "TEXT",
            "lam_ro_nang_luc": "TEXT",
            "lam_ro_ky_thuat": "TEXT",
            "lam_ro_tai_chinh": "TEXT",
            "nguyen_nhan_khong_dat_hop_le": "TEXT",
            "nguyen_nhan_khong_dat_nang_luc": "TEXT",
            "nguyen_nhan_khong_dat_ky_thuat": "TEXT",
            "danh_gia_luc": "TEXT",
            "sync_version": "INTEGER DEFAULT 0",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (organization_id, goi_thau_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, goi_thau_id, id) ON DELETE CASCADE"
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
            "request_hash": "TEXT",
            "response_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))"
        },
        "primary_keys": ["organization_id", "actor_user_id", "client_mutation_id"],
        "foreign_keys": [
            "FOREIGN KEY (actor_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "record_edit_ownership": {
        "columns": {
            "organization_id": "TEXT NOT NULL",
            "table_name": (
                "TEXT NOT NULL CHECK(table_name IN ("
                "'chu_dau_tu', 'ke_hoach_lcnt', 'goi_thau', "
                "'thong_tin_mo_thau', 'hop_dong', 'nha_thau', 'chuyen_gia'))"
            ),
            "record_id": "TEXT NOT NULL",
            "user_id": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "primary_keys": ["organization_id", "table_name", "record_id"],
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_moc_tien_do": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL CHECK(trim(goi_thau_id) != '')",
            "milestone_key": "TEXT NOT NULL CHECK(length(trim(milestone_key)) BETWEEN 1 AND 120)",
            "instance_key": "TEXT NOT NULL DEFAULT '' CHECK(length(instance_key) <= 160)",
            "source_entity_id": "TEXT NOT NULL DEFAULT '' CHECK(length(source_entity_id) <= 160)",
            "ma_nhom": "TEXT NOT NULL CHECK(ma_nhom IN ('I', 'II', 'III', 'IV', 'V'))",
            "ten_nhom": "TEXT NOT NULL CHECK(length(trim(ten_nhom)) BETWEEN 1 AND 160)",
            "ma_moc": "TEXT NOT NULL CHECK(length(trim(ma_moc)) BETWEEN 3 AND 10)",
            "cong_viec": "TEXT NOT NULL CHECK(length(trim(cong_viec)) BETWEEN 1 AND 300)",
            "don_vi_ban_hanh": "TEXT NOT NULL DEFAULT '' CHECK(length(don_vi_ban_hanh) <= 300)",
            "so_van_ban": "TEXT NOT NULL DEFAULT '' CHECK(length(so_van_ban) <= 300)",
            "ngay_du_kien": "TEXT CHECK(ngay_du_kien IS NULL OR (length(ngay_du_kien) = 10 AND date(ngay_du_kien) IS NOT NULL))",
            "ngay_thuc_te": "TEXT CHECK(ngay_thuc_te IS NULL OR (length(ngay_thuc_te) = 10 AND date(ngay_thuc_te) IS NOT NULL))",
            "ghi_chu": "TEXT NOT NULL DEFAULT '' CHECK(length(ghi_chu) <= 2000)",
            "source_key": "TEXT NOT NULL DEFAULT '' CHECK(length(source_key) <= 160)",
            "source_mode": "TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_mode IN ('AUTO', 'MANUAL'))",
            "is_optional": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(is_optional) = 'integer' AND is_optional IN (0, 1))",
            "trang_thai": "TEXT NOT NULL DEFAULT 'PENDING' CHECK(trang_thai IN ('PENDING', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE'))",
            "sort_order": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sort_order) = 'integer' AND sort_order BETWEEN 0 AND 9999)",
            "template_version": "INTEGER NOT NULL DEFAULT 2 CHECK(typeof(template_version) = 'integer' AND template_version >= 1)",
            "sync_version": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sync_version) = 'integer' AND sync_version >= 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, goi_thau_id, milestone_key, instance_key)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_dieu_chinh_hsmt": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL CHECK(trim(goi_thau_id) != '')",
            "sequence": "INTEGER NOT NULL CHECK(typeof(sequence) = 'integer' AND sequence > 0)",
            "reason": "TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 2000)",
            "submission_number": "TEXT NOT NULL DEFAULT '' CHECK(length(submission_number) <= 300)",
            "submission_date": "TEXT CHECK(submission_date IS NULL OR date(submission_date) IS NOT NULL)",
            "appraisal_report_number": "TEXT NOT NULL DEFAULT '' CHECK(length(appraisal_report_number) <= 300)",
            "appraisal_report_date": "TEXT CHECK(appraisal_report_date IS NULL OR date(appraisal_report_date) IS NOT NULL)",
            "approval_decision_number": "TEXT NOT NULL DEFAULT '' CHECK(length(approval_decision_number) <= 300)",
            "approval_decision_date": "TEXT CHECK(approval_decision_date IS NULL OR date(approval_decision_date) IS NOT NULL)",
            "published_at": "TEXT",
            "archived_at": "TEXT",
            "created_by_id": "TEXT",
            "updated_by_id": "TEXT",
            "sync_version": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sync_version) = 'integer' AND sync_version >= 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, goi_thau_id, sequence)",
            "UNIQUE(organization_id, goi_thau_id, id)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE",
            "FOREIGN KEY (created_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL",
            "FOREIGN KEY (updated_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"
        ]
    },
    "pending_email_changes": {
        "columns": {
            "user_id": "TEXT PRIMARY KEY",
            "current_email_norm": "TEXT NOT NULL CHECK(current_email_norm != '')",
            "pending_email": "TEXT NOT NULL CHECK(pending_email != '')",
            "pending_email_norm": "TEXT NOT NULL UNIQUE CHECK(pending_email_norm != '')",
            "otp_hash": "TEXT NOT NULL CHECK(otp_hash != '')",
            "requested_at": "INTEGER NOT NULL CHECK(requested_at > 0)",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > requested_at)",
            "verified_at": "INTEGER",
            "requested_ip": "TEXT"
        },
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE"
        ],
        "unique_constraints": [
            "CHECK(pending_email_norm != current_email_norm)",
            "CHECK(verified_at IS NULL OR (verified_at >= requested_at AND verified_at <= expires_at))"
        ]
    },
    "document_export_capabilities": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "user_id": "TEXT NOT NULL CHECK(user_id != '')",
            "financial": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(financial) = 'integer' AND financial IN (0, 1))",
            "identity": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(identity) = 'integer' AND identity IN (0, 1))",
            "signature": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(signature) = 'integer' AND signature IN (0, 1))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        },
        "primary_keys": ["organization_id", "user_id"],
        "foreign_keys": [
            "FOREIGN KEY (user_id, organization_id) REFERENCES thanh_vien_to_chuc(user_id, organization_id) ON DELETE CASCADE"
        ]
    },
    "nhat_ky_thuc_hien": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "target_type": "TEXT NOT NULL CHECK(target_type IN ('goithau', 'hopdong'))",
            "target_id": "TEXT NOT NULL CHECK(target_id != '')",
            "target_root_id": "TEXT NOT NULL CHECK(target_root_id != '')",
            "action": "TEXT NOT NULL CHECK(action IN ('goithau.created', 'goithau.updated', 'hopdong.created', 'hopdong.updated', 'package_document.uploaded', 'package_document.replaced', 'package_document.deleted', 'assignment.added', 'assignment.removed'))",
            "actor_user_id": "TEXT",
            "actor_name_snapshot": "TEXT NOT NULL DEFAULT 'Không xác định'",
            "occurred_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "related_document_id": "TEXT",
            "related_assignment_id": "TEXT",
            "client_mutation_id": "TEXT",
            "request_id": "TEXT",
            "metadata_json": "TEXT NOT NULL DEFAULT '{}' CHECK(length(metadata_json) <= 32768)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
    "phan_cong_nhan_su_lich_su": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "organization_id": "TEXT NOT NULL",
            "assignment_id": "TEXT NOT NULL",
            "id_nhan_vien": "TEXT NOT NULL",
            "id_muc_tieu": "TEXT NOT NULL",
            "loai_doi_tuong": "TEXT NOT NULL CHECK(loai_doi_tuong IN ('kehoach', 'goithau', 'hopdong'))",
            "assigned_at": "TEXT",
            "ended_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "ended_by": "TEXT",
            "successor_user_id": "TEXT",
            "reason": "TEXT NOT NULL DEFAULT 'member_left'"
        },
        "unique_constraints": [
            "UNIQUE(organization_id, assignment_id, ended_at)"
        ]
    },
    "audit_chain_heads": {
        "columns": {
            "chain_id": "TEXT PRIMARY KEY CHECK(chain_id != '')",
            "last_sequence": "INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0)",
            "last_log_id": "INTEGER",
            "last_hash": "TEXT NOT NULL CHECK(length(last_hash) = 64)",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))"
        }
    },
    "audit_log": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "chain_id": "TEXT NOT NULL CHECK(chain_id != '')",
            "sequence": "INTEGER NOT NULL CHECK(sequence > 0)",
            "actor_user_id": "TEXT",
            "organization_id": "TEXT",
            "action": "TEXT NOT NULL",
            "target_type": "TEXT",
            "target_id": "TEXT",
            "ip_address": "TEXT",
            "metadata_json": "TEXT",
            "created_at": "TEXT NOT NULL DEFAULT (datetime(\'now\'))",
            "previous_hash": "TEXT NOT NULL CHECK(length(previous_hash) = 64)",
            "entry_hash": "TEXT NOT NULL CHECK(length(entry_hash) = 64)"
        },
        "unique_constraints": [
            "UNIQUE(chain_id, sequence)",
            "UNIQUE(chain_id, previous_hash)",
            "UNIQUE(chain_id, entry_hash)"
        ],
        "foreign_keys": [
            "FOREIGN KEY (chain_id) REFERENCES audit_chain_heads(chain_id) ON DELETE RESTRICT"
        ]
    }
}


_SIMPLE_ID_FK = re.compile(
    r"^FOREIGN KEY \((?P<column>[a-zA-Z0-9_]+)\) "
    r"REFERENCES (?P<table>[a-zA-Z0-9_]+)\(id\)(?P<suffix>.*)$"
)

ROW_VERSION_TABLES = frozenset({
    "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "chuyen_gia", "nha_thau",
    "hop_dong", "phan_cong_nhan_su", "danh_muc_trang_thai_hop_dong",
    "thong_tin_mo_thau", "ma_tran_phan_quyen", "goi_thau_phan_lo",
    "goi_thau_hang_hoa",
    "hang_hoa_du_thau_nha_thau",
    "dot_xu_ly_phan_lo", "dot_xu_ly_phan_lo_chi_tiet",
    "nhom_phu_thuoc_phan_lo", "ho_so_nghiep_vu_lcnt",
    "goi_thau_dieu_chinh_hsmt",
})


def _apply_row_versions(schema):
    for table_name in ROW_VERSION_TABLES:
        columns = schema[table_name]["columns"]
        if "row_version" not in columns:
            columns["row_version"] = (
                "INTEGER NOT NULL DEFAULT 1 "
                "CHECK(typeof(row_version) = 'integer' AND row_version > 0)"
            )


def _apply_numeric_versions(schema):
    """Use numeric ordering for entity and synchronization versions."""
    for table_spec in schema.values():
        columns = table_spec.get("columns", {})
        if "phien_ban" in columns:
            columns["phien_ban"] = (
                "INTEGER NOT NULL DEFAULT 0 "
                "CHECK(typeof(phien_ban) = 'integer' AND phien_ban >= 0)"
            )
        if "sync_version" in columns:
            columns["sync_version"] = (
                "INTEGER NOT NULL DEFAULT 0 "
                "CHECK(typeof(sync_version) = 'integer' AND sync_version >= 0)"
            )


def _apply_tenant_constraints(schema):
    """Materialize tenant isolation in every clean-schema table.

    A globally unique ``id`` is not sufficient: child and parent must also carry
    the same organization key so PostgreSQL itself rejects cross-tenant links.
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

        if "owner_type" in columns:
            upgraded_foreign_keys.append(
                "CHECK((owner_type = 'personal' AND organization_id LIKE 'personal:%') "
                "OR (owner_type = 'organization' AND organization_id NOT LIKE 'personal:%'))"
            )

        table_spec["foreign_keys"] = list(dict.fromkeys(upgraded_foreign_keys))

        composite_tenant_id = (
            str(columns.get("id", "")).startswith("TEXT")
            and "NOT NULL" in str(columns.get("organization_id", "")).upper()
        )
        if composite_tenant_id:
            table_spec["primary_keys"] = ["organization_id", "id"]
            unique_constraints = [
                constraint
                for constraint in table_spec.get("unique_constraints", [])
                if constraint.replace(" ", "").upper()
                != "UNIQUE(ORGANIZATION_ID,ID)"
            ]
            table_spec["unique_constraints"] = unique_constraints
        elif "id" in columns:
            tenant_unique = "UNIQUE(organization_id, id)"
            unique_constraints = list(table_spec.get("unique_constraints", []))
            if tenant_unique not in unique_constraints:
                unique_constraints.append(tenant_unique)
            table_spec["unique_constraints"] = unique_constraints


_apply_numeric_versions(SCHEMA_DINH_NGHIA)
_apply_row_versions(SCHEMA_DINH_NGHIA)
_apply_tenant_constraints(SCHEMA_DINH_NGHIA)
