"""Startup validation and readiness checks.

These checks deliberately live outside ``backend.app`` so they can be tested
without starting the ASGI server or touching the configured application DB.
"""

import os


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
    admin_password = str(environ.get("ADMIN_PASSWORD", ""))
    if database_requires_admin_bootstrap(database) and not admin_password.strip():
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

        bootstrap_admin = conn.execute(
            """
            SELECT 1
            FROM tai_khoan AS users
            INNER JOIN thanh_vien_to_chuc AS memberships
                ON memberships.user_id = users.id
            INNER JOIN to_chuc AS organizations
                ON organizations.id = memberships.to_chuc_id
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
