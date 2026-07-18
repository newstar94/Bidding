"""Startup validation and readiness checks.

These checks deliberately live outside ``backend.app`` so they can be tested
without starting the ASGI server or touching the configured application DB.
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from backend.shared.paths import PROJECT_ROOT


class StartupValidationError(RuntimeError):
    """Raised when the process cannot safely start serving traffic."""


REQUIRED_APPLICATION_TABLES = frozenset({
    "tai_khoan",
    "to_chuc",
    "thanh_vien_to_chuc",
    "schema_migrations",
    "password_reset_tokens",
    "rate_limit_buckets",
})

_SYNC_DIRECTORY_MARKERS = ("onedrive", "dropbox", "google drive", "icloud")
_SEPARATE_RUNTIME_PATHS = (
    "AUDIT_CHECKPOINT_DIR",
    "BIDDING_BACKUP_DIR",
    "BIDDING_LOG_DIR",
    "BIDDING_UPLOAD_DIR",
    "BIDDING_WORD_TEMPLATE_DIR",
    "DOCUMENT_WORKER_TEMP_DIR",
)


def _is_within(path, parent):
    try:
        Path(path).resolve().relative_to(Path(parent).resolve())
        return True
    except ValueError:
        return False


def _validate_production_sqlite_layout(database, environ):
    raw_db_path = str(environ.get("BIDDING_DB_PATH", "")).strip()
    if not raw_db_path or not Path(raw_db_path).is_absolute():
        raise StartupValidationError(
            "BIDDING_DB_PATH must be an absolute path on a local persistent volume in production."
        )

    db_path = Path(database.db_path).resolve()
    lowered_db_path = str(db_path).casefold()
    if any(marker in lowered_db_path for marker in _SYNC_DIRECTORY_MARKERS):
        raise StartupValidationError(
            "The production SQLite database cannot be stored in a file-sync directory."
        )
    if _is_within(db_path, PROJECT_ROOT):
        raise StartupValidationError(
            "The production SQLite database must be outside the application source directory."
        )
    if str(environ.get("BIDDING_SQLITE_SINGLE_WRITER", "")).strip().lower() != "true":
        raise StartupValidationError(
            "BIDDING_SQLITE_SINGLE_WRITER=true is required when production uses SQLite."
        )

    db_directory = db_path.parent
    for variable in _SEPARATE_RUNTIME_PATHS:
        raw_path = str(environ.get(variable, "")).strip()
        if not raw_path or not Path(raw_path).is_absolute():
            raise StartupValidationError(
                f"{variable} must be an explicit absolute path in production."
            )
        runtime_path = Path(raw_path).resolve()
        if _is_within(runtime_path, db_directory):
            raise StartupValidationError(
                f"{variable} must be outside the SQLite database directory."
            )


def database_requires_admin_bootstrap(database):
    """Return True when the configured DB has no account to administer it."""
    db_path = getattr(database, "db_path", None)
    if not db_path or not os.path.exists(db_path) or os.path.getsize(db_path) == 0:
        return True

    conn = None
    try:
        conn = database.get_connection()
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tai_khoan'"
        ).fetchone()
        if table_exists is None:
            return True
        return conn.execute("SELECT 1 FROM tai_khoan LIMIT 1").fetchone() is None
    finally:
        if conn is not None:
            conn.close()


def validate_startup_configuration(database, environ=None):
    """Validate configuration that must exist before first-run migration."""
    environ = os.environ if environ is None else environ
    app_env = str(environ.get("APP_ENV", "development")).strip().lower()
    requires_bootstrap = database_requires_admin_bootstrap(database)
    if app_env in {"prod", "production"}:
        _validate_production_sqlite_layout(database, environ)
        audit_hmac_key = str(environ.get("AUDIT_CHECKPOINT_HMAC_KEY", ""))
        if len(audit_hmac_key.encode("utf-8")) < 32:
            raise StartupValidationError(
                "AUDIT_CHECKPOINT_HMAC_KEY must contain at least 32 bytes in production."
            )
        restore_drill_hmac_key = str(
            environ.get("BIDDING_RESTORE_DRILL_HMAC_KEY", "")
        )
        if len(restore_drill_hmac_key.encode("utf-8")) < 32:
            raise StartupValidationError(
                "BIDDING_RESTORE_DRILL_HMAC_KEY must contain at least 32 bytes in production."
            )
        if str(environ.get("AUDIT_CHECKPOINT_OFFHOST_CONFIRMED", "")).strip().lower() != "true":
            raise StartupValidationError(
                "AUDIT_CHECKPOINT_OFFHOST_CONFIRMED=true is required after configuring immutable off-host checkpoint replication."
            )
        if str(environ.get("DATA_AT_REST_ENCRYPTION_CONFIRMED", "")).strip().lower() != "true":
            raise StartupValidationError(
                "DATA_AT_REST_ENCRYPTION_CONFIRMED=true is required after verifying encrypted runtime and backup volumes."
            )
        rotation_text = str(environ.get("SECRET_ROTATION_CONFIRMED_AT", "")).strip()
        try:
            rotation_date = datetime.strptime(rotation_text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError as exc:
            raise StartupValidationError(
                "SECRET_ROTATION_CONFIRMED_AT must be an ISO date recording the latest credential rotation."
            ) from exc
        rotation_age_days = (datetime.now(timezone.utc).date() - rotation_date.date()).days
        if rotation_age_days < 0 or rotation_age_days > 90:
            raise StartupValidationError(
                "SMTP/OAuth/application credentials must be rotated and SECRET_ROTATION_CONFIRMED_AT refreshed at least every 90 days."
            )
        if str(environ.get("APP_DEBUG", "")).strip().lower() not in {"false", "0", "no"}:
            raise StartupValidationError("APP_DEBUG=False is required in production.")
        if str(environ.get("APP_SECURE_COOKIES", "")).strip().lower() != "true":
            raise StartupValidationError("APP_SECURE_COOKIES=True is required in production.")
        public_url = str(environ.get("APP_PUBLIC_URL", "")).strip()
        parsed_public_url = urlparse(public_url)
        if parsed_public_url.scheme != "https" or not parsed_public_url.netloc or parsed_public_url.hostname in {"localhost", "127.0.0.1", "::1"}:
            raise StartupValidationError("APP_PUBLIC_URL must be a public HTTPS origin in production.")
        if requires_bootstrap:
            required_bootstrap = {
                "ADMIN_USERNAME": str(environ.get("ADMIN_USERNAME", "")).strip(),
                "ADMIN_NAME": str(environ.get("ADMIN_NAME", "")).strip(),
                "ADMIN_EMAIL": str(environ.get("ADMIN_EMAIL", "")).strip(),
                "DEFAULT_ORG_NAME": str(environ.get("DEFAULT_ORG_NAME", "")).strip(),
            }
            missing = [key for key, value in required_bootstrap.items() if not value]
            if missing:
                raise StartupValidationError(
                    "First-run production configuration is missing: " + ", ".join(missing)
                )
            admin_email = required_bootstrap["ADMIN_EMAIL"]
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", admin_email) or admin_email.casefold().endswith("@localhost"):
                raise StartupValidationError("ADMIN_EMAIL must be a valid non-local address in production.")
    admin_password = str(environ.get("ADMIN_PASSWORD", ""))
    if requires_bootstrap and not admin_password.strip():
        raise StartupValidationError(
            "ADMIN_PASSWORD is required when bootstrapping a database without users."
        )


def verify_database_readiness(database, expected_schema_version):
    """Verify schema, bootstrap invariants and write-lock availability.

    ``BEGIN IMMEDIATE`` obtains SQLite's write reservation without changing
    application data. The transaction is always rolled back.
    """
    conn = None
    transaction_started = False
    try:
        conn = database.get_connection()
        if conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise StartupValidationError("SQLite foreign key enforcement is disabled.")

        conn.execute("BEGIN IMMEDIATE")
        transaction_started = True

        actual_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if actual_version != int(expected_schema_version):
            raise StartupValidationError(
                f"Unexpected database schema version: {actual_version}."
            )

        existing_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        missing_tables = sorted(REQUIRED_APPLICATION_TABLES - existing_tables)
        if missing_tables:
            raise StartupValidationError(
                "Required database tables are missing: " + ", ".join(missing_tables)
            )

        quick_check = conn.execute("PRAGMA quick_check(1)").fetchone()
        if quick_check is None or str(quick_check[0]).lower() != "ok":
            raise StartupValidationError("SQLite quick_check did not return ok.")

        foreign_key_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_violations:
            raise StartupValidationError(
                f"SQLite foreign_key_check found {len(foreign_key_violations)} violation(s)."
            )

        bootstrap_admin = conn.execute(
            """
            SELECT 1
            FROM tai_khoan AS users
            INNER JOIN thanh_vien_to_chuc AS memberships
                ON memberships.user_id = users.id
            INNER JOIN to_chuc AS organizations
                ON organizations.id = memberships.organization_id
            WHERE users.vai_tro = 'super_admin'
            LIMIT 1
            """
        ).fetchone()
        if bootstrap_admin is None:
            raise StartupValidationError(
                "No super administrator with an organization membership exists."
            )
    finally:
        if conn is not None:
            if transaction_started:
                conn.rollback()
            conn.close()


def verify_database_responsive(database, expected_schema_version):
    """Run the lightweight checks used by the readiness HTTP endpoint."""
    conn = None
    try:
        conn = database.get_connection()
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if version != int(expected_schema_version):
            raise StartupValidationError("Database schema version changed after startup.")
        if conn.execute("SELECT 1 FROM tai_khoan LIMIT 1").fetchone() is None:
            raise StartupValidationError("No application user is available.")
    finally:
        if conn is not None:
            conn.close()
