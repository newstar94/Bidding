"""Create a disposable local PostgreSQL cluster for development and tests.

The script never prints credentials.  It reads ``ADMIN_PASSWORD`` from the
ignored project ``.env`` file and writes a local ``DATABASE_URL`` back to that
same file.  The downloaded PostgreSQL binary distribution and database cluster
live under ``data/`` and are ignored by Git.
"""

from __future__ import annotations

import os
import argparse
import secrets
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
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
    password = values.get("ADMIN_PASSWORD", "")
    if not password:
        raise SystemExit("ADMIN_PASSWORD must be set in .env")

    bin_dir = PG_ROOT / "bin"
    initdb = bin_dir / "initdb.exe"
    if not initdb.exists():
        raise SystemExit(f"PostgreSQL binaries are missing: {initdb}")

    DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
    if not (DATA_DIR / "PG_VERSION").exists():
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
        _run(
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

    database_url = (
        f"postgresql://postgres:{quote(password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    _replace_env_value(lines, "DATABASE_URL", database_url)
    _replace_env_value(lines, "DATABASE_ADMIN_URL", database_url)
    runtime_password = values.get("DATABASE_RUNTIME_PASSWORD") or secrets.token_urlsafe(32)
    migrator_password = values.get("DATABASE_MIGRATOR_PASSWORD") or secrets.token_urlsafe(32)
    _replace_env_value(lines, "DATABASE_RUNTIME_ROLE", "biddingflow_app")
    _replace_env_value(lines, "DATABASE_MIGRATOR_ROLE", "biddingflow_migrator")
    _replace_env_value(lines, "DATABASE_RUNTIME_PASSWORD", runtime_password)
    _replace_env_value(lines, "DATABASE_MIGRATOR_PASSWORD", migrator_password)
    runtime_url = (
        f"postgresql://biddingflow_app:{quote(runtime_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    migrator_url = (
        f"postgresql://biddingflow_migrator:{quote(migrator_password, safe='')}@127.0.0.1:"
        f"{PORT}/{DATABASE}?sslmode=disable"
    )
    _replace_env_value(lines, "RUNTIME_DATABASE_URL", runtime_url)
    _replace_env_value(lines, "MIGRATOR_DATABASE_URL", migrator_url)
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
    if len(values.get("BIDDING_RESTORE_DRILL_HMAC_KEY", "").encode("utf-8")) < 32:
        _replace_env_value(
            lines,
            "BIDDING_RESTORE_DRILL_HMAC_KEY",
            secrets.token_urlsafe(48),
        )
    print("Updating ignored .env configuration...", flush=True)
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"PostgreSQL is ready on 127.0.0.1:{PORT}/{DATABASE}.")


if __name__ == "__main__":
    main()
