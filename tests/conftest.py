"""Global test isolation for application-level tests.

The application creates and migrates its configured SQLite database during
startup.  Tests must never point that lifecycle at the developer's working DB.
"""

import os
import tempfile
from pathlib import Path


_TEST_DATA_DIR = tempfile.TemporaryDirectory(prefix="bidding-tests-")
_TEST_RUNTIME_ROOT = Path(_TEST_DATA_DIR.name).resolve()
_TEST_DATABASE_PATH = (_TEST_RUNTIME_ROOT / "bidding-test.db").resolve()
if not _TEST_DATABASE_PATH.is_absolute() or _TEST_DATABASE_PATH.parent != _TEST_RUNTIME_ROOT:
    raise RuntimeError("Test database isolation guard rejected the runtime path.")

# Set every writable runtime path before backend.app reads the developer's
# optional .env file.  An empty audit checkpoint path is intentional: several
# tests create independent databases, so a checkpoint from one database must
# never be used to validate another database in the same pytest session.
_TEST_RUNTIME_PATHS = {
    "BIDDING_DATA_DIR": _TEST_RUNTIME_ROOT / "data",
    "BIDDING_BACKUP_DIR": _TEST_RUNTIME_ROOT / "backups",
    "BIDDING_LOG_DIR": _TEST_RUNTIME_ROOT / "logs",
    "BIDDING_TEMPLATE_DATA_DIR": _TEST_RUNTIME_ROOT / "templates",
    "BIDDING_UPLOAD_DIR": _TEST_RUNTIME_ROOT / "templates" / "images",
    "BIDDING_WORD_TEMPLATE_DIR": _TEST_RUNTIME_ROOT / "templates" / "words",
    "DOCUMENT_WORKER_TEMP_DIR": _TEST_RUNTIME_ROOT / "document-jobs",
    "BIDDING_RESTORE_DRILL_STATE_FILE": _TEST_RUNTIME_ROOT / "restore-drill.json",
}
for _variable, _path in _TEST_RUNTIME_PATHS.items():
    _resolved_path = _path.resolve()
    if _TEST_RUNTIME_ROOT not in _resolved_path.parents:
        raise RuntimeError(f"Test runtime isolation rejected {_variable}.")
    os.environ[_variable] = str(_resolved_path)

os.environ["BIDDING_DB_PATH"] = str(_TEST_DATABASE_PATH)
os.environ["AUDIT_CHECKPOINT_DIR"] = ""
os.environ["AUDIT_CHECKPOINT_HMAC_KEY"] = ""
os.environ["AUDIT_CHECKPOINT_OFFHOST_CONFIRMED"] = "false"
os.environ["APP_ENV"] = "test"
os.environ.setdefault("ADMIN_PASSWORD", "Test-only-admin-password-2026!")
os.environ.setdefault("ADMIN_EMAIL", "admin-test@localhost")
os.environ.setdefault("DEFAULT_ORG_NAME", "Test Organization")
