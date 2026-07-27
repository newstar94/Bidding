"""Create a disposable local PostgreSQL cluster for development and tests.

The script never prints credentials.  It reads ``ADMIN_PASSWORD`` from the
ignored project ``.env`` file and writes a local ``DATABASE_URL`` back to that
same file.  The downloaded PostgreSQL binary distribution and database cluster
live under ``data/`` and are ignored by Git.
"""

from __future__ import annotations

import os
import argparse
import base64
import secrets
import sys
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import quote, urlparse
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
ENV_FILE = ROOT / ".env"
PG_ROOT = ROOT / "data" / "tools" / "postgresql17" / "pgsql"
DATA_DIR = ROOT / "data" / "postgresql17-data"
PORT = 55432
DATABASE = "biddingflow_dev"
TEST_DATABASE = "biddingflow_test"
API_TEST_DATABASE = "biddingflow_api_test"
RESTORE_DRILL_DATABASE = "biddingflow_restore_drill"
MULTIWORKER_TEST_DATABASE = "biddingflow_multiworker_test"
LOAD_TEST_DATABASE = "biddingflow_load_test"
VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh"
LOCAL_DATABASES = (
    DATABASE,
    TEST_DATABASE,
    API_TEST_DATABASE,
    RESTORE_DRILL_DATABASE,
    MULTIWORKER_TEST_DATABASE,
    LOAD_TEST_DATABASE,
)


def _read_env() -> tuple[list[str], dict[str, str]]:
    lines = ENV_FILE.read_text(encoding="utf-8-sig").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return lines, values


def _run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )


def _run_pg_ctl(*args: str) -> None:
    """Run pg_ctl without captured pipes inherited by the detached postmaster."""

    subprocess.run(
        args,
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=60,
    )


def _replace_env_value(lines: list[str], key: str, value: str) -> None:
    replacement = f"{key}={value}"
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = replacement
            return
    lines.append(replacement)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reset",
        action="store_true",
        help="drop and recreate the disposable development database",
    )
    args = parser.parse_args()
    print("Reading local environment...", flush=True)
    lines, values = _read_env()
    cluster_exists = (DATA_DIR / "PG_VERSION").exists()
    configured_postgres_password = values.get(
        "POSTGRES_LOCAL_ADMIN_PASSWORD", ""
    )
    legacy_admin_url = values.get("DATABASE_ADMIN_URL", "")
    legacy_url_password = (
        urlparse(legacy_admin_url).password
        if legacy_admin_url
        else ""
    )
    password = (
        configured_postgres_password
        or legacy_url_password
        or values.get("ADMIN_PASSWORD", "")
    )
    if not password:
        if cluster_exists:
            raise SystemExit(
                "POSTGRES_LOCAL_ADMIN_PASSWORD or a valid DATABASE_ADMIN_URL must be set in .env"
            )
        password = secrets.token_urlsafe(32)

    bin_dir = PG_ROOT / "bin"
    initdb = bin_dir / "initdb.exe"
    if not initdb.exists():
        raise SystemExit(f"PostgreSQL binaries are missing: {initdb}")

    DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
    if not cluster_exists:
        print("Initializing PostgreSQL cluster...", flush=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=DATA_DIR.parent, delete=False
        ) as password_file:
            password_file.write(password)
            password_path = Path(password_file.name)
        try:
            _run(
                str(initdb),
                "-D",
                str(DATA_DIR),
                "-U",
                "postgres",
                "--encoding=UTF8",
                "--locale=C",
                "--auth-host=scram-sha-256",
                "--auth-local=scram-sha-256",
                f"--pwfile={password_path}",
            )
        finally:
            password_path.unlink(missing_ok=True)

    status = subprocess.run(
        [str(bin_dir / "pg_ctl.exe"), "-D", str(DATA_DIR), "status"],
        capture_output=True,
    )
    if status.returncode != 0:
        print("Starting PostgreSQL...", flush=True)
        _run_pg_ctl(
            str(bin_dir / "pg_ctl.exe"),
            "-D",
            str(DATA_DIR),
            "-l",
            str(DATA_DIR / "postgres.log"),
            "-o",
            f"-p {PORT} -h 127.0.0.1",
            "start",
        )

    child_env = os.environ.copy()
    child_env["PGPASSWORD"] = password
    settings_psql = (
        str(bin_dir / "psql.exe"),
        "-h",
        "127.0.0.1",
        "-p",
        str(PORT),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
    )
    preloaded = _run(
        *settings_psql,
        "-tAc",
        "SHOW shared_preload_libraries",
        env=child_env,
    ).stdout.strip()
    _run(
        *settings_psql,
        "-c",
        "ALTER SYSTEM SET track_io_timing = 'on'",
        env=child_env,
    )
    _run(
        *settings_psql,
        "-c",
        "ALTER SYSTEM SET track_wal_io_timing = 'on'",
        env=child_env,
    )
    if "pg_stat_statements" not in {
        item.strip() for item in preloaded.split(",") if item.strip()
    }:
        print("Enabling local PostgreSQL performance diagnostics...", flush=True)
        _run(
            *settings_psql,
            "-c",
            "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'",
            env=child_env,
        )
        _run_pg_ctl(
            str(bin_dir / "pg_ctl.exe"),
            "-D",
            str(DATA_DIR),
            "-m",
            "fast",
            "-o",
            f"-p {PORT} -h 127.0.0.1",
            "restart",
        )
    else:
        _run(*settings_psql, "-c", "SELECT pg_reload_conf()", env=child_env)
    if args.reset:
        print("Resetting development database...", flush=True)
        common_psql = (
            str(bin_dir / "psql.exe"),
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
        )
        _run(
            *common_psql,
            "-c",
            (
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname IN ("
                + ", ".join(f"'{name}'" for name in LOCAL_DATABASES)
                + ") "
                "AND pid <> pg_backend_pid()"
            ),
            env=child_env,
        )
        for database_name in LOCAL_DATABASES:
            _run(
                *common_psql,
                "-c",
                f'DROP DATABASE IF EXISTS "{database_name}"',
                env=child_env,
            )
    print("Checking development database...", flush=True)
    for database_name in LOCAL_DATABASES:
        exists = _run(
            str(bin_dir / "psql.exe"),
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-tAc",
            f"SELECT 1 FROM pg_database WHERE datname='{database_name}'",
            env=child_env,
        ).stdout.strip()
        if exists != "1":
            print(f"Creating {database_name}...", flush=True)
            _run(
                str(bin_dir / "createdb.exe"),
                "-h",
                "127.0.0.1",
                "-p",
                str(PORT),
                "-U",
                "postgres",
                "-E",
                "UTF8",
                database_name,
                env=child_env,
            )
        _run(
            str(bin_dir / "psql.exe"),
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            f'ALTER DATABASE "{database_name}" SET timezone TO \'{VIETNAM_TIMEZONE}\'',
            env=child_env,
        )
        _run(
            str(bin_dir / "psql.exe"),
            "-h",
            "127.0.0.1",
            "-p",
            str(PORT),
            "-U",
            "postgres",
            "-d",
            database_name,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "CREATE EXTENSION IF NOT EXISTS pg_stat_statements",
            env=child_env,
        )

    database_url = (
        f"postgresql://postgres:{quote(password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    _replace_env_value(lines, "DATABASE_URL", database_url)
    _replace_env_value(lines, "DATABASE_ADMIN_URL", database_url)
    _replace_env_value(lines, "POSTGRES_LOCAL_ADMIN_PASSWORD", password)
    runtime_password = values.get("DATABASE_RUNTIME_PASSWORD") or secrets.token_urlsafe(32)
    migrator_password = values.get("DATABASE_MIGRATOR_PASSWORD") or secrets.token_urlsafe(32)
    backup_password = values.get("DATABASE_BACKUP_PASSWORD") or secrets.token_urlsafe(32)
    document_worker_password = (
        values.get("DATABASE_DOCUMENT_WORKER_PASSWORD")
        or secrets.token_urlsafe(32)
    )
    _replace_env_value(lines, "DATABASE_RUNTIME_ROLE", "biddingflow_app")
    _replace_env_value(lines, "DATABASE_MIGRATOR_ROLE", "biddingflow_migrator")
    _replace_env_value(lines, "DATABASE_BACKUP_ROLE", "biddingflow_backup")
    _replace_env_value(
        lines,
        "DATABASE_DOCUMENT_WORKER_ROLE",
        "biddingflow_document_worker",
    )
    _replace_env_value(lines, "DATABASE_RUNTIME_PASSWORD", runtime_password)
    _replace_env_value(lines, "DATABASE_MIGRATOR_PASSWORD", migrator_password)
    _replace_env_value(lines, "DATABASE_BACKUP_PASSWORD", backup_password)
    _replace_env_value(
        lines,
        "DATABASE_DOCUMENT_WORKER_PASSWORD",
        document_worker_password,
    )
    runtime_url = (
        f"postgresql://biddingflow_app:{quote(runtime_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    migrator_url = (
        f"postgresql://biddingflow_migrator:{quote(migrator_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    backup_url = (
        f"postgresql://biddingflow_backup:{quote(backup_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    document_worker_url = (
        "postgresql://biddingflow_document_worker:"
        f"{quote(document_worker_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    _replace_env_value(lines, "RUNTIME_DATABASE_URL", runtime_url)
    _replace_env_value(lines, "MIGRATOR_DATABASE_URL", migrator_url)
    _replace_env_value(lines, "BACKUP_DATABASE_URL", backup_url)
    _replace_env_value(
        lines,
        "DOCUMENT_WORKER_DATABASE_URL",
        document_worker_url,
    )
    test_database_url = database_url.replace(f"/{DATABASE}?", f"/{TEST_DATABASE}?")
    _replace_env_value(lines, "TEST_DATABASE_URL", test_database_url)
    api_test_database_url = database_url.replace(
        f"/{DATABASE}?", f"/{API_TEST_DATABASE}?"
    )
    _replace_env_value(lines, "API_TEST_DATABASE_URL", api_test_database_url)
    restore_drill_url = database_url.replace(
        f"/{DATABASE}?", f"/{RESTORE_DRILL_DATABASE}?"
    )
    _replace_env_value(lines, "RESTORE_DRILL_DATABASE_URL", restore_drill_url)
    multiworker_test_url = database_url.replace(
        f"/{DATABASE}?", f"/{MULTIWORKER_TEST_DATABASE}?"
    )
    _replace_env_value(
        lines, "MULTIWORKER_TEST_DATABASE_URL", multiworker_test_url
    )
    load_test_url = database_url.replace(
        f"/{DATABASE}?", f"/{LOAD_TEST_DATABASE}?"
    )
    _replace_env_value(lines, "LOAD_TEST_DATABASE_URL", load_test_url)
    _replace_env_value(lines, "PERFORMANCE_DATABASE_URL", load_test_url)
    if args.reset:
        from backend.auth.password_policy import validate_new_password

        admin_password = values.get("ADMIN_PASSWORD", "")
        password_valid, _password_error = validate_new_password(admin_password)
        if not password_valid:
            generated_admin_password = secrets.token_urlsafe(32) + "Aa1!"
            _replace_env_value(
                lines,
                "ADMIN_PASSWORD",
                generated_admin_password,
            )
            values["ADMIN_PASSWORD"] = generated_admin_password
            print(
                "Rotated invalid bootstrap ADMIN_PASSWORD in the ignored .env file.",
                flush=True,
            )
    if (
        not values.get("BIDDING_RESTORE_DRILL_PRIVATE_KEY", "")
        or not values.get("BIDDING_RESTORE_DRILL_PUBLIC_KEY", "")
    ):
        restore_private_key = Ed25519PrivateKey.generate()
        restore_public_key = restore_private_key.public_key()
        _replace_env_value(
            lines,
            "BIDDING_RESTORE_DRILL_PRIVATE_KEY",
            base64.urlsafe_b64encode(
                restore_private_key.private_bytes(
                    serialization.Encoding.Raw,
                    serialization.PrivateFormat.Raw,
                    serialization.NoEncryption(),
                )
            ).decode("ascii"),
        )
        _replace_env_value(
            lines,
            "BIDDING_RESTORE_DRILL_PUBLIC_KEY",
            base64.urlsafe_b64encode(
                restore_public_key.public_bytes(
                    serialization.Encoding.Raw,
                    serialization.PublicFormat.Raw,
                )
            ).decode("ascii"),
        )
    if not values.get("EMAIL_OUTBOX_ENCRYPTION_KEY", ""):
        _replace_env_value(
            lines,
            "EMAIL_OUTBOX_ENCRYPTION_KEY",
            Fernet.generate_key().decode("ascii"),
        )
    print("Updating ignored .env configuration...", flush=True)
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Bootstrap least-privilege roles before schema creation, initialize with
    # the migrator identity, then reapply ownership/default grants. This makes
    # one fresh-install command sufficient even when the cluster has never
    # contained application roles or tables.
    print("Configuring database roles...", flush=True)
    _run(
        sys.executable,
        str(ROOT / "scripts" / "configure_database_roles.py"),
    )
    print("Initializing application schema...", flush=True)
    _run(
        sys.executable,
        str(ROOT / "scripts" / "manage_database.py"),
    )
    _run(
        sys.executable,
        str(ROOT / "scripts" / "configure_database_roles.py"),
    )
    print(f"PostgreSQL is ready on 127.0.0.1:{PORT}/{DATABASE}.")


if __name__ == "__main__":
    main()
