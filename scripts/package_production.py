"""Build a minimal, reproducible production archive from an explicit allowlist."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import psycopg


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "release" / "biddingflow-production.zip"

RUNTIME_DIRECTORIES = {
    "backend": lambda path: path.suffix == ".py",
    "dist": lambda path: path.is_file(),
    "views": lambda path: path.is_file(),
    "deploy": lambda path: path.is_file(),
    "docs": lambda path: path.suffix == ".md",
}

RUNTIME_FILES = (
    ".env.example",
    ".python-version",
    "README.md",
    "holidays.json",
    "pyproject.toml",
    "requirements.txt",
    "scripts/backup.py",
    "scripts/configure_database_roles.py",
    "scripts/manage_database.py",
    "scripts/run_document_worker.py",
    "scripts/benchmark_password_hash.py",
    "scripts/verify_document_sandbox.py",
)

FORBIDDEN_PARTS = {
    ".agents",
    ".git",
    ".github",
    "__pycache__",
    "frontend",
    "node_modules",
    "playwright-report",
    "test-results",
    "tests",
}
FORBIDDEN_NAMES = {".env", "bidding.db", "bidding.db-shm", "bidding.db-wal"}
FORBIDDEN_SUFFIXES = {".bak", ".db", ".log", ".map", ".pyc", ".tmp"}
REPRODUCIBLE_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
HASHED_ASSET_PATH = re.compile(
    r"^assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$"
)


def _load_env() -> None:
    path = PROJECT_ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _relative(path: Path) -> Path:
    resolved = path.resolve()
    try:
        return resolved.relative_to(PROJECT_ROOT)
    except ValueError as error:
        raise RuntimeError(f"Refusing file outside project: {resolved}") from error


def _assert_safe(relative_path: Path) -> None:
    if FORBIDDEN_PARTS.intersection(relative_path.parts):
        raise RuntimeError(f"Forbidden production path: {relative_path.as_posix()}")
    if relative_path.name in FORBIDDEN_NAMES or relative_path.suffix.lower() in FORBIDDEN_SUFFIXES:
        raise RuntimeError(f"Forbidden production file: {relative_path.as_posix()}")


def _validate_frontend_artifacts(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not manifest:
        raise RuntimeError("Vite manifest is empty or invalid.")
    referenced: set[str] = set()
    for entry in manifest.values():
        if not isinstance(entry, dict):
            raise RuntimeError("Vite manifest contains an invalid entry.")
        values = [entry.get("file")]
        values.extend(entry.get("css") or [])
        values.extend(entry.get("assets") or [])
        for value in values:
            if value is None:
                continue
            asset_path = str(value).replace("\\", "/")
            if not HASHED_ASSET_PATH.fullmatch(asset_path):
                raise RuntimeError(
                    f"Production asset is not content-hashed: {asset_path}"
                )
            candidate = (PROJECT_ROOT / "dist" / asset_path).resolve()
            dist_root = (PROJECT_ROOT / "dist").resolve()
            if dist_root not in candidate.parents or not candidate.is_file():
                raise RuntimeError(
                    f"Vite manifest references a missing/unsafe asset: {asset_path}"
                )
            if candidate.suffix.lower() in {".js", ".css"} and b"sourceMappingURL=" in candidate.read_bytes():
                raise RuntimeError(
                    f"Production asset exposes source-map metadata: {asset_path}"
                )
            referenced.add(asset_path)

    actual = {
        path.relative_to(PROJECT_ROOT / "dist").as_posix()
        for path in (PROJECT_ROOT / "dist" / "assets").rglob("*")
        if path.is_file()
    }
    if referenced != actual:
        missing = sorted(actual - referenced)
        stale = sorted(referenced - actual)
        raise RuntimeError(
            "Vite asset set does not match its manifest "
            f"(unreferenced={missing[:5]}, missing={stale[:5]})."
        )


def collect_runtime_files() -> list[tuple[Path, Path]]:
    selected: dict[str, tuple[Path, Path]] = {}
    for directory_name, predicate in RUNTIME_DIRECTORIES.items():
        directory = PROJECT_ROOT / directory_name
        if not directory.is_dir():
            raise RuntimeError(f"Required production directory is missing: {directory_name}")
        for source in directory.rglob("*"):
            if not source.is_file() or not predicate(source):
                continue
            relative_path = _relative(source)
            _assert_safe(relative_path)
            selected[relative_path.as_posix()] = (source, relative_path)

    for relative_name in RUNTIME_FILES:
        source = PROJECT_ROOT / relative_name
        if not source.is_file():
            raise RuntimeError(f"Required production file is missing: {relative_name}")
        relative_path = _relative(source)
        _assert_safe(relative_path)
        selected[relative_path.as_posix()] = (source, relative_path)

    manifest_path = PROJECT_ROOT / "dist" / ".vite" / "manifest.json"
    if manifest_path.as_posix() not in {source.as_posix() for source, _ in selected.values()}:
        raise RuntimeError("Vite manifest is missing from the production selection.")
    _validate_frontend_artifacts(manifest_path)
    secure_build_path = PROJECT_ROOT / "dist" / "secure-build.json"
    if not secure_build_path.is_file():
        raise RuntimeError(
            "Secure frontend marker is missing. Run `npm run build:secure` before packaging."
        )
    secure_build = json.loads(secure_build_path.read_text(encoding="utf-8"))
    if int(secure_build.get("version", 0)) < 2 or not isinstance(
        secure_build.get("deadCodeInjection"), bool
    ):
        raise RuntimeError("Secure frontend marker is invalid or unsupported.")
    return [selected[key] for key in sorted(selected)]


def _zip_info(relative_path: Path) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(relative_path.as_posix(), REPRODUCIBLE_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    return info


def build_archive(output: Path) -> tuple[int, int]:
    files = collect_runtime_files()
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    manifest_files = []
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, relative_path in files:
            content = source.read_bytes()
            archive.writestr(_zip_info(relative_path), content)
            manifest_files.append({
                "path": relative_path.as_posix(),
                "sha256": hashlib.sha256(content).hexdigest(),
                "size": len(content),
            })

        manifest = json.dumps(
            {"formatVersion": 1, "files": manifest_files},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode("utf-8") + b"\n"
        archive.writestr(_zip_info(Path("PRODUCTION_MANIFEST.json")), manifest)

    return len(files), output.stat().st_size


def smoke_test_archive(archive_path: Path, extraction_root: Path) -> None:
    """Boot the application from extracted bytes, not from the source tree."""
    extraction_root = extraction_root.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if len(members) > 20_000:
            raise RuntimeError("Production archive contains too many entries.")
        declared_total = sum(max(0, item.file_size) for item in members)
        if declared_total > 1024 * 1024 * 1024:
            raise RuntimeError("Production archive expands beyond 1 GiB.")
        for member in members:
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise RuntimeError(
                    f"Production archive contains a symlink: {member.filename}"
                )
            destination = (extraction_root / member.filename).resolve()
            if destination != extraction_root and extraction_root not in destination.parents:
                raise RuntimeError(
                    f"Production archive path escapes extraction root: {member.filename}"
                )
            if member.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            copied = 0
            with archive.open(member) as source, destination.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > member.file_size:
                        raise RuntimeError(
                            f"Archive entry exceeds declared size: {member.filename}"
                        )
                    target.write(chunk)
            if copied != member.file_size:
                raise RuntimeError(
                    f"Archive entry size mismatch: {member.filename}"
                )
    database_url = (
        os.environ.get("PACKAGE_SMOKE_DATABASE_URL")
        or os.environ.get("API_TEST_DATABASE_URL")
        or ""
    ).strip()
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgresql", "postgres"} or not any(
        marker in parsed.path.casefold() for marker in ("test", "smoke")
    ):
        raise RuntimeError(
            "PACKAGE_SMOKE_DATABASE_URL must reference an isolated PostgreSQL test database."
        )
    with psycopg.connect(database_url, autocommit=True) as connection:
        connection.execute("DROP SCHEMA IF EXISTS public CASCADE")
        connection.execute("CREATE SCHEMA public")
    environment = os.environ.copy()
    environment.update({
        "APP_ENV": "test",
        "APP_DEBUG": "False",
        "ADMIN_PASSWORD": "Production-smoke-only-123!",  # pragma: allowlist secret
        "DATABASE_URL": database_url,
        "DATABASE_AUTO_MIGRATE": "true",
        "APP_SECURE_COOKIES": "False",
        "AUDIT_CHECKPOINT_DIR": "",
        "PYTHONPATH": str(extraction_root.resolve()),
    })
    smoke_code = """
from starlette.testclient import TestClient
from backend.app import app
with TestClient(app) as client:
    home = client.get('/')
    holidays = client.get('/api/holidays')
    session = client.post('/api/auth/check-session', json={'remember': False})
assert home.status_code == 200 and 'BiddingFlow' in home.text
assert holidays.status_code == 200 and isinstance(holidays.json(), dict)
assert session.status_code == 200 and session.json().get('valid') is False
"""
    result = subprocess.run(
        [sys.executable, "-c", smoke_code],
        cwd=extraction_root,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Extracted production smoke test failed:\n{result.stdout}\n{result.stderr}")


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Build and validate a temporary archive without keeping an artifact.",
    )
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="biddingflow-package-check-") as directory:
            output = Path(directory) / "biddingflow-production.zip"
            file_count, archive_size = build_archive(output)
            with zipfile.ZipFile(output) as archive:
                manifest = json.loads(archive.read("PRODUCTION_MANIFEST.json"))
                if len(manifest.get("files", [])) != file_count:
                    raise RuntimeError("Production manifest file count does not match archive selection.")
            smoke_test_archive(output, Path(directory) / "extracted")
            print(
                f"Production package and extracted-runtime smoke check passed ({file_count} runtime files, "
                f"{archive_size} bytes)."
            )
            return 0
    file_count, archive_size = build_archive(args.output)
    print(
        f"Production archive created: {args.output.resolve()} "
        f"({file_count} runtime files, {archive_size} bytes)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
