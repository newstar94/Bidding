"""Create the complete schema for a brand-new BiddingFlow installation."""

import json
import os
import time

from backend.auth.auth_helper import hash_password
from backend.auth.identity import normalize_email, normalize_username
from backend.auth.password_policy import validate_new_password
from backend.db.id_utils import generate_record_id, stable_org_id
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.documents.word_defaults import ensure_default_word_mappings_for_all_orgs


VERSION = 1
NAME = "0001_clean_baseline"


def checksum_material():
    return json.dumps(SCHEMA_DINH_NGHIA, ensure_ascii=False, sort_keys=True)


def apply(cursor, context):
    existing_application_tables = {
        row[0]
        for row in cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        if row[0] in SCHEMA_DINH_NGHIA
    }
    if existing_application_tables:
        raise RuntimeError(
            "0001_clean_baseline requires an empty database; existing tables: "
            + ", ".join(sorted(existing_application_tables))
        )

    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        cursor.execute(context.build_create_table_sql(table_name, table_spec))

    cursor.executemany(
        "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
        [
            ("silver", "Gói Bạc (Silver)", 15_000_000, 5, "Phù hợp với đơn vị quy mô nhỏ, quản lý tối đa 5 nhân sự."),
            ("gold", "Gói Vàng (Gold)", 35_000_000, 15, "Giải pháp cho phòng thầu chuyên nghiệp, tối đa 15 nhân sự."),
            ("diamond", "Gói Kim Cương (Diamond)", 75_000_000, 999, "Gói quản trị không giới hạn số lượng nhân sự."),
        ],
    )

    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    password_valid, password_error = validate_new_password(admin_password)
    if not password_valid:
        raise RuntimeError(f"ADMIN_PASSWORD does not satisfy password policy: {password_error}")
    admin_id = generate_record_id("tai_khoan")
    admin_name = os.environ.get("ADMIN_NAME", "Administrator").strip() or "Administrator"
    admin_username = normalize_username(os.environ.get("ADMIN_USERNAME", "admin"))
    admin_email = normalize_email(os.environ.get("ADMIN_EMAIL", "admin@localhost"))
    organization_name = os.environ.get("DEFAULT_ORG_NAME", "HTD").strip() or "HTD"
    organization_id = stable_org_id(organization_name)
    cursor.execute(
        """
        INSERT INTO tai_khoan (
            id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro, email, email_norm,
            da_xac_minh
        ) VALUES (?, ?, ?, ?, ?, 'super_admin', ?, ?, 1)
        """,
        (
            admin_id,
            admin_username,
            admin_username,
            hash_password(admin_password),
            admin_name,
            admin_email,
            admin_email,
        ),
    )
    cursor.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc, scope_type) VALUES (?, ?, 'organization')",
        (organization_id, organization_name),
    )
    cursor.execute(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, 'owner')",
        (admin_id, organization_id),
    )
    now = int(time.time())
    cursor.execute(
        """
        INSERT INTO organization_subscriptions (
            organization_id, package_id, status, starts_at, expires_at, member_quota
        ) VALUES (?, 'diamond', 'active', ?, ?, 999)
        """,
        (organization_id, now, now + 3650 * 24 * 60 * 60),
    )
    cursor.execute(
        "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, 1)",
        (organization_id,),
    )

    context.create_indexes_and_triggers(cursor)
    ensure_default_word_mappings_for_all_orgs(cursor)

    missing_tables = sorted(
        set(SCHEMA_DINH_NGHIA)
        - {
            row[0]
            for row in cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
    )
    if missing_tables:
        raise RuntimeError("Baseline migration did not create: " + ", ".join(missing_tables))
    context.assert_foreign_key_integrity(cursor)
