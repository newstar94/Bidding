"""Global test isolation for application-level tests.

The application creates and migrates its configured SQLite database during
startup.  Tests must never point that lifecycle at the developer's working DB.
"""

import os
import tempfile
from pathlib import Path


_TEST_DATA_DIR = tempfile.TemporaryDirectory(prefix="bidding-tests-")
_TEST_DATABASE_PATH = (Path(_TEST_DATA_DIR.name) / "bidding-test.db").resolve()
if not _TEST_DATABASE_PATH.is_absolute() or _TEST_DATABASE_PATH.parent != Path(_TEST_DATA_DIR.name).resolve():
    raise RuntimeError("Test database isolation guard rejected the runtime path.")
os.environ["BIDDING_DB_PATH"] = str(_TEST_DATABASE_PATH)
os.environ["APP_ENV"] = "test"
os.environ.setdefault("ADMIN_PASSWORD", "Test-only-admin-password-2026!")
os.environ.setdefault("ADMIN_EMAIL", "admin-test@localhost")
os.environ.setdefault("DEFAULT_ORG_NAME", "Test Organization")
