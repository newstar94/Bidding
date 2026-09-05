"""Generate scoped production database environment fragments from one secret.

The source file is deployment input only.  Applications consume the generated
per-service fragments and never load the aggregate secret.
"""
from __future__ import annotations

import argparse
import json
import os
import stat
import tempfile
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit


OUTPUT_FILES = {
    "web": "database-web.env",
    "migrator": "database-migrator.env",
    "backup": "database-backup.env",
    "documentWorker": "database-document-worker.env",
}
DEFAULT_ROLE_NAMES = {
    "migrator": "biddingflow_migrator",
    "backup": "biddingflow_backup",
    "documentWorker": "biddingflow_document_worker",
}


class ProductionDatabaseEnvironmentError(ValueError):
    pass


def _connection_url(base_url: str, credential: dict[str, str]) -> str:
    base = urlsplit(base_url)
    username = credential["username"]
    password = credential["password"]
    database = credential.get("database") or base.path.lstrip("/")
    host = base.hostname or ""
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = f":{base.port}" if base.port is not None else ""
    netloc = f"{quote(username, safe='')}:{quote(password, safe='')}@{host}{port}"
    return urlunsplit((base.scheme, netloc, "/" + quote(database, safe=""), base.query, ""))


def build_scoped_environments(payload: object) -> dict[str, dict[str, str]]:
    if not isinstance(payload, dict) or set(payload) != {"version", "databaseUrl", "roles"}:
        raise ProductionDatabaseEnvironmentError("Invalid production database secret")
    if payload["version"] != 1 or not isinstance(payload["roles"], dict):
        raise ProductionDatabaseEnvironmentError("Unsupported production database secret")
    base_url = payload["databaseUrl"]
    if not isinstance(base_url, str) or any(char.isspace() for char in base_url):
        raise ProductionDatabaseEnvironmentError("databaseUrl must be a PostgreSQL URL")
    base = urlsplit(base_url)
    try:
        _ = base.port
    except ValueError as exc:
        raise ProductionDatabaseEnvironmentError("databaseUrl must be a PostgreSQL URL") from exc
    if (
        base.scheme != "postgresql"
        or not base.hostname
        or not base.path.strip("/")
        or base.fragment
    ):
        raise ProductionDatabaseEnvironmentError("databaseUrl must be a PostgreSQL URL")
    if not base.username or base.password is None:
        raise ProductionDatabaseEnvironmentError("databaseUrl must contain the runtime credential")
    if "REPLACE_" in base_url.upper() or base.hostname.endswith(".example.internal"):
        raise ProductionDatabaseEnvironmentError("databaseUrl still contains a deployment placeholder")
    query = dict(part.split("=", 1) for part in base.query.split("&") if "=" in part)
    if query.get("sslmode", "").lower() != "verify-full":
        raise ProductionDatabaseEnvironmentError("Production database connections require sslmode=verify-full")

    roles = payload["roles"]
    expected = {"migrator", "backup", "documentWorker"}
    if set(roles) != expected:
        raise ProductionDatabaseEnvironmentError("Exactly three scoped service credentials are required")
    credentials: list[tuple[str, str]] = [(unquote(base.username), unquote(base.password))]
    normalized_roles: dict[str, dict[str, str]] = {}
    for name in sorted(expected):
        raw_credential = roles[name]
        credential = dict(raw_credential) if isinstance(raw_credential, dict) else raw_credential
        if not isinstance(credential, dict) or "password" not in credential:
            raise ProductionDatabaseEnvironmentError(f"Missing {name} credential")
        if set(credential) - {"username", "password", "database"}:
            raise ProductionDatabaseEnvironmentError(f"Unexpected {name} credential field")
        if any(not isinstance(value, str) or not value for value in credential.values()):
            raise ProductionDatabaseEnvironmentError(f"Invalid {name} credential")
        credential.setdefault("username", DEFAULT_ROLE_NAMES[name])
        if any("REPLACE_" in value.upper() for value in credential.values()):
            raise ProductionDatabaseEnvironmentError(f"{name} credential still contains a placeholder")
        if "database" in credential and any(char in credential["database"] for char in "/?#"):
            raise ProductionDatabaseEnvironmentError(f"Invalid {name} database")
        credentials.append((credential["username"], credential["password"]))
        normalized_roles[name] = credential
    if len({username for username, _ in credentials}) != len(credentials):
        raise ProductionDatabaseEnvironmentError("Production database roles must be distinct")
    if len({password for _, password in credentials}) != len(credentials):
        raise ProductionDatabaseEnvironmentError("Production database passwords must be distinct")

    return {
        "web": {
            "APP_ENV": "production",
            "DATABASE_RUNTIME_ROLE": unquote(base.username),
            "DATABASE_URL": base_url,
        },
        "migrator": {
            "APP_ENV": "production",
            "MIGRATOR_DATABASE_URL": _connection_url(base_url, normalized_roles["migrator"]),
        },
        "backup": {
            "APP_ENV": "production",
            "BACKUP_DATABASE_URL": _connection_url(base_url, normalized_roles["backup"]),
        },
        "documentWorker": {
            "APP_ENV": "production",
            "DATABASE_DOCUMENT_WORKER_ROLE": normalized_roles["documentWorker"]["username"],
            "DOCUMENT_WORKER_DATABASE_URL": _connection_url(base_url, normalized_roles["documentWorker"]),
        },
    }


def _read_source(path: Path) -> object:
    if path.is_symlink() or not path.is_file():
        raise ProductionDatabaseEnvironmentError("Source must be a regular non-symlink file")
    if os.name != "nt" and stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ProductionDatabaseEnvironmentError("Source must have mode 0600")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ProductionDatabaseEnvironmentError("Cannot read production database secret") from None


def _write_private(path: Path, values: dict[str, str], replace: bool) -> None:
    if path.exists() and not replace:
        raise ProductionDatabaseEnvironmentError(f"Refusing to replace existing output: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".database-env-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            descriptor = -1
            handle.write("# Generated by prepare_production_database_env.py; do not edit.\n")
            for key, value in values.items():
                if any(char.isspace() for char in value) or "\x00" in value or "'" in value:
                    raise ProductionDatabaseEnvironmentError("Unsafe generated environment value")
                # Single quoting is accepted by systemd EnvironmentFile and
                # lets the same fragment be sourced by the POSIX deploy shell.
                handle.write(f"{key}='{value}'\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            os.chmod(path, 0o600)
    finally:
        if descriptor != -1:
            os.close(descriptor)
        if temporary.exists():
            temporary.unlink()


def prepare(source: Path, output_dir: Path, *, replace: bool = False) -> list[Path]:
    environments = build_scoped_environments(_read_source(source))
    paths = [output_dir / OUTPUT_FILES[scope] for scope in OUTPUT_FILES]
    existing = [path.name for path in paths if path.exists()]
    if existing and not replace:
        raise ProductionDatabaseEnvironmentError(
            "Refusing to replace existing outputs: " + ", ".join(existing)
        )
    for scope, filename in OUTPUT_FILES.items():
        _write_private(output_dir / filename, environments[scope], replace=True)
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args(argv)
    try:
        paths = prepare(args.source, args.output_dir, replace=args.replace)
    except ProductionDatabaseEnvironmentError as exc:
        parser.error(str(exc))
    print(f"Prepared {len(paths)} scoped production database environment files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
