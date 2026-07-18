import os
import shutil
import tempfile
from pathlib import Path


_TEST_RUNTIME_DIR = Path(tempfile.mkdtemp(prefix="biddingflow-api-tests-"))
_TEST_DATABASE_PATH = (_TEST_RUNTIME_DIR / "api-tests.db").resolve()
if not _TEST_DATABASE_PATH.is_absolute() or _TEST_DATABASE_PATH.parent != _TEST_RUNTIME_DIR.resolve():
    raise RuntimeError("Pytest database isolation guard rejected the runtime path.")
os.environ["BIDDING_DB_PATH"] = str(_TEST_DATABASE_PATH)
os.environ.setdefault("ADMIN_PASSWORD", "api test bootstrap password 2026")
os.environ.setdefault("ADMIN_EMAIL", "admin-tests@example.com")
os.environ.setdefault("DEFAULT_ORG_NAME", "API Test Organization")
os.environ["APP_ENV"] = "test"


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    shutil.rmtree(_TEST_RUNTIME_DIR, ignore_errors=True)
