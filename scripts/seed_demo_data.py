"""Create a production-shaped demo dataset for BiddingFlow.

The seed is intentionally deterministic and idempotent. It creates two
organizations, users, permissions, plans, packages in every workflow status,
opening/evaluation data, contracts in every status, assignments, notifications
and representative operational records. It never changes an existing admin
password or deletes existing rows.

Usage:
    python scripts/seed_demo_data.py --confirm-demo
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import psycopg
from psycopg import sql


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.shared.audit_chain import _entry_hash


def _load_env() -> None:
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _insert(cursor, table: str, values: dict) -> None:
    columns = list(values)
    statement = sql.SQL(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT DO NOTHING"
    ).format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )
    cursor.execute(statement, tuple(values[column] for column in columns))


def _user(cursor, user_id: str, username: str, name: str, email: str, password_hash: str) -> None:
    _insert(cursor, "tai_khoan", {
        "id": user_id,
        "ten_dang_nhap": username,
        "username_norm": username.lower(),
        "mat_khau": password_hash,
        "ho_ten": name,
        "vai_tro": "user",
        "email": email,
        "email_norm": email.lower(),
        "da_xac_minh": 1,
        "username_da_dat": 1,
    })


def _assignment(cursor, assignment_id: str, organization_id: str, user_id: str, target_id: str, target_type: str, version: int = 1) -> None:
    _insert(cursor, "phan_cong_nhan_su", {
        "id": assignment_id,
        "organization_id": organization_id,
        "owner_type": "organization",
        "id_nhan_vien": user_id,
        "id_muc_tieu": target_id,
        "loai_doi_tuong": target_type,
        "sync_version": version,
    })


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def seed(cursor, *, demo_password: str) -> dict[str, int]:
    from backend.auth.auth_helper import hash_password
    from backend.auth.password_policy import validate_new_password

    valid, error = validate_new_password(demo_password)
    if not valid:
        raise RuntimeError(f"Demo password does not satisfy password policy: {error}")
    password_hash = hash_password(demo_password)
    now = int(time.time())
    day = "2026-07-21"
    org_id = "demo-org-htd"
    suspended_org_id = "demo-org-suspended"
    admin = cursor.execute(
        "SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin' ORDER BY created_at, id LIMIT 1"
    ).fetchone()
    if not admin:
        raise RuntimeError("No super_admin account found. Initialize the database first.")
    admin_id = admin[0]

    for package_id, name, price, quota, description in (
        ("silver", "Gói Bạc (Silver)", 15_000_000, 5, "Gói cơ bản cho đơn vị nhỏ."),
        ("gold", "Gói Vàng (Gold)", 35_000_000, 15, "Gói vận hành chuyên nghiệp."),
        ("diamond", "Gói Kim Cương (Diamond)", 75_000_000, 999, "Gói quản trị không giới hạn nhân sự."),
    ):
        _insert(cursor, "goi_dich_vu", {
            "id": package_id,
            "ten_goi": name,
            "gia_ca": price,
            "han_muc_nhan_su": quota,
            "trang_thai": "active",
            "mo_ta": description,
        })

    for user_id, username, name, email in (
        ("demo-manager", "demo.manager", "Nguyễn Quản Lý", "demo.manager@example.test"),
        ("demo-alice", "demo.alice", "Trần Minh Anh", "demo.alice@example.test"),
        ("demo-bao", "demo.bao", "Lê Quốc Bảo", "demo.bao@example.test"),
        ("demo-chi", "demo.chi", "Phạm Ngọc Chi", "demo.chi@example.test"),
        ("demo-former", "demo.former", "Đỗ Nhân Sự Cũ", "demo.former@example.test"),
    ):
        _user(cursor, user_id, username, name, email, password_hash)

    _insert(cursor, "to_chuc", {"id": org_id, "ten_to_chuc": "Công ty Demo HTD", "trang_thai": "active"})
    _insert(cursor, "to_chuc", {"id": suspended_org_id, "ten_to_chuc": "Đơn vị Demo Tạm Ngưng", "trang_thai": "suspended"})

    for user_id, role, name, status in (
        (admin_id, "manager", "Administrator", "active"),
        ("demo-manager", "manager", "Nguyễn Quản Lý", "active"),
        ("demo-alice", "employee", "Trần Minh Anh", "active"),
        ("demo-bao", "employee", "Lê Quốc Bảo", "active"),
        ("demo-chi", "employee", "Phạm Ngọc Chi", "active"),
        ("demo-former", "employee", "Đỗ Nhân Sự Cũ", "left"),
    ):
        _insert(cursor, "thanh_vien_to_chuc", {
            "user_id": user_id,
            "organization_id": org_id,
            "vai_tro_trong_to_chuc": role,
            "ten_nhan_su": name,
            "so_dien_thoai": "0900000000",
            "trang_thai_thanh_vien": status,
            "left_at": f"{day} 09:00:00" if status == "left" else None,
            "left_by": admin_id if status == "left" else None,
        })
    _insert(cursor, "thanh_vien_to_chuc", {
        "user_id": "demo-manager",
        "organization_id": suspended_org_id,
        "vai_tro_trong_to_chuc": "manager",
        "ten_nhan_su": "Nguyễn Quản Lý",
        "trang_thai_thanh_vien": "active",
    })

    _insert(cursor, "organization_subscriptions", {
        "organization_id": org_id,
        "package_id": "diamond",
        "status": "active",
        "starts_at": now - 30 * 86400,
        "expires_at": now + 365 * 86400,
        "member_quota": 999,
    })
    _insert(cursor, "organization_subscriptions", {
        "organization_id": suspended_org_id,
        "package_id": "silver",
        "status": "suspended",
        "starts_at": now - 365 * 86400,
        "expires_at": now - 2 * 86400,
        "member_quota": 5,
    })
    for user_id, package_id, status in (
        ("demo-manager", "gold", "active"),
        ("demo-alice", "gold", "active"),
        ("demo-bao", "silver", "expired"),
        ("demo-chi", "gold", "cancelled"),
    ):
        _insert(cursor, "account_subscriptions", {
            "user_id": user_id,
            "package_id": package_id,
            "status": status,
            "starts_at": now - 90 * 86400,
            "expires_at": now + 180 * 86400 if status == "active" else now - 2 * 86400,
        })

    investors = [
        ("demo-cdt-01", "Công ty TNHH HTD", "CDT-HTD", None),
        ("demo-cdt-02", "Ban Quản lý Dự án Demo", "CDT-BQL", None),
        ("demo-cdt-02-v1", "Ban Quản lý Dự án Demo (bản cũ)", "CDT-BQL-OLD", f"{day} 08:00:00"),
    ]
    for investor_id, name, code, archived_at in investors:
        _insert(cursor, "chu_dau_tu", {
            "id": investor_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": "demo-cdt-02" if investor_id.endswith("-v1") else investor_id,
            "phien_ban": 0 if not investor_id.endswith("-v1") else 1,
            "is_latest": 0 if archived_at else 1,
            "archived_at": archived_at,
            "ngay_ap_dung": "2026-01-01",
            "ma_chu_dau_tu": code,
            "ten_chu_dau_tu": name,
            "ten_viet_tat": code,
            "ma_so_thue": "0101234567",
            "dai_dien_cdt": "Nguyễn Đại Diện",
            "chuc_vu_dai_dien": "Giám đốc",
            "dia_chi": "Hà Nội",
            "so_dien_thoai": "0240000000",
            "email": "contact@example.test",
            "sync_version": 2,
        })

    plans = [
        ("demo-plan-01", "KH-2026-001", "Mua sắm thiết bị CNTT", "Đã phê duyệt"),
        ("demo-plan-02", "KH-2026-002", "Xây dựng và sửa chữa", "Đã phê duyệt"),
        ("demo-plan-03", "KH-2026-003", "Kế hoạch đang chuẩn bị", "Dự thảo"),
    ]
    for plan_id, code, name, project in plans:
        _insert(cursor, "ke_hoach_lcnt", {
            "id": plan_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": plan_id,
            "ma_ke_hoach": code,
            "ma_du_an": f"DA-{code[-3:]}",
            "phien_ban": 0,
            "is_latest": 1,
            "ten_ke_hoach": name,
            "ten_du_an_du_toan": project,
            "loai_hinh_mua_sam": "Đấu thầu rộng rãi",
            "chu_dau_tu_id": "demo-cdt-01",
            "don_vi_trinh_cdt": "Phòng Kế hoạch",
            "ten_viet_tat_don_vi_trinh": "PKH",
            "tong_muc_dau_tu": 12_500_000_000,
            "ngay_phe_duyet": "2026-01-15",
            "quyet_dinh_phe_duyet": f"QĐ-{code}",
            "thoi_gian_dang_tai": "2026-01-20",
            "nguon_von": "Ngân sách nhà nước",
            "thoi_gian_du_an": "2026-2027",
            "dia_diem_quy_mo": "Hà Nội và các tỉnh phía Bắc",
            "thong_tin_khac": "Dữ liệu demo để kiểm thử đầy đủ màn hình.",
            "sync_version": 5,
        })
    _insert(cursor, "ke_hoach_lcnt", {
        "id": "demo-plan-02-v1",
        "organization_id": org_id,
        "owner_type": "organization",
        "id_goc": "demo-plan-02",
        "ma_ke_hoach": "KH-2026-002-V1",
        "ma_du_an": "DA-002",
        "phien_ban": 1,
        "is_latest": 0,
        "archived_at": f"{day} 08:00:00",
        "ten_ke_hoach": "Xây dựng và sửa chữa (bản cũ)",
        "ten_du_an_du_toan": "Bản cũ",
        "loai_hinh_mua_sam": "Chỉ định thầu",
        "chu_dau_tu_id": "demo-cdt-01",
        "ngay_phe_duyet": "2025-12-15",
        "quyet_dinh_phe_duyet": "QĐ-KH-2025-002",
    })
    for index, plan_id in enumerate(("demo-plan-01", "demo-plan-02", "demo-plan-03"), 1):
        for kind, title in (
            ("da_thuc_hien", "Chuẩn bị hồ sơ mời thầu"),
            ("khong_ap_dung", "Thẩm định nguồn vốn"),
            ("chua_du_dieu_kien", "Theo dõi tiến độ phê duyệt"),
        ):
            _insert(cursor, "ke_hoach_cong_viec", {
                "id": f"demo-plan-work-{index}-{kind}",
                "organization_id": org_id,
                "owner_type": "organization",
                "ke_hoach_id": plan_id,
                "loai": kind,
                "ten_cong_viec": title,
                "gia_tri": 250_000_000,
                "don_vi_thuc_hien": "Phòng Kế hoạch",
                "van_ban_phe_duyet": "VB-DEMO-001",
                "sort_order": index,
                "sync_version": 5,
            })

    contractors = [
        ("demo-nt-01", "Công ty Công nghệ Sao Bắc", "NT-SB", "0101111111"),
        ("demo-nt-02", "Công ty Xây dựng Thành Công", "NT-TC", "0102222222"),
        ("demo-nt-03", "Công ty Thành viên Liên danh", "NT-LD", "0103333333"),
        ("demo-nt-04", "Công ty Bị loại", "NT-LOAI", "0104444444"),
    ]
    for contractor_id, name, code, tax in contractors:
        _insert(cursor, "nha_thau", {
            "id": contractor_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": contractor_id,
            "phien_ban": 0,
            "is_latest": 1,
            "ngay_ap_dung": "2026-01-01",
            "ma_nha_thau": code,
            "ten_nha_thau": name,
            "ten_viet_tat": code,
            "loai_nha_thau": "Trong nước",
            "ma_so_thue": tax,
            "nguoi_dai_dien": "Nguyễn Đại Diện",
            "chuc_vu_dai_dien": "Giám đốc",
            "so_dien_thoai": "0901000000",
            "email": f"{code.lower()}@example.test",
            "dia_chi": "Hà Nội",
            "so_tai_khoan": "123456789",
            "noi_mo_tai_khoan": "Ngân hàng Demo",
            "ma_ngan_hang": "DMBANK",
            "sync_version": 3,
        })
    _insert(cursor, "nha_thau_lien_danh_thanh_vien", {
        "id": "demo-consortium-member",
        "organization_id": org_id,
        "owner_type": "organization",
        "nha_thau_id": "demo-nt-02",
        "thanh_vien_nha_thau_id": "demo-nt-03",
        "ten_nha_thau": "Công ty Thành viên Liên danh",
        "ma_nha_thau": "NT-LD",
        "ma_so_thue": "0103333333",
        "vai_tro": "Thành viên liên danh",
    })

    package_rows = [
        ("demo-gt-preparing", "GT-2026-001", "PREPARING", None, None, None),
        ("demo-gt-invited", "GT-2026-002", "INVITED", None, None, None),
        ("demo-gt-opened", "GT-2026-003", "OPENED", None, None, None),
        ("demo-gt-evaluating", "GT-2026-004", "EVALUATING", None, None, None),
        ("demo-gt-awarded", "GT-2026-005", "AWARDED", "demo-nt-01", 1_150_000_000, "QĐ-TRÚNG-005"),
        ("demo-gt-cancelled", "GT-2026-006", "CANCELLED", None, None, None),
    ]
    for index, (package_id, code, status, winner, winning_value, result_decision) in enumerate(package_rows, 1):
        closing = f"2026-0{min(index + 1, 9)}-20 17:00:00"
        opening = f"2026-0{min(index + 1, 9)}-21 09:00:00"
        _insert(cursor, "goi_thau", {
            "id": package_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": package_id,
            "ma_goi_thau": code,
            "phien_ban": 0,
            "is_latest": 1,
            "ke_hoach_id": "demo-plan-01" if index <= 5 else "demo-plan-02",
            "ten_goi_thau": f"Gói thầu demo {index} - {status}",
            "gia_goi_thau": 1_500_000_000 + index * 100_000_000,
            "loai_hop_dong": "Trọn gói",
            "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
            "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
            "qua_mang": "Qua mạng",
            "trong_nuoc_quoc_te": "Trong nước",
            "thoi_gian_thuc_hien": "180 ngày",
            "nguon_von": "Ngân sách nhà nước",
            "nha_thau_trung_thau_id": winner,
            "gia_trung_thau": winning_value,
            "linh_vuc": "Công nghệ thông tin",
            "tuy_chon_mua_them": "Có" if index == 2 else "Không",
            "thoi_gian_to_chuc": "45 ngày",
            "thoi_gian_bat_dau_to_chuc": "2026-01-10",
            "phan_lo": "Có" if index in {3, 5} else "Không",
            "thoi_gian_dang_tai": "2026-01-05 08:00:00" if index > 1 else None,
            "thoi_gian_dong_thau": closing if index > 1 else None,
            "thoi_gian_mo_thau": opening if index > 1 else None,
            "so_quyet_dinh": f"QĐ-MỜI-{index:03d}" if index > 1 else None,
            "ngay_quyet_dinh": "2026-01-03" if index > 1 else None,
            "so_quyet_dinh_ket_qua": result_decision,
            "ngay_quyet_dinh_ket_qua": "2026-03-01" if winner else None,
            "thoi_gian_goi_thau": "30 ngày",
            "thoi_gian_hop_dong": "180 ngày",
            "gia_tri_dam_bao_du_thau": 50_000_000,
            "hieu_luc_hsdt": 120,
            "hieu_luc_dam_bao_du_thau": 150,
            "phuong_phap_danh_gia": "Giá thấp nhất",
            "trong_so_ky_thuat": 70,
            "ty_le_bao_dam_hop_dong": 10,
            "is_thuoc": 0,
            "is_rebid": 0,
            "trang_thai": status,
            "yeu_cau_tham_dinh_hsmt": "Có" if index in {4, 5} else "Không",
            "so_bao_cao_tham_dinh_hsmt": f"BC-TĐ-{index:03d}" if index in {4, 5} else None,
            "ngay_bao_cao_tham_dinh_hsmt": "2026-02-01" if index in {4, 5} else None,
            "so_to_trinh_hsmt": f"TTr-{index:03d}" if index in {4, 5} else None,
            "ngay_trinh_hsmt": "2026-01-25" if index in {4, 5} else None,
            "sync_version": 20 + index,
        })
    _insert(cursor, "goi_thau", {
        "id": "demo-gt-rebid",
        "organization_id": org_id,
        "owner_type": "organization",
        "id_goc": "demo-gt-rebid",
        "ma_goi_thau": "GT-2026-007",
        "phien_ban": 0,
        "is_latest": 1,
        "ke_hoach_id": "demo-plan-02",
        "ten_goi_thau": "Gói thầu tổ chức lại (Re-bid)",
        "gia_goi_thau": 900_000_000,
        "loai_hop_dong": "Trọn gói",
        "hinh_thuc_lua_chon": "Đấu thầu rộng rãi",
        "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
        "qua_mang": "Qua mạng",
        "trong_nuoc_quoc_te": "Trong nước",
        "thoi_gian_thuc_hien": "120 ngày",
        "nguon_von": "Ngân sách nhà nước",
        "thoi_gian_to_chuc": "30 ngày",
        "thoi_gian_bat_dau_to_chuc": "2026-03-01",
        "trang_thai": "PREPARING",
        "is_rebid": 1,
        "rebid_from_package_id": "demo-gt-cancelled",
        "sync_version": 30,
    })
    for package_id in ("demo-gt-opened", "demo-gt-awarded"):
        _insert(cursor, "goi_thau_phan_lo", {
            "id": f"{package_id}-lot-1",
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "ma_phan_lo": "XL-01",
            "ten_phan_lo": "Phần lô số 1",
            "gia_tri_phan_lo": 600_000_000,
            "bao_dam_du_thau": 20_000_000,
            "thoi_gian_thuc_hien": "90 ngày",
            "nha_thau_trung_thau_id": "demo-nt-01" if package_id.endswith("awarded") else None,
            "gia_trung_thau": 580_000_000 if package_id.endswith("awarded") else None,
            "sort_order": 1,
        })
        _insert(cursor, "goi_thau_phan_lo", {
            "id": f"{package_id}-lot-2",
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "ma_phan_lo": "XL-02",
            "ten_phan_lo": "Phần lô số 2",
            "gia_tri_phan_lo": 500_000_000,
            "bao_dam_du_thau": 15_000_000,
            "thoi_gian_thuc_hien": "60 ngày",
            "sort_order": 2,
        })
    _insert(cursor, "goi_thau_tuy_chon_mua_them", {
        "id": "demo-gt-invited-option",
        "organization_id": org_id,
        "owner_type": "organization",
        "goi_thau_id": "demo-gt-invited",
        "hang_muc": "Bổ sung thiết bị",
        "don_vi": "bộ",
        "so_luong": 5,
        "ty_le": 20,
        "gia_tri_uoc_tinh": 100_000_000,
        "sort_order": 1,
    })
    _insert(cursor, "goi_thau_gia_han", {
        "id": "demo-gt-opened-extension",
        "organization_id": org_id,
        "owner_type": "organization",
        "goi_thau_id": "demo-gt-opened",
        "thoi_gian_dong_thau": "2026-03-25 17:00:00",
        "ly_do_gia_han": "Điều chỉnh hồ sơ mời thầu.",
        "sort_order": 1,
    })
    for package_id in ("demo-gt-opened", "demo-gt-awarded"):
        _insert(cursor, "goi_thau_lam_ro", {
            "id": f"{package_id}-clarify-question",
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "loai": "yeu_cau",
            "thoi_gian": "2026-02-10 10:00:00",
            "noi_dung": "Đề nghị làm rõ yêu cầu kỹ thuật.",
            "sort_order": 1,
        })
        _insert(cursor, "goi_thau_lam_ro", {
            "id": f"{package_id}-clarify-answer",
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "loai": "tra_loi",
            "thoi_gian": "2026-02-12 15:00:00",
            "noi_dung": "Đã cập nhật phần giải đáp trên hệ thống.",
            "sort_order": 2,
        })

    for package_id, employee_id in (
        ("demo-gt-preparing", "demo-alice"),
        ("demo-gt-invited", "demo-alice"),
        ("demo-gt-opened", "demo-bao"),
        ("demo-gt-evaluating", "demo-bao"),
        ("demo-gt-awarded", "demo-chi"),
        ("demo-gt-cancelled", "demo-chi"),
        ("demo-gt-rebid", "demo-alice"),
    ):
        _assignment(cursor, f"demo-asg-{package_id}", org_id, employee_id, package_id, "goithau", 20)
    for plan_id, employee_id in (("demo-plan-01", "demo-alice"), ("demo-plan-02", "demo-bao"), ("demo-plan-03", "demo-chi")):
        _assignment(cursor, f"demo-asg-{plan_id}", org_id, employee_id, plan_id, "kehoach", 20)

    experts = [
        ("demo-expert-01", "Nguyễn Chuyên Gia", "CC-001"),
        ("demo-expert-02", "Trần Chuyên Gia", "CC-002"),
    ]
    for index, (expert_id, name, certificate) in enumerate(experts, 1):
        _insert(cursor, "chuyen_gia", {
            "id": expert_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": expert_id,
            "phien_ban": 0,
            "is_latest": 1,
            "ho_ten": name,
            "so_chung_chi": certificate,
            "ngay_cap_chung_chi": "2025-01-01",
            "don_vi_cap_chung_chi": "Bộ Demo",
            "so_cccd": f"00123456789{index}",
            "ngay_cap_cccd": "2024-01-01",
            "noi_cap_cccd": "Cục CSQLHC",
            "sync_version": 3,
        })
    _insert(cursor, "goi_thau_chuyen_gia", {
        "organization_id": org_id,
        "owner_type": "organization",
        "goi_thau_id": "demo-gt-evaluating",
        "chuyen_gia_id": "demo-expert-01",
        "loai": "chuyen_gia",
        "chuc_vu": "Tổ trưởng",
        "cong_viec": "Đánh giá hồ sơ kỹ thuật",
    })
    _insert(cursor, "goi_thau_chuyen_gia", {
        "organization_id": org_id,
        "owner_type": "organization",
        "goi_thau_id": "demo-gt-evaluating",
        "chuyen_gia_id": "demo-expert-02",
        "loai": "chuyen_gia",
        "chuc_vu": "Thành viên",
        "cong_viec": "Đánh giá hồ sơ tài chính",
    })

    for name, color in (("Chưa nhận hồ sơ", "#64748b"), ("Đang xử lý", "#2563eb"), ("Đã hoàn thành", "#16a34a")):
        _insert(cursor, "trang_thai_ho_so_giay", {
            "id": f"demo-paper-{name}",
            "organization_id": org_id,
            "owner_type": "organization",
            "name": name,
            "color": color,
            "sync_version": 2,
        })

    contract_rows = [
        ("demo-hd-not-effective", "HĐ-2026-001", "NOT_EFFECTIVE", None),
        ("demo-hd-active", "HĐ-2026-002", "ACTIVE", None),
        ("demo-hd-suspended", "HĐ-2026-003", "SUSPENDED", None),
        ("demo-hd-completed", "HĐ-2026-004", "COMPLETED", None),
        ("demo-hd-liquidated", "HĐ-2026-005", "LIQUIDATED", "2026-06-30"),
        ("demo-hd-cancelled", "HĐ-2026-006", "CANCELLED", None),
    ]
    for index, (contract_id, number, status, liquidated_at) in enumerate(contract_rows, 1):
        _insert(cursor, "hop_dong", {
            "id": contract_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "id_goc": contract_id,
            "phien_ban": 0,
            "is_latest": 1,
            "ten_hop_dong": f"Hợp đồng demo {index} - {status}",
            "so_hop_dong": number,
            "ngay_ky": "2026-02-15",
            "chu_dau_tu_id": "demo-cdt-01",
            "nha_thau_id": "demo-nt-01" if index <= 3 else "demo-nt-02",
            "ngay_thanh_ly": liquidated_at,
            "ke_hoach_id": "demo-plan-01",
            "gia_tri": 1_000_000_000 + index * 50_000_000,
            "loai_hop_dong": "Trọn gói",
            "thoi_gian_thuc_hien": "180 ngày",
            "trang_thai_hop_dong": status,
            "trang_thai_ho_so": "Đang xử lý" if status in {"ACTIVE", "SUSPENDED"} else "Đã hoàn thành",
            "phan_loai": "Hợp đồng xây lắp",
            "co_qd_chi_dinh": 0,
            "sync_version": 40 + index,
        })
    # Contract/package links are intentionally limited to awarded packages;
    # the database trigger rejects links to non-awarded packages unless the
    # contract is a designated appointment (co_qd_chi_dinh = 1).
    for contract_id in ("demo-hd-active",):
        _insert(cursor, "hop_dong_goi_thau", {
            "organization_id": org_id,
            "owner_type": "organization",
            "hop_dong_id": contract_id,
            "goi_thau_id": "demo-gt-awarded",
        })
    for contract_id, employee_id in zip(
        ("demo-hd-not-effective", "demo-hd-active", "demo-hd-suspended", "demo-hd-completed", "demo-hd-liquidated", "demo-hd-cancelled"),
        ("demo-alice", "demo-alice", "demo-bao", "demo-bao", "demo-chi", "demo-chi"),
    ):
        _assignment(cursor, f"demo-asg-{contract_id}", org_id, employee_id, contract_id, "hopdong", 50)

    for package_id, contractor_id in (("demo-gt-opened", "demo-nt-01"), ("demo-gt-awarded", "demo-nt-01"), ("demo-gt-evaluating", "demo-nt-04")):
        opening_id = f"demo-opening-{package_id}"
        _insert(cursor, "thong_tin_mo_thau", {
            "id": opening_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "nha_thau_id": contractor_id,
            "ma_phan_lo": "XL-01",
            "ten_phan_lo": "Phần lô số 1",
            "ma_dinh_danh": f"E-HSDT-{package_id}",
            "gia_du_thau": 1_400_000_000,
            "ty_le_giam_gia": 3.5,
            "gia_sau_giam_gia": 1_351_000_000,
            "hieu_luc_hsdt": 120,
            "gia_tri_dam_bao": 50_000_000,
            "hieu_luc_bao_dam_ngay": 150,
            "thoi_gian_thuc_hien": "180 ngày",
            "ten_nha_thau": "Công ty Công nghệ Sao Bắc",
            "loai_nha_thau": "Trong nước",
            "sync_version": 55,
        })
        _insert(cursor, "nha_thau_tham_du_mo_thau", {
            "id": f"demo-participant-{package_id}",
            "organization_id": org_id,
            "owner_type": "organization",
            "thong_tin_mo_thau_id": opening_id,
            "goi_thau_id": package_id,
            "lot_scope": "XL-01",
            "nha_thau_goc_id": contractor_id,
            "nha_thau_phien_ban_id": contractor_id,
        })

    for package_id, status, round_type in (
        ("demo-gt-evaluating", "completed", "technical"),
        ("demo-gt-evaluating", "approved", "financial"),
        ("demo-gt-awarded", "approved", "single"),
    ):
        round_id = f"demo-round-{package_id}-{round_type}"
        _insert(cursor, "vong_danh_gia", {
            "id": round_id,
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "loai_vong": round_type,
            "thu_tu": 1,
            "trang_thai": status,
            "so_bao_cao": f"BC-DG-{package_id}-{round_type}",
            "ngay_bao_cao": "2026-03-05",
            "da_luu_danh_sach_dat": 1 if status in {"completed", "approved"} else 0,
            "nguoi_cham_id": "demo-manager",
            "hoan_thanh_luc": f"{day} 10:00:00",
            "extension_json": json.dumps({"schemaVersion": 1, "demo": True}),
        })
        for index, criterion in enumerate(("Tính hợp lệ", "Năng lực kinh nghiệm", "Giải pháp kỹ thuật"), 1):
            _insert(cursor, "tieu_chi_danh_gia", {
                "id": f"{round_id}-criterion-{index}",
                "organization_id": org_id,
                "owner_type": "organization",
                "vong_danh_gia_id": round_id,
                "ma_tieu_chi": f"TC-{index:02d}",
                "ten_tieu_chi": criterion,
                "diem_toi_da": 100,
                "trong_so": 30 if index < 3 else 40,
                "thu_tu": index,
                "extension_json": json.dumps({"schemaVersion": 1}),
            })
        opening_id = f"demo-opening-{package_id}"
        if package_id == "demo-gt-awarded":
            _insert(cursor, "ket_qua_danh_gia_nha_thau", {
                "id": f"demo-result-{package_id}",
                "organization_id": org_id,
                "owner_type": "organization",
                "goi_thau_id": package_id,
                "thong_tin_mo_thau_id": opening_id,
                "danh_gia_hop_le": "Đạt",
                "danh_gia_nang_luc": "Đạt",
                "danh_gia_ky_thuat": "Đạt",
                "danh_gia_tai_chinh": "Đạt",
                "danh_gia_ket_luan": "Đạt",
                "diem": 92.5,
                "nguoi_cham_id": "demo-manager",
                "danh_gia_luc": f"{day} 11:00:00",
            })

    for index, package_id in enumerate(("demo-gt-preparing", "demo-gt-opened", "demo-gt-awarded"), 1):
        _insert(cursor, "goi_thau_moc_tien_do", {
            "id": f"demo-milestone-{index}-pending",
            "organization_id": org_id,
            "owner_type": "organization",
            "goi_thau_id": package_id,
            "ma_nhom": "I",
            "ten_nhom": "Chuẩn bị",
            "ma_moc": f"M{index:02d}",
            "cong_viec": "Hoàn thiện hồ sơ",
            "don_vi_ban_hanh": "Phòng Kế hoạch",
            "so_van_ban": "VB-DEMO",
            "ngay_du_kien": "2026-08-01",
            "ngay_thuc_te": "2026-07-20" if package_id == "demo-gt-awarded" else None,
            "ghi_chu": "Mốc tiến độ dùng để kiểm thử cảnh báo.",
            "source_key": f"demo:{package_id}:milestone",
            "source_mode": "MANUAL",
            "is_optional": 0,
            "trang_thai": "DONE" if package_id == "demo-gt-awarded" else "IN_PROGRESS",
            "sort_order": index,
            "template_version": 1,
            "sync_version": 60,
        })

    for employee_id, values in (
        ("demo-alice", ("view", "edit", "view", "", "view", "edit")),
        ("demo-bao", ("edit", "edit", "view", "view", "", "view")),
        ("demo-chi", ("view", "view", "", "edit", "edit", "")),
    ):
        _insert(cursor, "ma_tran_phan_quyen", {
            "id": f"demo-permission-{employee_id}",
            "organization_id": org_id,
            "owner_type": "organization",
            "emp_id": employee_id,
            "kehoach": values[0],
            "goithau": values[1],
            "chudautu": values[2],
            "nhathau": values[3],
            "chuyengia": values[4],
            "hopdong": values[5],
            "thongtinmothau": values[1],
            "sync_version": 70,
        })
        _insert(cursor, "document_export_capabilities", {
            "organization_id": org_id,
            "user_id": employee_id,
            "financial": 1 if employee_id == "demo-bao" else 0,
            "identity": 1 if employee_id != "demo-chi" else 0,
            "signature": 1 if employee_id == "demo-alice" else 0,
        })

    for user_id, kind, severity, title, message, target_type, target_id, read_at in (
        ("demo-alice", "assignment_added", "info", "Được phân công gói thầu", "Bạn được phân công phụ trách gói thầu GT-2026-001.", "goithau", "demo-gt-preparing", None),
        ("demo-bao", "assignment_removed", "warning", "Không còn phụ trách hợp đồng", "Bạn không còn quyền truy cập hợp đồng HĐ-2026-003.", "hopdong", "demo-hd-suspended", now - 3600),
        ("demo-chi", "organization_added", "info", "Được thêm vào tổ chức", "Bạn đã được thêm vào Công ty Demo HTD.", None, None, None),
        ("demo-manager", "assignment_added", "info", "Cảnh báo tiến độ", "Gói thầu GT-2026-003 có mốc tiến độ đang xử lý.", "goithau", "demo-gt-opened", None),
    ):
        _insert(cursor, "user_notifications", {
            "id": f"demo-notification-{user_id}-{kind}",
            "user_id": user_id,
            "organization_id": org_id,
            "kind": kind,
            "severity": severity,
            "title": title,
            "message": message,
            "target_type": target_type,
            "target_id": target_id,
            "route": f"/goi-thau-chi-tiet/{target_id}" if target_type == "goithau" else None,
            "read_at": read_at,
            "created_at": now - 7200,
        })

    _insert(cursor, "dinh_danh_ngoai", {
        "issuer": "https://accounts.google.com",
        "subject": "demo-google-subject",
        "user_id": "demo-alice",
        "email_norm": "demo.alice@example.test",
    })
    _insert(cursor, "cau_hinh_bien_word", {
        "id": "demo-word-variable-organization",
        "organization_id": org_id,
        "owner_type": "organization",
        "ten_bien": "TEN_DON_VI_DEMO",
        "source_table": "to_chuc",
        "source_column": "ten_to_chuc",
        "mo_ta": "Tên tổ chức dùng trong tài liệu demo.",
    })
    _insert(cursor, "word_default_seeds", {"organization_id": org_id, "mappings_version": 3})
    _insert(cursor, "sync_metadata", {"organization_id": org_id, "current_version": 100, "min_available_version": 0})
    _insert(cursor, "sync_metadata", {"organization_id": suspended_org_id, "current_version": 1, "min_available_version": 0})
    _insert(cursor, "record_edit_ownership", {
        "organization_id": org_id,
        "table_name": "goi_thau",
        "record_id": "demo-gt-opened",
        "user_id": "demo-bao",
    })
    _insert(cursor, "partner_upstream_health", {"upstream": "muasamcong", "failure_count": 0, "opened_until": 0, "probe_locked_until": 0, "updated_at": now})
    _insert(cursor, "partner_upstream_health", {"upstream": "vietqr", "failure_count": 2, "opened_until": now + 300, "probe_locked_until": now + 120, "updated_at": now})
    _insert(cursor, "partner_upstream_health", {"upstream": "escodata", "failure_count": 1, "opened_until": 0, "probe_locked_until": 0, "updated_at": now})
    _insert(cursor, "partner_lookup_cache", {"cache_key": "demo:tax:0101111111", "result_json": json.dumps({"name": "Công ty Công nghệ Sao Bắc"}), "found": 1, "expires_at": now + 3600, "updated_at": now})
    _insert(cursor, "partner_lookup_cache", {"cache_key": "demo:tax:0000000000", "result_json": json.dumps({}), "found": 0, "expires_at": now + 3600, "updated_at": now})
    for status, contractor_id in zip(
        ("pending", "processing", "completed", "failed"),
        ("demo-nt-01", "demo-nt-02", "demo-nt-03", "demo-nt-04"),
    ):
        _insert(cursor, "partner_enrichment_jobs", {
            "id": f"demo-enrichment-{status}",
            "organization_id": org_id,
            "contractor_id": contractor_id,
            "status": status,
            "attempt_count": 1,
            "available_at": now,
            "last_error_code": "UPSTREAM_TIMEOUT" if status == "failed" else None,
            "created_at": now - 600,
            "updated_at": now,
        })
    for status in ("pending", "processing", "retry", "completed", "failed"):
        _insert(cursor, "document_jobs", {
            "id": f"demo-document-job-{status}",
            "operation": "export_word_demo",
            "status": status,
            "attempt_count": 1,
            "available_at": now,
            "last_error_code": "TEMPLATE_NOT_FOUND" if status == "failed" else None,
            "last_error_message": "Demo lỗi sinh tài liệu." if status == "failed" else None,
            "completed_at": now if status == "completed" else None,
            "expires_at": now + 86400,
            "created_at": now - 600,
            "updated_at": now,
        })
    _insert(cursor, "websocket_events", {
        "event_type": "broadcast",
        "organization_id": org_id,
        "user_id": "demo-manager",
        "payload_json": json.dumps({"event": "db_changed", "tables": ["goithau", "hopdong"]}),
    })
    _insert(cursor, "websocket_events", {
        "event_type": "revoke_user",
        "organization_id": org_id,
        "user_id": "demo-former",
        "payload_json": json.dumps({"reason": "member_left"}),
    })
    _insert(cursor, "rate_limit_buckets", {"bucket_key": "demo:login:failed", "window_started_at": now - 10, "attempt_count": 2, "expires_at": now + 50})
    _insert(cursor, "api_idempotency", {
        "actor_user_id": "demo-manager",
        "operation": "demo_seed_operation",
        "idempotency_key": "demo-idempotency-key",
        "response_json": json.dumps({"status": "success", "demo": True}),
        "created_at": now,
    })
    _insert(cursor, "sync_mutations", {
        "organization_id": org_id,
        "actor_user_id": "demo-manager",
        "client_mutation_id": "demo-sync-mutation",
        "response_json": json.dumps({"status": "success", "demo": True}),
    })
    chain_id = f"demo-audit:{org_id}"
    previous_hash = "0" * 64
    audit_created_at = f"{day} 10:00:00"
    audit_metadata = json.dumps({"demo": True}, ensure_ascii=False, separators=(",", ":"))
    audit_event = {
        "chain_id": chain_id,
        "sequence": 1,
        "actor_user_id": "demo-manager",
        "organization_id": org_id,
        "action": "organization.member_added",
        "target_type": "organization_membership",
        "target_id": f"{org_id}:demo-alice",
        "ip_address": "127.0.0.1",
        "metadata_json": audit_metadata,
        "created_at": audit_created_at,
    }
    entry_hash = _entry_hash(previous_hash, audit_event)
    _insert(cursor, "audit_chain_heads", {
        "chain_id": chain_id,
        "last_sequence": 1,
        "last_hash": entry_hash,
        "updated_at": audit_created_at,
    })
    _insert(cursor, "audit_log", {
        "chain_id": chain_id,
        "sequence": 1,
        "actor_user_id": "demo-manager",
        "organization_id": org_id,
        "action": "organization.member_added",
        "target_type": "organization_membership",
        "target_id": f"{org_id}:demo-alice",
        "ip_address": "127.0.0.1",
        "metadata_json": audit_metadata,
        "created_at": audit_created_at,
        "previous_hash": previous_hash,
        "entry_hash": entry_hash,
    })
    audit_row = cursor.execute(
        "SELECT id FROM audit_log WHERE chain_id = ? AND sequence = 1",
        (chain_id,),
    ).fetchone()
    if audit_row:
        cursor.execute(
            "UPDATE audit_chain_heads SET last_log_id = ? WHERE chain_id = ?",
            (audit_row[0], chain_id),
        )
    _insert(cursor, "phan_cong_nhan_su_lich_su", {
        "organization_id": org_id,
        "assignment_id": "demo-asg-demo-gt-cancelled",
        "id_nhan_vien": "demo-former",
        "id_muc_tieu": "demo-gt-cancelled",
        "loai_doi_tuong": "goithau",
        "assigned_at": "2026-01-10 10:00:00",
        "ended_at": "2026-07-01 10:00:00",
        "ended_by": "demo-manager",
        "successor_user_id": "demo-alice",
        "reason": "member_left",
    })

    return {
        "organizations": 2,
        "users": 5,
        "plans": 4,
        "packages": 7,
        "contracts": 6,
        "contractors": 4,
        "experts": 2,
        "assignments": 16,
        "notifications": 4,
    }


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-demo", action="store_true", help="Required because this writes synthetic data.")
    parser.add_argument("--password", default="DemoUser123!", help="Password assigned to demo users.")
    parser.add_argument("--allow-production", action="store_true", help="Allow running when APP_ENV=production.")
    args = parser.parse_args()
    if not args.confirm_demo:
        parser.error("Pass --confirm-demo to create demo data.")
    if os.environ.get("APP_ENV", "development").strip().lower() == "production" and not args.allow_production:
        parser.error("Refusing to seed production. Use --allow-production only if this is intentional.")
    database_url = str(os.environ.get("MIGRATOR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if not database_url:
        parser.error("DATABASE_URL or MIGRATOR_DATABASE_URL is required.")

    with psycopg.connect(database_url, autocommit=False, application_name="biddingflow-demo-seed") as connection:
        with connection.cursor() as cursor:
            metadata = cursor.execute("SELECT schema_version FROM database_metadata WHERE id = 1").fetchone()
            if not metadata:
                raise RuntimeError("Database schema is not initialized.")
            counts = seed(cursor, demo_password=args.password)
        connection.commit()
    print("Demo data seeded successfully:")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    print(f"Demo users use the password supplied via --password (default: {args.password}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
