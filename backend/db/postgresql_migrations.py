"""Checksum-verified clean-baseline migration runner for PostgreSQL."""

import hashlib
import json
import os
import time

from backend.auth.auth_helper import hash_password
from backend.auth.identity import normalize_email, normalize_username
from backend.auth.password_policy import validate_new_password
from backend.db.id_utils import generate_record_id, stable_org_id
from backend.db.postgresql_schema import compile_postgresql_baseline
from backend.documents.word_defaults import ensure_default_word_mappings_for_all_orgs


POSTGRESQL_SCHEMA_VERSION = 1
POSTGRESQL_BASELINE_NAME = "0001_postgresql_clean_baseline"


def postgresql_baseline_checksum(compiled=None):
    compiled = compile_postgresql_baseline() if compiled is None else compiled
    material = json.dumps(compiled, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _seed_fresh_postgresql_database(connection, environ):
    connection.executemany(
        "INSERT INTO goi_dich_vu (id, ten_goi, gia_ca, han_muc_nhan_su, mo_ta) VALUES (?, ?, ?, ?, ?)",
        [
            ("silver", "Gói Bạc (Silver)", 15_000_000, 5, "Quản lý tối đa 5 nhân sự."),
            ("gold", "Gói Vàng (Gold)", 35_000_000, 15, "Quản lý tối đa 15 nhân sự."),
            ("diamond", "Gói Kim Cương (Diamond)", 75_000_000, 999, "Không giới hạn nhân sự."),
        ],
    )
    admin_password = str(environ.get("ADMIN_PASSWORD", ""))
    password_valid, password_error = validate_new_password(admin_password)
    if not password_valid:
        raise RuntimeError(
            f"ADMIN_PASSWORD does not satisfy password policy: {password_error}"
        )
    admin_id = generate_record_id("tai_khoan")
    admin_name = str(environ.get("ADMIN_NAME", "Administrator")).strip() or "Administrator"
    admin_username = normalize_username(environ.get("ADMIN_USERNAME", "admin"))
    admin_email = normalize_email(environ.get("ADMIN_EMAIL", "admin@localhost"))
    organization_name = str(environ.get("DEFAULT_ORG_NAME", "HTD")).strip() or "HTD"
    organization_id = stable_org_id(organization_name)
    connection.execute(
        """
        INSERT INTO tai_khoan (
            id, ten_dang_nhap, username_norm, mat_khau, ho_ten, vai_tro,
            email, email_norm, da_xac_minh
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
    connection.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc, scope_type) VALUES (?, ?, 'organization')",
        (organization_id, organization_name),
    )
    connection.execute(
        "INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, ?, 'manager')",
        (admin_id, organization_id),
    )
    now = int(time.time())
    connection.execute(
        """
        INSERT INTO organization_subscriptions (
            organization_id, package_id, status, starts_at, expires_at, member_quota
        ) VALUES (?, 'diamond', 'active', ?, ?, 999)
        """,
        (organization_id, now, now + 3650 * 24 * 60 * 60),
    )
    connection.execute(
        "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, 1)",
        (organization_id,),
    )
    ensure_default_word_mappings_for_all_orgs(connection.cursor())


def initialize_postgresql_database(database, environ=None):
    environment = os.environ if environ is None else environ
    compiled = compile_postgresql_baseline()
    checksum = postgresql_baseline_checksum(compiled)
    connection = database.get_connection()
    try:
        with database.transaction(connection):
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    checksum TEXT NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            applied = connection.execute(
                "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
            ).fetchall()
            if applied:
                if len(applied) != 1:
                    raise RuntimeError("Unexpected PostgreSQL migration history length.")
                row = applied[0]
                if (
                    int(row[0]) != POSTGRESQL_SCHEMA_VERSION
                    or row[1] != POSTGRESQL_BASELINE_NAME
                    or row[2] != checksum
                ):
                    raise RuntimeError("PostgreSQL migration checksum mismatch.")
                return POSTGRESQL_SCHEMA_VERSION
            for statement in compiled["extensions"]:
                connection.execute(statement)
            for statement in compiled["createTables"]:
                connection.execute(statement)
            for statement in compiled["foreignKeys"]:
                connection.execute(statement)
            for statement in compiled["functions"]:
                connection.execute(statement)
            for statement in compiled["indexes"]:
                connection.execute(statement)
            for statement in compiled["triggers"]:
                connection.execute(statement)
            _seed_fresh_postgresql_database(connection, environment)
            connection.execute(
                "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
                (
                    POSTGRESQL_SCHEMA_VERSION,
                    POSTGRESQL_BASELINE_NAME,
                    checksum,
                ),
            )
        return POSTGRESQL_SCHEMA_VERSION
    finally:
        connection.close()
