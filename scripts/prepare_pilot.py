"""Prepare the Windows pilot before the web process starts.

``KHOI_DONG_PILOT.bat`` runs this once so that a single double-click is
enough: start the repository-managed PostgreSQL cluster, rebuild the secure
frontend bundle when its sources changed, and apply schema migrations with the
migrator credential (the runtime role has no DDL rights). Each step is
idempotent and is skipped when there is nothing to do.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.env_utils import load_env  # noqa: E402


MARKER = ROOT / "dist" / "secure-build.json"


class PilotPreparationError(RuntimeError):
    """A preparation step failed; the message is shown to the operator."""


def _step(message):
    print(f"  - {message}", flush=True)


def _run(command, *, failure):
    completed = subprocess.run(command, cwd=ROOT, check=False)
    if completed.returncode != 0:
        raise PilotPreparationError(f"{failure} (mã lỗi {completed.returncode}).")


def ensure_database_running(*, timeout_seconds=90):
    from scripts.setup_local_postgres import ensure_local_postgres_running

    import psycopg

    try:
        started = ensure_local_postgres_running()
    except RuntimeError as exc:
        raise PilotPreparationError(f"Không khởi động được PostgreSQL: {exc}") from exc
    _step("Đã khởi động PostgreSQL." if started else "PostgreSQL đang chạy.")
    database_url = os.environ.get("DATABASE_URL", "")
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            with psycopg.connect(database_url, connect_timeout=3):
                return
        except psycopg.OperationalError as exc:
            # A freshly started cluster answers "starting up" during recovery.
            if time.monotonic() >= deadline:
                raise PilotPreparationError(
                    "PostgreSQL chưa nhận kết nối sau khi khởi động: "
                    + str(exc).splitlines()[0]
                ) from exc
            time.sleep(1)


def _built_release_id():
    try:
        return str(json.loads(MARKER.read_text(encoding="utf-8")).get("releaseId") or "")
    except (OSError, ValueError):
        return ""


def _source_release_id(node):
    completed = subprocess.run(
        [
            node,
            "--input-type=module",
            "-e",
            "import { localSecureReleaseId } from './scripts/secure_release_id.mjs';"
            " console.log(localSecureReleaseId());",
        ],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise PilotPreparationError("Không tính được phiên bản mã nguồn giao diện.")
    return completed.stdout.strip()


def ensure_frontend_built():
    node = shutil.which("node")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not node or not npm:
        raise PilotPreparationError("Không tìm thấy Node.js/npm để build giao diện.")
    if os.environ.get("APP_RELEASE_ID"):
        # An explicit release ID pins the bundle; never rebuild over it.
        _step("Dùng bản build giao diện có APP_RELEASE_ID cố định.")
        return
    expected = _source_release_id(node)
    if expected and expected == _built_release_id():
        _step("Giao diện đã được build từ mã nguồn hiện tại.")
        return
    _step("Mã nguồn giao diện đã thay đổi, đang build lại (có thể mất vài phút)...")
    _run([npm, "run", "build:secure"], failure="Build giao diện thất bại")
    if _built_release_id() != expected:
        raise PilotPreparationError("Bản build giao diện không khớp mã nguồn hiện tại.")
    _step("Đã build lại giao diện.")


def ensure_schema_current():
    _step("Kiểm tra và áp dụng migration database...")
    _run(
        [sys.executable, str(ROOT / "scripts" / "manage_database.py")],
        failure="Migration database thất bại",
    )


def main():
    load_env(ROOT)
    steps = (
        ("Database", ensure_database_running),
        ("Giao diện", ensure_frontend_built),
        ("Schema", ensure_schema_current),
    )
    try:
        for label, step in steps:
            print(f"[{label}]", flush=True)
            step()
    except PilotPreparationError as exc:
        print(f"LỖI: {exc}", file=sys.stderr, flush=True)
        return 1
    print("Chuẩn bị pilot hoàn tất.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
