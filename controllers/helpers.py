import sys
import os
import json
import base64
import uuid
import hashlib
import secrets
from datetime import datetime
import re
import traceback
import smtplib
# import random — removed: unused import
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from starlette.middleware.base import BaseHTTPMiddleware

# ==========================================
# CẤU HÌNH ĐƯỜNG DẪN & RE-EXPORT CÁC THÀNH PHẦN CON
# ==========================================

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
models_dir = os.path.join(project_root, 'models')
controllers_dir = os.path.join(project_root, 'controllers')

sys.path.insert(0, project_root)
sys.path.append(models_dir)
sys.path.append(controllers_dir)

# Nạp các thành phần từ helper nhỏ hơn để tương thích ngược
import db_helper
from db_helper import (
    load_and_register,
    models,
    database
)

import media_helper
from media_helper import (
    save_base64_image,
    load_base64_image
)

import auth_helper
from auth_helper import (
    ROLE_HIERARCHY,
    get_effective_roles,
    hash_password,
    verify_password,
    SessionRole,
    verify_session,
    _session_cache_invalidate
)

SCHEMA_DINH_NGHIA = {
    "goi_dich_vu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_goi": "TEXT",
            "gia_ca": "REAL",
            "han_muc_nhan_su": "INTEGER",
            "mo_ta": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "tai_khoan": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_dang_nhap": "TEXT UNIQUE",
            "mat_khau": "TEXT",
            "ho_ten": "TEXT",
            "vai_tro": "TEXT",
            "email": "TEXT",
            "token_phien": "TEXT",
            "anh_dai_dien": "TEXT",
            "goi_dich_vu_id": "TEXT DEFAULT 'silver'",
            "ngay_bat_dau_goi": "TEXT",
            "ngay_het_han_goi": "TEXT",
            "han_su_dung_token": "TEXT",
            "thong_tin_thiet_bi_cuoi": "TEXT",
            "da_xac_minh": "INTEGER DEFAULT 0",
            "ma_xac_minh": "TEXT",
            "han_xac_minh": "INTEGER",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": ["FOREIGN KEY (goi_dich_vu_id) REFERENCES goi_dich_vu(id) ON DELETE SET NULL"]
    },
    "chu_dau_tu": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "ma_chu_dau_tu": "TEXT",
            "ten_chu_dau_tu": "TEXT NOT NULL",
            "ma_so_thue": "TEXT",
            "chuc_vu_nguoi_dung_dau": "TEXT",
            "nguoi_ky_quyet_dinh": "TEXT",
            "chuc_vu_nguoi_ky": "TEXT",
            "danh_xung": "TEXT DEFAULT 'Ông'",
            "dia_chi": "TEXT",
            "so_dien_thoai": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "email": "TEXT",
            "ma_qhns": "TEXT",
            "co_quan_chu_quan": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "ke_hoach_lcnt": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "id_goc": "TEXT",
            "ma_ke_hoach": "TEXT",
            "ma_du_an": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "ten_ke_hoach": "TEXT NOT NULL",
            "ten_du_an_du_toan": "TEXT",
            "loai_hinh_mua_sam": "TEXT",
            "chu_dau_tu_id": "TEXT",
            "tong_muc_dau_tu": "REAL",
            "is_tong_muc_tu_dong": "INTEGER DEFAULT 0",
            "ngay_phe_duyet": "TEXT",
            "quyet_dinh_phe_duyet": "TEXT",
            "thoi_gian_dang_tai": "TEXT",
            "cv_da_thuc_hien": "TEXT",
            "cv_khong_ap_dung": "TEXT",
            "cv_chua_du_dieu_kien": "TEXT",
            "nguon_von": "TEXT",
            "thoi_gian_du_an": "TEXT",
            "dia_diem_quy_mo": "TEXT",
            "thong_tin_khac": "TEXT",
            "so_qd_phe_duyet_du_an": "TEXT",
            "ngay_qd_phe_duyet_du_an": "TEXT",
            "co_quan_phe_duyet_du_an": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": ["FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE SET NULL"]
    },
    "nha_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "id_goc": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
            "ma_nha_thau": "TEXT",
            "ten_nha_thau": "TEXT NOT NULL",
            "loai_nha_thau": "TEXT",
            "thanh_vien_lien_danh": "TEXT",
            "ma_so_thue": "TEXT",
            "nguoi_dai_dien": "TEXT",
            "danh_xung": "TEXT DEFAULT 'Ông'",
            "so_dien_thoai": "TEXT",
            "email": "TEXT",
            "dia_chi": "TEXT",
            "so_tai_khoan": "TEXT",
            "noi_mo_tai_khoan": "TEXT",
            "ma_ngan_hang": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "goi_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "id_goc": "TEXT",
            "ma_goi_thau": "TEXT",
            "phien_ban": "TEXT NOT NULL DEFAULT '00'",
            "is_latest": "INTEGER NOT NULL DEFAULT 1",
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
            "tuy_chon_mua_them": "TEXT DEFAULT 'Không'",
            "thoi_gian_to_chuc": "TEXT",
            "thoi_gian_bat_dau_to_chuc": "TEXT",
            "phan_lo": "TEXT DEFAULT 'Không'",
            "phan_lo_list": "TEXT",
            "tuy_chon_mua_them_list": "TEXT",
            "thoi_gian_dang_tai": "TEXT",
            "thoi_gian_dong_thau": "TEXT",
            "thoi_gian_mo_thau": "TEXT",
            "so_quyet_dinh": "TEXT",
            "ngay_quyet_dinh": "TEXT",
            "so_quyet_dinh_ket_qua": "TEXT",
            "ngay_quyet_dinh_ket_qua": "TEXT",
            "gia_han_list": "TEXT",
            "yeu_cau_lam_ro_list": "TEXT",
            "tra_loi_lam_ro_list": "TEXT",
            "thoi_gian_goi_thau": "TEXT",
            "thoi_gian_hop_dong": "TEXT",
            "awarded_phan_lo_list": "TEXT",
            "gia_tri_dam_bao_du_thau": "REAL",
            "hieu_luc_hsdt": "INTEGER",
            "hieu_luc_dam_bao_du_thau": "INTEGER",
            "danh_gia_hsdt_metadata": "TEXT",
            "trang_thai": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (ke_hoach_id) REFERENCES ke_hoach_lcnt(id) ON DELETE CASCADE",
            "FOREIGN KEY (nha_thau_trung_thau_id) REFERENCES nha_thau(id) ON DELETE SET NULL"
        ]
    },
    "chuyen_gia": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
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
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "hop_dong": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "ten_hop_dong": "TEXT",
            "so_hop_dong": "TEXT",
            "ngay_ky": "TEXT",
            "chu_dau_tu_id": "TEXT",
            "nha_thau_id": "TEXT",
            "gia_tri": "REAL",
            "loai_hop_dong": "TEXT",
            "thoi_gian_thuc_hien": "TEXT",
            "trang_thai_ho_so": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (chu_dau_tu_id) REFERENCES chu_dau_tu(id) ON DELETE SET NULL",
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE SET NULL"
        ]
    },
    "hop_dong_goi_thau": {
        "columns": {
            "hop_dong_id": "TEXT",
            "goi_thau_id": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "primary_keys": ["hop_dong_id", "goi_thau_id"],
        "foreign_keys": [
            "FOREIGN KEY (hop_dong_id) REFERENCES hop_dong(id) ON DELETE CASCADE",
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE"
        ]
    },
    "phan_cong_nhan_su": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "id_nhan_vien": "TEXT NOT NULL",
            "id_muc_tieu": "TEXT NOT NULL",
            "loai_doi_tuong": "TEXT NOT NULL",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "unique_constraints": [
            "UNIQUE(id_nhan_vien, id_muc_tieu, loai_doi_tuong)"
        ]
        # Note: id_nhan_vien references tai_khoan.id but FK constraint omitted intentionally
        # because tai_khoan uses ON DELETE CASCADE would auto-delete assignments,
        # which may not always be desired (employee re-assignment scenarios).
    },
    "trang_thai_ho_so_giay": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "org_id": "TEXT",
            "name": "TEXT",
            "color": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "thong_tin_mo_thau": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
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
            "thanh_vien_lien_danh": "TEXT",
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
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (nha_thau_id) REFERENCES nha_thau(id) ON DELETE SET NULL"
        ]
    },
    "to_chuc": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "ten_to_chuc": "TEXT UNIQUE NOT NULL",
            "quan_ly_id": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "foreign_keys": ["FOREIGN KEY (quan_ly_id) REFERENCES tai_khoan(id) ON DELETE SET NULL"]
    },
    "thanh_vien_to_chuc": {
        "columns": {
            "user_id": "TEXT NOT NULL",
            "to_chuc_id": "TEXT NOT NULL",
            "vai_tro_trong_to_chuc": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "primary_keys": ["user_id", "to_chuc_id"],
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
            "FOREIGN KEY (to_chuc_id) REFERENCES to_chuc(id) ON DELETE CASCADE"
        ]
    },
    "goi_thau_chuyen_gia": {
        "columns": {
            "goi_thau_id": "TEXT NOT NULL",
            "chuyen_gia_id": "TEXT NOT NULL",
            "loai": "TEXT NOT NULL DEFAULT 'chuyen_gia'",
            "chuc_vu": "TEXT",
            "cong_viec": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "primary_keys": ["goi_thau_id", "chuyen_gia_id", "loai"],
        "foreign_keys": [
            "FOREIGN KEY (goi_thau_id) REFERENCES goi_thau(id) ON DELETE CASCADE",
            "FOREIGN KEY (chuyen_gia_id) REFERENCES chuyen_gia(id) ON DELETE CASCADE"
        ]
    },
    "deleted_records": {
        "columns": {
            "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "table_name": "TEXT NOT NULL",
            "record_id": "TEXT NOT NULL",
            "owner_id": "TEXT NOT NULL",
            "deleted_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        }
    },
    "cau_hinh_bien_word": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT",
            "ten_bien": "TEXT NOT NULL",
            "source_table": "TEXT NOT NULL",
            "source_column": "TEXT NOT NULL",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "unique_constraints": [
            "UNIQUE(owner_id, ten_bien)"
        ]
    },
    # Bảng ma_tran_phan_quyen: lưu phân quyền theo module của từng nhân viên trong tổ chức.
    # Trước đây chỉ lưu trên IndexedDB client-side, dẫn đến mất dữ liệu khi đổi thiết bị.
    # Nay đồng bộ lên server để đảm bảo bền vững.
    "ma_tran_phan_quyen": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "owner_id": "TEXT NOT NULL",
            "emp_id": "TEXT NOT NULL",
            "kehoach": "TEXT",
            "goithau": "TEXT",
            "chudautu": "TEXT",
            "nhathau": "TEXT",
            "chuyengia": "TEXT",
            "hopdong": "TEXT",
            "thongtinmothau": "TEXT",
            "created_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))",
            "updated_at": "INTEGER NOT NULL DEFAULT (strftime('%s','now'))"
        },
        "unique_constraints": [
            "UNIQUE(owner_id, emp_id)"
        ]
    }
}

SPECIAL_FIELD_MAPS = {
    "ke_hoach_lcnt": {
        "thoi_gian_dang_tai": "thoiGianDangMa",
        "cv_da_thuc_hien": "cvDaThucHienList",
        "cv_khong_ap_dung": "cvKhongApDungList",
        "cv_chua_du_dieu_kien": "cvChuaDuDieuKienList"
    },
    "chu_dau_tu": {
        "ma_qhns": "maQHNS"
    },
    "goi_thau": {
        "nha_thau_trung_thau_id": "nhaThauTrungThauId",
        "thoi_gian_dang_tai": "thoiGianDangTai",
        "thoi_gian_dong_thau": "thoiGianDongThau",
        "thoi_gian_mo_thau": "thoiGianMoThau",
        "gia_han_list": "giaHanList",
        "yeu_cau_lam_ro_list": "yeuCauLamRoList",
        "tra_loi_lam_ro_list": "traLoiLamRoList",
        "so_quyet_dinh": "soQuyetDinh",
        "ngay_quyet_dinh": "ngayQuyetDinh",
        "so_quyet_dinh_ket_qua": "soQuyetDinhKetQua",
        "ngay_quyet_dinh_ket_qua": "ngayQuyetDinhKetQua",
        "gia_tri_dam_bao_du_thau": "giaTriDamBaoDuThau",
        "hieu_luc_hsdt": "hieuLucHsdt",
        "hieu_luc_dam_bao_du_thau": "hieuLucDamBaoDuThau",
        "danh_gia_hsdt_metadata": "danhGiaHsdtMetadata",
        "awarded_phan_lo_list": "awardedPhanLoList"
    },
    "thong_tin_mo_thau": {
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
        "thanh_vien_lien_danh": "thanhVienLienDanh",
        "danh_gia_hop_le": "danhGiaHopLe",
        "danh_gia_nang_luc": "danhGiaNangLuc",
        "danh_gia_ky_thuat": "danhGiaKyThuat",
        "danh_gia_tai_chinh": "danhGiaTaiChinh",
        "danh_gia_ket_luan": "danhGiaKetLuan",
        "ly_do_truot": "lyDoTruot",
        "lam_ro_hop_le": "lamRoHopLe",
        "lam_ro_nang_luc": "lamRoNangLuc",
        "lam_ro_ky_thuat": "lamRoKyThuat",
        "lam_ro_tai_chinh": "lamRoTaiChinh"
    },
    "chuyen_gia": {
        "so_cccd": "soCCCD",
        "ngay_cap_cccd": "ngayCapCCCD",
        "noi_cap_cccd": "noiCapCCCD"
    },
    "hop_dong": {
        "thoi_gian_thuc_hien": "soNgayThucHien"
    },
    "phan_cong_nhan_su": {
        "id_nhan_vien": "empId",
        "id_muc_tieu": "targetId",
        "loai_doi_tuong": "type"
    },
    "ma_tran_phan_quyen": {
        "emp_id": "empId"
        # Các trường còn lại (kehoach, goithau...) to_camel_case() đã map đúng
    }
}

def to_snake_case(name):
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

def to_camel_case(snake_str):
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])

def clean_id(val):
    if val is None or val == "":
        return None
    return str(val).strip()

def khoi_tao_va_di_tru_he_thong():
    try:
        conn = database.get_connection()
        cursor = conn.cursor()
        
        # Tránh kiểm tra DB liên tục mỗi khi import module
        cursor.execute("CREATE TABLE IF NOT EXISTS sys_config (key TEXT PRIMARY KEY, val TEXT)")

        # Tự động loại bỏ mọi bảng không được định nghĩa trong SCHEMA_DINH_NGHIA và không phải bảng hệ thống
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        db_tables = [row[0] for row in cursor.fetchall()]
        for tbl in db_tables:
            if tbl not in SCHEMA_DINH_NGHIA and tbl not in ['sys_config', 'sqlite_sequence']:
                print(f"Đồng bộ: Loại bỏ bảng vô nghĩa/không sử dụng khỏi DB: '{tbl}'")
                cursor.execute(f"DROP TABLE IF EXISTS '{tbl}'")
        conn.commit()

        cursor.execute("SELECT val FROM sys_config WHERE key = 'migration_done_v3'")
        config_row = cursor.fetchone()
        if config_row and config_row[0] == '1':
            conn.close()
            return
            
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tai_khoan'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(tai_khoan)")
            cols = [row[1] for row in cursor.fetchall()]
            if 'ten_to_chuc' in cols:
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS to_chuc (
                        id TEXT PRIMARY KEY,
                        ten_to_chuc TEXT UNIQUE NOT NULL,
                        quan_ly_id TEXT,
                        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
                    )
                """)
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS thanh_vien_to_chuc (
                        user_id TEXT NOT NULL,
                        to_chuc_id TEXT NOT NULL,
                        vai_tro_trong_to_chuc TEXT,
                        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                        PRIMARY KEY (user_id, to_chuc_id)
                    )
                """)
                
                cursor.execute("SELECT id, ten_to_chuc, vai_tro FROM tai_khoan WHERE ten_to_chuc IS NOT NULL AND ten_to_chuc != ''")
                tk_rows = cursor.fetchall()
                org_managers = {}
                for row in tk_rows:
                    u_id = row['id']
                    vai_tro = row['vai_tro'] or ''
                    orgs = [o.strip() for o in row['ten_to_chuc'].split(',') if o.strip()]
                    for org in orgs:
                        if org not in org_managers:
                            org_managers[org] = u_id
                        else:
                            cursor.execute("SELECT vai_tro FROM tai_khoan WHERE id = ?", (org_managers[org],))
                            mgr_row = cursor.fetchone()
                            current_mgr_role = mgr_row['vai_tro'] or '' if mgr_row else ''
                            def role_weight(role):
                                if 'super_admin' in role: return 3
                                if 'manager' in role: return 2
                                return 1
                            if role_weight(vai_tro) > role_weight(current_mgr_role):
                                org_managers[org] = u_id
                
                for org_name, mgr_id in org_managers.items():
                    org_hash_id = "org-" + hashlib.md5(org_name.encode('utf-8')).hexdigest()[:16]
                    cursor.execute("""
                        INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id)
                        VALUES (?, ?, ?)
                    """, (org_hash_id, org_name, mgr_id))
                
                for row in tk_rows:
                    u_id = row['id']
                    vai_tro = row['vai_tro'] or ''
                    orgs = [o.strip() for o in row['ten_to_chuc'].split(',') if o.strip()]
                    for org in orgs:
                        cursor.execute("SELECT id FROM to_chuc WHERE ten_to_chuc = ?", (org,))
                        org_row = cursor.fetchone()
                        if org_row:
                            org_id = org_row['id']
                            role_in_org = 'employee'
                            if 'super_admin' in vai_tro:
                                role_in_org = 'super_admin'
                            elif 'manager' in vai_tro:
                                role_in_org = 'manager'
                            cursor.execute("""
                                INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc)
                                VALUES (?, ?, ?)
                            """, (u_id, org_id, role_in_org))
                print("Đồng bộ: Di trú trước dữ liệu tổ chức từ tai_khoan.ten_to_chuc thành công!")
        
        for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
            cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
            table_exists = cursor.fetchone()
            
            if not table_exists:
                cols_def = []
                primary_keys = table_spec.get("primary_keys", [])
                for col_name, col_def in table_spec["columns"].items():
                    if primary_keys and col_name in primary_keys:
                        clean_def = col_def.replace("PRIMARY KEY", "")
                        cols_def.append(f"{col_name} {clean_def}")
                    else:
                        cols_def.append(f"{col_name} {col_def}")
                if primary_keys:
                    cols_def.append(f"PRIMARY KEY ({', '.join(primary_keys)})")
                for constraint in table_spec.get("unique_constraints", []):
                    cols_def.append(constraint)
                for fk in table_spec.get("foreign_keys", []):
                    cols_def.append(fk)
                sql_create = f"CREATE TABLE {table_name} ({', '.join(cols_def)})"
                print(f"Đồng bộ: Tạo bảng mới '{table_name}' theo cấu trúc code định nghĩa.")
                cursor.execute(sql_create)
                continue
            
            cursor.execute(f"PRAGMA table_info({table_name})")
            current_cols = {row[1]: row for row in cursor.fetchall()}
            expected_cols = table_spec["columns"]
            
            if table_name == "hop_dong" and "thoi_gian_thuc_hien" not in current_cols and "so_ngay_thuc_hien" in current_cols:
                print("Đồng bộ: Đổi tên cột 'so_ngay_thuc_hien' thành 'thoi_gian_thuc_hien' trong bảng 'hop_dong'")
                try:
                    cursor.execute("ALTER TABLE hop_dong RENAME COLUMN so_ngay_thuc_hien TO thoi_gian_thuc_hien")
                    cursor.execute("PRAGMA table_info(hop_dong)")
                    current_cols = {row[1]: row for row in cursor.fetchall()}
                except Exception as ex:
                    print(f"Lỗi khi đổi tên cột: {ex}")

            rebuild_needed = False
            for col_name, col_def in expected_cols.items():
                if col_name in current_cols:
                    expected_type = col_def.split()[0].upper().replace(",", "")
                    current_type = current_cols[col_name][2].upper()
                    
                    def normalize_type(t):
                        t = t.strip()
                        if not t:
                            return "TEXT"
                        if "INT" in t:
                            return "INTEGER"
                        if "CHAR" in t or "CLOB" in t or "TEXT" in t:
                            return "TEXT"
                        if "BLOB" in t:
                            return "BLOB"
                        if "REAL" in t or "FLOA" in t or "DOUB" in t:
                            return "REAL"
                        return t

                    if normalize_type(expected_type) != normalize_type(current_type):
                        print(f"Đồng bộ: Phát hiện lệch kiểu dữ liệu cột '{col_name}' trong '{table_name}' (Code: {expected_type}, DB: {current_type})")
                        rebuild_needed = True
                        break
                else:
                    col_def_upper = col_def.upper()
                    if "DEFAULT" in col_def_upper or "NOT NULL" in col_def_upper or "UNIQUE" in col_def_upper or "REFERENCES" in col_def_upper:
                        print(f"Đồng bộ: Phát hiện thiếu cột phức tạp '{col_name}' trong '{table_name}', cần xây dựng lại bảng.")
                        rebuild_needed = True
                        break
            
            if rebuild_needed:
                print(f"Đồng bộ: Tiến hành xây dựng lại bảng '{table_name}' để đồng bộ cấu trúc...")
                try:
                    cursor.execute("PRAGMA foreign_keys = OFF")
                    temp_table = f"{table_name}_old_{int(datetime.now().timestamp())}"
                    cursor.execute(f"ALTER TABLE {table_name} RENAME TO {temp_table}")
                    
                    cols_def = []
                    primary_keys = table_spec.get("primary_keys", [])
                    for col_name, col_def in table_spec["columns"].items():
                        if primary_keys and col_name in primary_keys:
                            clean_def = col_def.replace("PRIMARY KEY", "")
                            cols_def.append(f"{col_name} {clean_def}")
                        else:
                            cols_def.append(f"{col_name} {col_def}")
                    if primary_keys:
                        cols_def.append(f"PRIMARY KEY ({', '.join(primary_keys)})")
                    for constraint in table_spec.get("unique_constraints", []):
                        cols_def.append(constraint)
                    for fk in table_spec.get("foreign_keys", []):
                        cols_def.append(fk)
                    
                    sql_create = f"CREATE TABLE {table_name} ({', '.join(cols_def)})"
                    cursor.execute(sql_create)
                    
                    cursor.execute(f"PRAGMA table_info({temp_table})")
                    old_cols = [row[1] for row in cursor.fetchall()]
                    common_cols = [c for c in expected_cols.keys() if c in old_cols]
                    
                    if common_cols:
                        cols_str = ", ".join(common_cols)
                        cursor.execute(f"INSERT INTO {table_name} ({cols_str}) SELECT {cols_str} FROM {temp_table}")
                    
                    cursor.execute(f"DROP TABLE {temp_table}")
                    cursor.execute("PRAGMA foreign_keys = ON")
                    print(f"Đồng bộ: Xây dựng lại bảng '{table_name}' thành công và bảo toàn dữ liệu!")
                    continue
                except Exception as ex:
                    cursor.execute("PRAGMA foreign_keys = ON")
                    print(f"Lỗi nghiêm trọng khi xây dựng lại bảng '{table_name}': {ex}")

            for col_name, col_def in expected_cols.items():
                if col_name not in current_cols:
                    print(f"Đồng bộ: Thêm cột mới '{col_name}' ({col_def}) vào bảng '{table_name}'")
                    alter_def = col_def
                    if "PRIMARY KEY" in col_def.upper():
                        continue
                    if "NOT NULL" in col_def.upper() and "DEFAULT" not in col_def.upper():
                        alter_def = col_def.replace("NOT NULL", "")
                    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {alter_def}")
            
            for col_name in list(current_cols.keys()):
                if col_name not in expected_cols:
                    print(f"Đồng bộ: Xóa cột thừa '{col_name}' khỏi bảng '{table_name}' để khớp định nghĩa code")
                    try:
                        cursor.execute(f"ALTER TABLE {table_name} DROP COLUMN {col_name}")
                    except Exception as ex:
                        print(f"Không thể xóa trực tiếp cột '{col_name}' trong SQLite (phiên bản cũ): {ex}")
                        
        # English system legacy migration
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='system_packages'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM system_packages")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d['price'], d['quota'], d['description']))
            print("Đã di trú system_packages -> goi_dich_vu")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM users")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, token_phien, anh_dai_dien, goi_dich_vu_id, ngay_bat_dau_goi, ngay_het_han_goi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['username'], d['password'], d['name'], d['role'], d['email'], d['active_session_token'], d.get('avatar'), d.get('package_id', 'silver'), d.get('package_start_date'), d.get('package_end_date')))
                
                org_name = d.get('organization_name')
                if org_name:
                    orgs = [o.strip() for o in org_name.split(',') if o.strip()]
                    for org in orgs:
                        org_hash_id = "org-" + hashlib.md5(org.encode('utf-8')).hexdigest()[:16]
                        cursor.execute("INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                                       (org_hash_id, org, d['id']))
                        role_in_org = 'employee'
                        if 'super_admin' in d['role']:
                            role_in_org = 'super_admin'
                        elif 'manager' in d['role']:
                            role_in_org = 'manager'
                        cursor.execute("INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                                       (d['id'], org_hash_id, role_in_org))
            print("Đã di trú users -> tai_khoan")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='investors'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM investors")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO chu_dau_tu (id, ten_chu_dau_tu, ma_chu_dau_tu, ma_so_thue, chuc_vu_nguoi_dung_dau, nguoi_ky_quyet_dinh, chuc_vu_nguoi_ky, danh_xung, dia_chi, so_dien_thoai, so_tai_khoan, noi_mo_tai_khoan, email, ma_qhns) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d.get('code', ''), d.get('tax_code', ''), d.get('head_position', ''), d.get('signer_name', ''), d.get('signer_position', ''), d.get('honorific', 'Ông'), d.get('address', ''), d.get('phone', ''), d.get('bank_account', ''), d.get('bank_name', ''), d.get('email', ''), d.get('budget_code', '')))
            print("Đã di trú investors -> chu_dau_tu")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='plans'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM plans")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO ke_hoach_lcnt (id, id_goc, ma_ke_hoach, phien_ban, ten_ke_hoach, ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id, tong_muc_dau_tu, ngay_phe_duyet, quyet_dinh_phe_duyet, thoi_gian_dang_tai, cv_da_thuc_hien, cv_khong_ap_dung, cv_chua_du_dieu_kien, nguon_von, thoi_gian_du_an, dia_diem_quy_mo, thong_tin_khac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('root_id'), d.get('code'), d.get('version', '00'), d['name'], d.get('project_name'), d.get('loai_hinh'), d.get('investor_id'), d.get('total_investment', 0), d.get('approval_date'), d.get('approval_decision'), d.get('publish_date'), d.get('cv_da_thuc_hien', '[]'), d.get('cv_khong_ap_dung', '[]'), d.get('cv_chua_du_dieu_kien', '[]'), d.get('nguon_von', ''), d.get('thoigian_duan', ''), d.get('diadiem_quymo', ''), d.get('thongtin_khac', '')))
            print("Đã di trú plans -> ke_hoach_lcnt")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contractors'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contractors")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO nha_thau (id, ten_nha_thau, loai_nha_thau, thanh_vien_lien_danh, ma_so_thue, nguoi_dai_dien, danh_xung, so_dien_thoai, email, dia_chi, so_tai_khoan, noi_mo_tai_khoan, ma_ngan_hang, ma_nha_thau) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['name'], d.get('type', 'Độc lập'), d.get('members', '[]'), d.get('tax_code', ''), d.get('representative', ''), d.get('honorific', 'Ông'), d.get('phone', ''), d.get('email', ''), d.get('address', ''), d.get('bank_account', ''), d.get('bank_name', ''), d.get('bank_code', ''), d.get('code', '')))
            print("Đã di trú contractors -> nha_thau")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='experts'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM experts")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO chuyen_gia (id, ho_ten, so_chung_chi, ngay_cap_chung_chi, so_cccd, ngay_cap_cccd, anh_chung_chi) VALUES (?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d['full_name'], d.get('certificate_code'), d.get('certificate_date'), d.get('cccd'), d.get('cccd_date'), d.get('certificate_image')))
            print("Đã di trú experts -> chuyen_gia")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='packages'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM packages")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO goi_thau (id, id_goc, ma_goi_thau, phien_ban, ke_hoach_id, ten_goi_thau, gia_goi_thau, loai_hop_dong, hinh_thuc_lua_chon, phuong_thuc_lua_chon, thoi_gian_thuc_hien, nguon_von, nha_thau_trung_thau_id, linh_vuc, tuy_chon_mua_them, thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, phan_lo, phan_lo_list, tuy_chon_mua_them_list, thoi_gian_goi_thau, thoi_gian_hop_dong, awarded_phan_lo_list, trang_thai) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('root_id'), d.get('code'), d.get('version', '00'), d.get('plan_id'), d['name'], d.get('price', 0), d.get('contract_type'), d.get('selection_method'), d.get('phuong_thuc_lua_chon', 'Một giai đoạn một túi hồ sơ'), d.get('execution_time'), d.get('capital_source'), d.get('awarded_contractor_id'), d.get('linh_vuc'), d.get('purchase_option', 'Không'), d.get('org_time'), d.get('org_start_time'), d.get('phan_lo', 'Không'), d.get('phan_lo_list', '[]'), d.get('tuy_chon_mua_them_list', '[]'), d.get('thoi_gian_goi_thau'), d.get('thoi_gian_hop_dong'), d.get('awarded_phan_lo_list', '[]'), d.get('status', 'Chuẩn bị')))
            print("Đã di trú packages -> goi_thau")
   
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contracts'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contracts")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO hop_dong (id, ten_hop_dong, so_hop_dong, ngay_ky, chu_dau_tu_id, nha_thau_id, gia_tri, loai_hop_dong, thoi_gian_thuc_hien, trang_thai_ho_so) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                               (d['id'], d.get('name'), d.get('code'), d.get('sign_date'), d.get('investor_id'), d.get('contractor_id'), d.get('value', 0), d.get('type'), str(d.get('execution_time', '')), d.get('paper_status')))
            print("Đã di trú contracts -> hop_dong")
  
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='contract_package'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM contract_package")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO hop_dong_goi_thau (hop_dong_id, goi_thau_id) VALUES (?, ?)",
                               (d['contract_id'], d['package_id']))
            print("Đã di trú contract_package -> hop_dong_goi_thau")
  
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='assignments'")
        if cursor.fetchone()[0] > 0:
            cursor.execute("SELECT * FROM assignments")
            for r in cursor.fetchall():
                d = dict(r)
                cursor.execute("INSERT OR IGNORE INTO phan_cong_nhan_su (id, id_nhan_vien, id_muc_tieu, loai_doi_tuong) VALUES (?, ?, ?, ?)",
                               (d['id'], d['emp_id'], d['target_id'], d['type']))
            print("Đã di trú assignments -> phan_cong_nhan_su")
            
        # Bảng cũ đã được loại bỏ động ở đầu hàm.
        pass
            
        cursor.execute("SELECT COUNT(*) FROM goi_dich_vu")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('silver', 'Gói Bạc (Silver)', 15000000.0, 5, 'Phù hợp với đơn vị quy mô nhỏ, quản lý tối đa 5 nhân sự.'))
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('gold', 'Gói Vàng (Gold)', 35000000.0, 15, 'Giải pháp tuyệt vời cho phòng thầu chuyên nghiệp, tối đa 15 nhân sự.'))
            cursor.execute("INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
                           ('diamond', 'Gói Kim Cương (Diamond)', 75000000.0, 999, 'Đặc quyền quản trị thầu tối cao, không giới hạn số lượng nhân sự.'))
                           
        cursor.execute("SELECT COUNT(*) FROM tai_khoan")
        if cursor.fetchone()[0] == 0:
            admin_uuid = "user-" + str(uuid.uuid4())
            admin_pass = os.environ.get("ADMIN_PASSWORD")
            if not admin_pass:
                admin_pass = secrets.token_urlsafe(12)
                print("*" * 60)
                print(f"Mật khẩu admin khởi tạo ngẫu nhiên: {admin_pass}")
                print("*" * 60)
            admin_name = os.environ.get("ADMIN_NAME", "Administrator")
            admin_email = os.environ.get("ADMIN_EMAIL", "admin@localhost")
            cursor.execute("INSERT INTO tai_khoan (id, ten_dang_nhap, mat_khau, ho_ten, vai_tro, email, goi_dich_vu_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (admin_uuid, 'admin', hash_password(admin_pass), admin_name, 'super_admin', admin_email, 'diamond'))
            
            org_name = 'HTD'
            org_hash_id = "org-" + hashlib.md5(org_name.encode('utf-8')).hexdigest()[:16]
            cursor.execute("""
                INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id)
                VALUES (?, ?, ?)
            """, (org_hash_id, org_name, admin_uuid))
            cursor.execute("""
                INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc)
                VALUES (?, ?, ?)
            """, (admin_uuid, org_hash_id, 'super_admin'))
                           
        cursor.execute("UPDATE tai_khoan SET da_xac_minh = 1 WHERE da_xac_minh IS NULL OR da_xac_minh = 0")

        cursor.execute("SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin' OR ten_dang_nhap = 'admin' LIMIT 1")
        admin_row = cursor.fetchone()
        admin_id = str(admin_row[0]) if admin_row else "1"
        
        business_tables = [
            "chu_dau_tu", "ke_hoach_lcnt", "goi_thau", "chuyen_gia", 
            "nha_thau", "hop_dong", "phan_cong_nhan_su", 
            "trang_thai_ho_so_giay", "thong_tin_mo_thau"
        ]
        for tbl in business_tables:
            cursor.execute(f"UPDATE {tbl} SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''", (admin_id,))
        # Các chỉ mục (indexes) đã được chuyển toàn bộ sang db_helper.py để tập trung quản lý.

        for tbl in ["chu_dau_tu", "ke_hoach_lcnt", "nha_thau", "goi_thau"]:
            cursor.execute(f"UPDATE {tbl} SET is_latest = 0")
            cursor.execute(f"""
                UPDATE {tbl} SET is_latest = 1 WHERE id IN (
                    SELECT t1.id FROM {tbl} t1
                    INNER JOIN (
                        SELECT COALESCE(id_goc, id) as id_goc_group, MAX(CAST(phien_ban AS INTEGER)) as max_ver
                        FROM {tbl}
                        GROUP BY COALESCE(id_goc, id)
                    ) t2 ON COALESCE(t1.id_goc, t1.id) = t2.id_goc_group AND CAST(t1.phien_ban AS INTEGER) = t2.max_ver
                )
            """)

        try:
            cursor.execute("DELETE FROM thanh_vien_to_chuc WHERE user_id NOT IN (SELECT id FROM tai_khoan)")
            cursor.execute("UPDATE to_chuc SET quan_ly_id = NULL WHERE quan_ly_id NOT IN (SELECT id FROM tai_khoan)")
            print("Đồng bộ: Dọn dẹp các liên kết mồ côi tổ chức thành công!")
        except Exception as migration_ex:
            print("Lỗi khi di trú dữ liệu tổ chức:", migration_ex)

        try:
            cursor.execute("DROP TRIGGER IF EXISTS tg_sync_goithau_chuyengia_insert")
            cursor.execute("DROP TRIGGER IF EXISTS tg_sync_goithau_chuyengia_update")
            print("Đồng bộ: Đã dọn dẹp trigger goi_thau_chuyen_gia.")

            # Xóa các cột JSON dư thừa nếu SQLite hỗ trợ (>= 3.35.0)
            sqlite_ver = tuple(int(x) for x in conn.execute("SELECT sqlite_version()").fetchone()[0].split("."))
            if sqlite_ver >= (3, 35, 0):
                existing_cols = [row[1] for row in cursor.execute("PRAGMA table_info(goi_thau)").fetchall()]
                if 'chuyen_gia_list' in existing_cols:
                    cursor.execute("ALTER TABLE goi_thau DROP COLUMN chuyen_gia_list")
                    print("Đồng bộ: Đã xóa cột chuyen_gia_list khỏi bảng goi_thau.")
                if 'tham_dinh_list' in existing_cols:
                    cursor.execute("ALTER TABLE goi_thau DROP COLUMN tham_dinh_list")
                    print("Đồng bộ: Đã xóa cột tham_dinh_list khỏi bảng goi_thau.")
            else:
                print(f"Đồng bộ: SQLite {'.'.join(str(x) for x in sqlite_ver)} chưa hỗ trợ DROP COLUMN — bỏ qua, cột thừa không ảnh hưởng chức năng.")
        except Exception as trigger_ex:
            print("Lỗi khi dọn dẹp trigger/cột JSON:", trigger_ex)
                           
        try:
            cursor.execute("SELECT id, ten_to_chuc FROM to_chuc")
            org_rows = cursor.fetchall()
            for org_row in org_rows:
                o_id = org_row['id']
                o_name = org_row['ten_to_chuc']
                for tbl in business_tables:
                    cursor.execute(f"UPDATE {tbl} SET owner_id = ? WHERE owner_id = ?", (o_id, o_name))
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_records'")
            if cursor.fetchone():
                for org_row in org_rows:
                    cursor.execute("UPDATE deleted_records SET owner_id = ? WHERE owner_id = ?", (org_row['id'], org_row['ten_to_chuc']))
            print("Đồng bộ: Di trú cột owner_id từ Tên tổ chức sang ID tổ chức thành công!")
        except Exception as migration_owner_ex:
            print("Lỗi khi di trú owner_id sang ID tổ chức:", migration_owner_ex)

        cursor.execute("INSERT OR REPLACE INTO sys_config (key, val) VALUES ('migration_done_v3', '1')")
        conn.commit()
        conn.close()
        print("Khởi tạo và di trú cơ sở dữ liệu Tiếng Việt thành công!")
    except Exception as e:
        print("Lỗi khởi tạo/di trú database Tiếng Việt:", e)

# Trigger migration once at helper module import
khoi_tao_va_di_tru_he_thong()

def log_error(e_or_msg, context="System", level="ERROR"):
    log_file = os.path.join(project_root, "sync_error.log")
    try:
        # Xoay vòng file log nếu > 5MB
        if os.path.exists(log_file) and os.path.getsize(log_file) > 5 * 1024 * 1024:
            try:
                backup_file = log_file + ".1"
                if os.path.exists(backup_file):
                    os.remove(backup_file)
                os.rename(log_file, backup_file)
            except Exception:
                try:
                    with open(log_file, "w", encoding="utf-8") as f:
                        f.write(f"[{datetime.now().isoformat()}] Log file truncated due to size limit.\n")
                except Exception:
                    pass

        now_str = datetime.now().isoformat()
        if isinstance(e_or_msg, Exception):
            tb = traceback.format_exc()
            msg = f"[{now_str}] [{context}] [{level}] LỖI: {str(e_or_msg)}\n{tb}\n"
        else:
            msg = f"[{now_str}] [{context}] [{level}] THÔNG BÁO: {str(e_or_msg)}\n"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass
    if os.environ.get("APP_DEBUG", "False").lower() == "true":
        print(f"[{context}] [{level}] {e_or_msg}")

def log_info(msg, context="System"):
    log_error(msg, context, level="INFO")

class ErrorLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            response = await call_next(request)
            if response.status_code >= 500:
                log_error(f"Phản hồi lỗi server {response.status_code}", f"HTTP {request.method} {request.url.path}")
            return response
        except Exception as e:
            log_error(e, f"HTTP {request.method} {request.url.path}")
            raise e

def format_date_str(date_str):
    if not date_str:
        return '--'
    date_str = str(date_str).strip().split(' ')[0]
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str, fmt).strftime('%d/%m/%Y')
        except ValueError:
            pass
    return date_str

class VietnameseFloat(float):
    def __str__(self):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__str__()

    def __repr__(self):
        return self.__str__()

    def __format__(self, spec):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__format__(spec)

def clean_admin_prefix(name):
    if not name:
        return ""
    pattern = r"^(thành phố|tỉnh|phường|xã|thị trấn)\s+"
    return re.sub(pattern, '', name, flags=re.IGNORECASE)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_SENDER = os.environ.get("SMTP_SENDER", SMTP_USER)

def gui_email(email_nhan, tieu_de, noi_dung_html):
    if not SMTP_USER or not SMTP_PASSWORD:
        msg = f"[MOCK MAIL] Gửi tới: {email_nhan}\nTiêu đề: {tieu_de}\nNội dung:\n{noi_dung_html}\n"
        log_error(msg, context="EmailMock")
        return True
    
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_SENDER
        msg['To'] = email_nhan
        msg['Subject'] = tieu_de
        msg.attach(MIMEText(noi_dung_html, 'html', 'utf-8'))
        
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_SENDER, email_nhan, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        log_error(f"Lỗi gửi email tới {email_nhan}: {str(e)}", context="EmailSender")
        return False

import threading
_org_cache = {}
_org_cache_lock = threading.Lock()
ORG_CACHE_TTL = 60

def get_active_org(request, user_id):
    active_org = request.headers.get('X-Active-Org')
    if active_org:
        import urllib.parse
        active_org = urllib.parse.unquote(active_org)
        
    cache_key = (user_id, active_org)
    now = time.time()
    with _org_cache_lock:
        if cache_key in _org_cache:
            val, expire = _org_cache[cache_key]
            if now < expire:
                return val
            else:
                del _org_cache[cache_key]
                
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        result = str(user_id)
    else:
        result = rows[0]['id']
        for row in rows:
            if active_org and (active_org == row['id'] or active_org == row['ten_to_chuc']):
                result = row['id']
                break
                
    with _org_cache_lock:
        _org_cache[cache_key] = (result, now + ORG_CACHE_TTL)
        
    return result
