"""Startup validation and readiness checks.

These checks deliberately live outside ``backend.app`` so they can be tested
without starting the ASGI server or touching the configured application DB.
"""

import base64
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from backend.auth.email_utils import smtp_configuration_errors
from backend.auth.email_delivery_service import (
    EmailOutboxConfigurationError,
    validate_email_outbox_configuration,
)
from backend.auth.mfa_service import MfaConfigurationError, validate_mfa_configuration


class StartupValidationError(RuntimeError):
    """Raised when the process cannot safely start serving traffic."""


REQUIRED_APPLICATION_TABLES = frozenset({
    "tai_khoan",
    "to_chuc",
    "thanh_vien_to_chuc",
    "database_metadata",
    "password_reset_tokens",
    "email_delivery_status",
    "rate_limit_buckets",
    "partner_lookup_cache",
    "partner_upstream_health",
    "account_mfa",
})


def _bounded_configuration_int(
    environ,
    name,
    default,
    minimum,
    maximum,
):
    try:
        value = int(str(environ.get(name, default)).strip())
    except (TypeError, ValueError) as exc:
        raise StartupValidationError(f"{name} must be an integer.") from exc
    if value < minimum or value > maximum:
        raise StartupValidationError(
            f"{name} must be between {minimum} and {maximum}."
        )
    return value


def calculate_database_connection_budget(environ=None):
    """Return the declared cluster-wide PostgreSQL connection budget."""

    environ = os.environ if environ is None else environ
    instances = _bounded_configuration_int(
        environ, "APP_INSTANCE_COUNT", 1, 1, 1_000
    )
    workers = _bounded_configuration_int(
        environ, "UVICORN_WORKERS", 1, 1, 64
    )
    pool_max = _bounded_configuration_int(
        environ, "DATABASE_POOL_MAX_SIZE", 8, 1, 64
    )
    dedicated = _bounded_configuration_int(
        environ,
        "DATABASE_DEDICATED_CONNECTIONS_PER_WORKER",
        1,
        0,
        8,
    )
    reserved = _bounded_configuration_int(
        environ, "DATABASE_RESERVED_CONNECTIONS", 20, 5, 10_000
    )
    application = instances * workers * (pool_max + dedicated)
    return {
        "instances": instances,
        "workers": workers,
        "pool_max": pool_max,
        "dedicated_per_worker": dedicated,
        "application": application,
        "reserved": reserved,
        "total": application + reserved,
    }


def validate_database_connection_budget(
    max_connections,
    environ=None,
):
    budget = calculate_database_connection_budget(environ)
    try:
        server_max = int(max_connections)
    except (TypeError, ValueError) as exc:
        raise StartupValidationError(
            "Cannot read PostgreSQL max_connections."
        ) from exc
    if budget["total"] >= server_max:
        raise StartupValidationError(
            "Declared PostgreSQL connection budget is unsafe: "
            f"application={budget['application']}, "
            f"reserved={budget['reserved']}, max_connections={server_max}."
        )
    return budget


def validate_secret_separation(environ=None) -> None:
    """Reject credential reuse across independent production trust domains."""

    environ = os.environ if environ is None else environ
    secrets_by_name = {}
    database_url = str(environ.get("DATABASE_URL", "")).strip()
    if database_url:
        database_password = urlparse(database_url).password
        if database_password:
            secrets_by_name["DATABASE_URL password"] = database_password
    for name in (
        "SMTP_PASSWORD",
        "GOOGLE_CLIENT_SECRET",
        "AUDIT_CHECKPOINT_HMAC_KEY",
        "MFA_ENCRYPTION_KEY",
        "EMAIL_OUTBOX_ENCRYPTION_KEY",
    ):
        value = str(environ.get(name, "")).strip()
        if value:
            secrets_by_name[name] = value

    owners_by_value = {}
    for name, value in secrets_by_name.items():
        owners_by_value.setdefault(value, []).append(name)
    reused = [
        names
        for names in owners_by_value.values()
        if len(names) > 1
    ]
    if reused:
        raise StartupValidationError(
            "Production secrets must be independently rotatable; reused by: "
            + "; ".join(", ".join(names) for names in reused)
        )


def _runtime_role_snapshot(connection):
    role = connection.execute(
        """
        SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
               rolreplication, rolbypassrls
        FROM pg_roles
        WHERE rolname = current_user
        """
    ).fetchone()
    memberships = connection.execute(
        """
        SELECT parent.rolname
        FROM pg_auth_members AS memberships
        JOIN pg_roles AS parent ON parent.oid = memberships.roleid
        JOIN pg_roles AS member ON member.oid = memberships.member
        WHERE member.rolname = current_user
        ORDER BY parent.rolname
        """
    ).fetchall()
    privilege_row = connection.execute(
        """
        SELECT current_user,
               current_database(),
               current_schema(),
               current_schemas(false),
               has_database_privilege(current_user, current_database(), 'CREATE'),
               has_database_privilege(current_user, current_database(), 'TEMP'),
               has_schema_privilege(current_user, current_schema(), 'CREATE')
        """
    ).fetchone()
    owned_objects = connection.execute(
        """
        SELECT object_type, object_name
        FROM (
            SELECT 'database' AS object_type, datname AS object_name
            FROM pg_database
            WHERE datname = current_database()
              AND pg_has_role(current_user, datdba, 'MEMBER')
            UNION ALL
            SELECT 'schema', nspname
            FROM pg_namespace
            WHERE nspname = current_schema()
              AND pg_has_role(current_user, nspowner, 'MEMBER')
            UNION ALL
            SELECT CASE c.relkind
                       WHEN 'S' THEN 'sequence'
                       WHEN 'v' THEN 'view'
                       WHEN 'm' THEN 'materialized_view'
                       ELSE 'table'
                   END,
                   c.relname
            FROM pg_class AS c
            JOIN pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema()
              AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
              AND pg_has_role(current_user, c.relowner, 'MEMBER')
            UNION ALL
            SELECT 'function', p.oid::regprocedure::text
            FROM pg_proc AS p
            JOIN pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = current_schema()
              AND pg_has_role(current_user, p.proowner, 'MEMBER')
        ) AS owned
        ORDER BY object_type, object_name
        """
    ).fetchall()
    disallowed_grants = connection.execute(
        """
        SELECT table_schema, table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = current_user
          AND (
              table_schema <> current_schema()
              OR privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
          )
        ORDER BY table_schema, table_name, privilege_type
        """
    ).fetchall()
    missing_crud = connection.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
          AND (
              NOT has_table_privilege(current_user, quote_ident(table_schema) || '.' || quote_ident(table_name), 'SELECT')
              OR NOT has_table_privilege(current_user, quote_ident(table_schema) || '.' || quote_ident(table_name), 'INSERT')
              OR NOT has_table_privilege(current_user, quote_ident(table_schema) || '.' || quote_ident(table_name), 'UPDATE')
              OR NOT has_table_privilege(current_user, quote_ident(table_schema) || '.' || quote_ident(table_name), 'DELETE')
          )
        ORDER BY table_name
        """
    ).fetchall()
    return {
        "role": tuple(role) if role else None,
        "memberships": [row[0] for row in memberships],
        "identity": tuple(privilege_row) if privilege_row else None,
        "owned_objects": [tuple(row) for row in owned_objects],
        "disallowed_grants": [tuple(row) for row in disallowed_grants],
        "missing_crud": [row[0] for row in missing_crud],
    }


def validate_runtime_role_snapshot(snapshot, *, expected_role=""):
    """Reject a PostgreSQL runtime identity that can escape application CRUD."""
    role = snapshot.get("role")
    identity = snapshot.get("identity")
    if not role or not identity:
        raise StartupValidationError("Cannot inspect the PostgreSQL runtime role.")
    role_name, can_login, superuser, create_db, create_role, replication, bypass_rls = role
    if expected_role and role_name != expected_role:
        raise StartupValidationError(
            f"DATABASE_URL authenticates as {role_name!r}, not DATABASE_RUNTIME_ROLE."
        )
    if not can_login:
        raise StartupValidationError("PostgreSQL runtime role must be a LOGIN role.")
    elevated = [
        name
        for name, enabled in (
            ("SUPERUSER", superuser),
            ("CREATEDB", create_db),
            ("CREATEROLE", create_role),
            ("REPLICATION", replication),
            ("BYPASSRLS", bypass_rls),
        )
        if enabled
    ]
    if elevated:
        raise StartupValidationError(
            "PostgreSQL runtime role has forbidden attributes: " + ", ".join(elevated)
        )
    if snapshot.get("memberships"):
        raise StartupValidationError(
            "PostgreSQL runtime role must not inherit other roles: "
            + ", ".join(snapshot["memberships"])
        )
    _current_user, _database, current_schema, search_path, db_create, db_temp, schema_create = identity
    if current_schema != "public" or list(search_path or []) != ["public"]:
        raise StartupValidationError(
            "PostgreSQL runtime search_path must resolve only to the public schema."
        )
    if db_create or db_temp or schema_create:
        raise StartupValidationError(
            "PostgreSQL runtime role must not have database/schema CREATE or TEMP privileges."
        )
    if snapshot.get("owned_objects"):
        details = ", ".join(
            f"{kind}:{name}" for kind, name in snapshot["owned_objects"][:8]
        )
        raise StartupValidationError(
            "PostgreSQL runtime role owns DDL-capable objects: " + details
        )
    if snapshot.get("disallowed_grants"):
        raise StartupValidationError(
            "PostgreSQL runtime role has table grants outside the CRUD allow-list."
        )
    if snapshot.get("missing_crud"):
        raise StartupValidationError(
            "PostgreSQL runtime role lacks required CRUD grants on: "
            + ", ".join(snapshot["missing_crud"][:12])
        )


def verify_database_runtime_role(database, *, expected_role=""):
    connection = None
    try:
        connection = database.get_connection()
        snapshot = _runtime_role_snapshot(connection)
        validate_runtime_role_snapshot(snapshot, expected_role=expected_role)
        max_connections = connection.execute(
            "SHOW max_connections"
        ).fetchone()[0]
        validate_database_connection_budget(
            max_connections,
            os.environ,
        )
    finally:
        if connection is not None:
            connection.close()


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
        if str(environ.get("DATABASE_AUTO_MIGRATE", "")).strip().lower() not in {
            "false",
            "0",
            "no",
        }:
            raise StartupValidationError(
                "DATABASE_AUTO_MIGRATE=false is required in production."
            )
        if str(environ.get("DATABASE_PRIVATE_NETWORK_CONFIRMED", "")).strip().lower() != "true":
            raise StartupValidationError(
                "DATABASE_PRIVATE_NETWORK_CONFIRMED=true is required after restricting PostgreSQL to a private network."
            )
        forbidden_database_secrets = [
            name
            for name in (
                "DATABASE_ADMIN_URL",
                "MIGRATOR_DATABASE_URL",
                "DATABASE_MIGRATOR_PASSWORD",
                "DATABASE_ADMIN_PASSWORD",
                "BACKUP_DATABASE_URL",
                "DATABASE_BACKUP_PASSWORD",
                "BIDDING_RESTORE_DRILL_PRIVATE_KEY",
            )
            if str(environ.get(name, "")).strip()
        ]
        if forbidden_database_secrets:
            raise StartupValidationError(
                "Web workers must not receive migrator/admin database credentials: "
                + ", ".join(forbidden_database_secrets)
            )
        expected_role = str(environ.get("DATABASE_RUNTIME_ROLE", "")).strip()
        if expected_role and parsed.username != expected_role:
            raise StartupValidationError(
                "DATABASE_URL username must match DATABASE_RUNTIME_ROLE."
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
        validate_secret_separation(environ)
        smtp_errors = smtp_configuration_errors(environ, production=True)
        if smtp_errors:
            raise StartupValidationError(
                "Invalid production SMTP configuration: " + "; ".join(smtp_errors)
            )
        try:
            validate_mfa_configuration(environ, required=True)
        except MfaConfigurationError as exc:
            raise StartupValidationError(str(exc)) from exc
        try:
            validate_email_outbox_configuration(environ, required=True)
        except EmailOutboxConfigurationError as exc:
            raise StartupValidationError(str(exc)) from exc
        audit_hmac_key = str(environ.get("AUDIT_CHECKPOINT_HMAC_KEY", ""))
        if len(audit_hmac_key.encode("utf-8")) < 32:
            raise StartupValidationError(
                "AUDIT_CHECKPOINT_HMAC_KEY must contain at least 32 bytes in production."
            )
        restore_drill_public_key = str(
            environ.get("BIDDING_RESTORE_DRILL_PUBLIC_KEY", "")
        ).strip()
        try:
            restore_public_bytes = base64.urlsafe_b64decode(
                restore_drill_public_key.encode("ascii")
            )
            if len(restore_public_bytes) != 32:
                raise ValueError
            Ed25519PublicKey.from_public_bytes(restore_public_bytes)
        except (TypeError, ValueError) as exc:
            raise StartupValidationError(
                "BIDDING_RESTORE_DRILL_PUBLIC_KEY must be a base64 "
                "Ed25519 raw public key in production."
            ) from exc
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
