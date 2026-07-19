"""Startup validation and readiness checks.

These checks deliberately live outside ``backend.app`` so they can be tested
without starting the ASGI server or touching the configured application DB.
"""

import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse


class StartupValidationError(RuntimeError):
    """Raised when the process cannot safely start serving traffic."""


REQUIRED_APPLICATION_TABLES = frozenset({
    "tai_khoan",
    "to_chuc",
    "thanh_vien_to_chuc",
    "database_metadata",
    "password_reset_tokens",
    "rate_limit_buckets",
})

def _validate_postgresql_configuration(database, environ, *, production):
    raw_url = str(environ.get("DATABASE_URL", "")).strip()
    if not raw_url:
        raise StartupValidationError("DATABASE_URL is required for PostgreSQL.")
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise StartupValidationError("DATABASE_URL must use postgresql://.")
    if not parsed.hostname or not parsed.path.strip("/"):
        raise StartupValidationError(
            "DATABASE_URL must include a PostgreSQL host and database name."
        )
    if parsed.password is None:
        raise StartupValidationError("DATABASE_URL must include database credentials.")
    if production:
        query = {
            key.casefold(): value.casefold()
            for key, value in (
                item.split("=", 1) if "=" in item else (item, "")
                for item in parsed.query.split("&")
                if item
            )
        }
        sslmode = str(
            environ.get("DATABASE_SSLMODE", query.get("sslmode", ""))
        ).strip().casefold()
        if sslmode != "verify-full":
            raise StartupValidationError(
                "PostgreSQL production connections require sslmode=verify-full."
            )
    # Force URL validation on the configured database object without opening a
    # second connection when tests supply an isolated environment mapping.
    if environ is os.environ:
        database.database_url


def database_requires_admin_bootstrap(database):
    """Return True when the configured DB has no account to administer it."""
    conn = None
    try:
        conn = database.get_connection()
        table_exists = conn.execute(
            """SELECT 1 FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_name = 'tai_khoan'"""
        ).fetchone()
        if table_exists is None:
            return True
        return conn.execute("SELECT 1 FROM tai_khoan LIMIT 1").fetchone() is None
    finally:
        if conn is not None:
            conn.close()


def validate_startup_configuration(database, environ=None):
    """Validate configuration that must exist before first-run initialization."""
    environ = os.environ if environ is None else environ
    app_env = str(environ.get("APP_ENV", "development")).strip().lower()
    is_production = app_env in {"prod", "production"}
    _validate_postgresql_configuration(database, environ, production=is_production)
    requires_bootstrap = database_requires_admin_bootstrap(database)
    if is_production:
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
        release_id = str(environ.get("APP_RELEASE_ID", "")).strip()
        if (
            not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{6,127}", release_id)
            or release_id.casefold() in {"development", "replace-with-release-id"}
        ):
            raise StartupValidationError(
                "APP_RELEASE_ID must identify the immutable production release."
            )
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
    """Verify PostgreSQL schema, constraints and bootstrap invariants."""
    conn = None
    transaction_started = False
    try:
        conn = database.get_connection()
        conn.execute("BEGIN")
        transaction_started = True
        version_row = conn.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        if not version_row:
            raise StartupValidationError("Database schema metadata is missing.")
        actual_version = int(version_row[0])
        if actual_version != int(expected_schema_version):
            raise StartupValidationError(
                f"Unexpected database schema version: {actual_version}."
            )

        existing_tables = {
            row[0]
            for row in conn.execute(
                """SELECT table_name FROM information_schema.tables
                   WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"""
            ).fetchall()
        }
        missing_tables = sorted(REQUIRED_APPLICATION_TABLES - existing_tables)
        if missing_tables:
            raise StartupValidationError(
                "Required database tables are missing: " + ", ".join(missing_tables)
            )

        invalid_foreign_keys = conn.execute(
            """SELECT conname FROM pg_constraint
               WHERE contype = 'f' AND NOT convalidated
                 AND connamespace = current_schema()::regnamespace"""
        ).fetchall()
        if invalid_foreign_keys:
            raise StartupValidationError(
                f"PostgreSQL has {len(invalid_foreign_keys)} unvalidated foreign key(s)."
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
        row = conn.execute(
            "SELECT schema_version FROM database_metadata WHERE id = 1"
        ).fetchone()
        if not row:
            raise StartupValidationError("Database schema metadata is unavailable.")
        version = int(row[0])
        if version != int(expected_schema_version):
            raise StartupValidationError("Database schema version changed after startup.")
        if conn.execute("SELECT 1 FROM tai_khoan LIMIT 1").fetchone() is None:
            raise StartupValidationError("No application user is available.")
    finally:
        if conn is not None:
            conn.close()
