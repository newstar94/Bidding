"""Compile the canonical application schema into PostgreSQL baseline DDL."""

import hashlib
import re

from backend.db.postgresql_features import (
    POSTGRESQL_EXTENSIONS,
    POSTGRESQL_FUNCTIONS,
    build_postgresql_indexes,
    build_postgresql_triggers,
)
from backend.db.schema import MONEY_COLUMNS, SCHEMA_DINH_NGHIA
from backend.db.postgresql_types import (
    BOOLEAN_COLUMNS,
    DATE_COLUMNS,
    EPOCH_COLUMNS,
    TIMESTAMP_COLUMNS,
)


POSTGRESQL_EXTRA_TABLES = {
    "document_worker_leases": {
        "columns": {
            "lease_id": "TEXT PRIMARY KEY",
            "expires_at": "INTEGER NOT NULL CHECK(expires_at > 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
    },
    "record_edit_ownership": {
        "columns": {
            "organization_id": "TEXT NOT NULL",
            "table_name": "TEXT NOT NULL CHECK(table_name IN ('chu_dau_tu', 'nha_thau'))",
            "record_id": "TEXT NOT NULL",
            "user_id": "TEXT NOT NULL",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
        "primary_keys": ["organization_id", "table_name", "record_id"],
        "foreign_keys": [
            "FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE",
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
        ],
    },
    "goi_thau_moc_tien_do": {
        "columns": {
            "id": "TEXT PRIMARY KEY",
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "owner_type": "TEXT NOT NULL DEFAULT 'organization' CHECK(owner_type IN ('organization', 'personal'))",
            "goi_thau_id": "TEXT NOT NULL CHECK(trim(goi_thau_id) != '')",
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
            "sort_order": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sort_order) = 'integer' AND sort_order BETWEEN 0 AND 499)",
            "template_version": "INTEGER NOT NULL DEFAULT 1 CHECK(typeof(template_version) = 'integer' AND template_version >= 1)",
            "sync_version": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(sync_version) = 'integer' AND sync_version >= 0)",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
        "unique_constraints": [
            "UNIQUE(organization_id, id)",
            "UNIQUE(organization_id, goi_thau_id, ma_moc)",
        ],
        "foreign_keys": [
            "FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE",
        ],
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
            "requested_ip": "TEXT",
        },
        "unique_constraints": [
            "CHECK (pending_email_norm != current_email_norm)",
            "CHECK (verified_at IS NULL OR (verified_at >= requested_at AND verified_at <= expires_at))",
        ],
        "foreign_keys": [
            "FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE",
        ],
    },
    "document_export_capabilities": {
        "columns": {
            "organization_id": "TEXT NOT NULL CHECK(organization_id != '')",
            "user_id": "TEXT NOT NULL CHECK(user_id != '')",
            "financial": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(financial) = 'integer' AND financial IN (0, 1))",
            "identity": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(identity) = 'integer' AND identity IN (0, 1))",
            "signature": "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(signature) = 'integer' AND signature IN (0, 1))",
            "created_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
            "updated_at": "TEXT NOT NULL DEFAULT (datetime('now'))",
        },
        "primary_keys": ["organization_id", "user_id"],
        "foreign_keys": [
            "FOREIGN KEY (user_id, organization_id) REFERENCES thanh_vien_to_chuc(user_id, organization_id) ON DELETE CASCADE",
        ],
    },
}


_TYPEOF_INTEGER = re.compile(
    r"typeof\(([A-Za-z_][A-Za-z0-9_]*)\)\s*=\s*'integer'\s+AND\s+",
    re.IGNORECASE,
)
_TYPEOF_NUMERIC = re.compile(
    r"typeof\(([A-Za-z_][A-Za-z0-9_]*)\)\s+IN\s*"
    r"\(\s*'integer'\s*,\s*'real'\s*\)\s+AND\s+",
    re.IGNORECASE,
)
_DATE_VALIDATION = re.compile(
    r"date\(([A-Za-z_][A-Za-z0-9_]*)\)\s+IS\s+NOT\s+NULL",
    re.IGNORECASE,
)


def _constraint_name(prefix, table_name, material):
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:10]
    stem = re.sub(r"[^a-z0-9_]+", "_", f"{prefix}_{table_name}".casefold())
    return f"{stem[:51]}_{digest}"


def _translate_column_definition(table_name, column_name, definition):
    source = str(definition).strip()
    if column_name in BOOLEAN_COLUMNS:
        not_null = " NOT NULL" if re.search(r"\bNOT\s+NULL\b", source, re.IGNORECASE) else ""
        default_match = re.search(r"\bDEFAULT\s+([01])\b", source, re.IGNORECASE)
        default = ""
        if default_match:
            default = " DEFAULT TRUE" if default_match.group(1) == "1" else " DEFAULT FALSE"
        return f"BOOLEAN{not_null}{default}"
    if column_name in DATE_COLUMNS and re.match(r"^TEXT\b", source, re.IGNORECASE):
        not_null = " NOT NULL" if re.search(r"\bNOT\s+NULL\b", source, re.IGNORECASE) else ""
        default = (
            " DEFAULT CURRENT_DATE"
            if re.search(r"date\(\s*'now'\s*\)", source, re.IGNORECASE)
            else ""
        )
        return f"DATE{not_null}{default}"
    if column_name in TIMESTAMP_COLUMNS and re.match(r"^TEXT\b", source, re.IGNORECASE):
        not_null = " NOT NULL" if re.search(r"\bNOT\s+NULL\b", source, re.IGNORECASE) else ""
        default = (
            " DEFAULT CURRENT_TIMESTAMP"
            if re.search(r"datetime\(\s*'now'\s*\)", source, re.IGNORECASE)
            else ""
        )
        return f"TIMESTAMPTZ{not_null}{default}"
    if (column_name in EPOCH_COLUMNS or column_name == "created_at") and re.match(
        r"^INTEGER\b", source, re.IGNORECASE
    ):
        source = re.sub(r"^INTEGER\b", "BIGINT", source, flags=re.IGNORECASE)
    if re.match(r"^INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b", source, re.IGNORECASE):
        source = re.sub(
            r"^INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b",
            "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
            source,
            flags=re.IGNORECASE,
        )
    elif (table_name, column_name) in MONEY_COLUMNS:
        source = re.sub(r"^INTEGER\b", "BIGINT", source, flags=re.IGNORECASE)
    else:
        source = re.sub(r"^REAL\b", "NUMERIC(20,4)", source, flags=re.IGNORECASE)
    source = re.sub(r"^BLOB\b", "BYTEA", source, flags=re.IGNORECASE)
    source = re.sub(
        r"datetime\(\s*'now'\s*\)",
        "CURRENT_TIMESTAMP",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(
        r"date\(\s*'now'\s*\)",
        "CURRENT_DATE",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(
        r"datetime\(([A-Za-z_][A-Za-z0-9_]*)\)",
        r"NULLIF(\1, '')::timestamptz",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(
        r"date\(([A-Za-z_][A-Za-z0-9_]*)\)",
        r"NULLIF(\1, '')::date",
        source,
        flags=re.IGNORECASE,
    )
    source = _TYPEOF_INTEGER.sub("", source)
    source = _TYPEOF_NUMERIC.sub("", source)
    source = _DATE_VALIDATION.sub(
        r"\1 ~ '^\\d{4}-\\d{2}-\\d{2}$'",
        source,
    )
    source = re.sub(
        r"json_valid\(([A-Za-z_][A-Za-z0-9_]*)\)",
        r"\1 IS NOT NULL",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(
        r"CAST\(([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+BLOB\)",
        r"convert_to(\1, 'UTF8')",
        source,
        flags=re.IGNORECASE,
    )
    return source


def _translate_table_constraint(table_name, constraint):
    source = str(constraint).strip()
    del table_name
    for column_name in DATE_COLUMNS:
        source = re.sub(
            rf"date\(\s*{column_name}\s*\)",
            column_name,
            source,
            flags=re.IGNORECASE,
        )
        source = re.sub(
            rf"NULLIF\(\s*{column_name}\s*,\s*''\s*\)",
            column_name,
            source,
            flags=re.IGNORECASE,
        )
        source = re.sub(
            rf"trim\(\s*{column_name}\s*\)",
            f"COALESCE({column_name}::text, '')",
            source,
            flags=re.IGNORECASE,
        )
    return _translate_column_definition("", "", source)


def compile_postgresql_baseline(schema=None):
    if schema is None:
        schema = {**SCHEMA_DINH_NGHIA, **POSTGRESQL_EXTRA_TABLES}
    create_tables = []
    foreign_keys = []
    manifest = {}
    for table_name, table_spec in schema.items():
        columns = []
        primary_keys = tuple(table_spec.get("primary_keys") or ())
        column_manifest = {}
        for column_name, definition in table_spec["columns"].items():
            translated = _translate_column_definition(
                table_name,
                column_name,
                definition,
            )
            if primary_keys and column_name in primary_keys:
                translated = re.sub(
                    r"\bPRIMARY\s+KEY\b",
                    "",
                    translated,
                    flags=re.IGNORECASE,
                ).strip()
            columns.append(f'"{column_name}" {translated}')
            column_manifest[column_name] = translated
        if primary_keys:
            quoted = ", ".join(f'"{name}"' for name in primary_keys)
            columns.append(f"PRIMARY KEY ({quoted})")
        translated_unique_constraints = [
            _translate_table_constraint(table_name, constraint)
            for constraint in (table_spec.get("unique_constraints") or ())
        ]
        columns.extend(translated_unique_constraints)
        create_tables.append(
            f'CREATE TABLE "{table_name}" (\n  '
            + ",\n  ".join(columns)
            + "\n);"
        )
        table_foreign_keys = []
        for foreign_key in table_spec.get("foreign_keys") or ():
            constraint_name = _constraint_name("fk", table_name, foreign_key)
            foreign_keys.append(
                f'ALTER TABLE "{table_name}" ADD CONSTRAINT '
                f'"{constraint_name}" {foreign_key};'
            )
            table_foreign_keys.append(
                {"name": constraint_name, "definition": foreign_key}
            )
        manifest[table_name] = {
            "columns": column_manifest,
            "primaryKeys": list(primary_keys),
            "uniqueConstraints": translated_unique_constraints,
            "foreignKeys": table_foreign_keys,
        }
    return {
        "extensions": list(POSTGRESQL_EXTENSIONS),
        "createTables": create_tables,
        "foreignKeys": foreign_keys,
        "functions": list(POSTGRESQL_FUNCTIONS),
        "indexes": build_postgresql_indexes(),
        "triggers": build_postgresql_triggers(),
        "manifest": manifest,
    }
