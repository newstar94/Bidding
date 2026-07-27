import ast
from pathlib import Path

import pytest

from backend.db import db_helper
from backend.shared import logging_utils


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class _Connection:
    def __init__(self):
        self.close_calls = 0

    def close(self):
        self.close_calls += 1


class _Database:
    def __init__(self, connection):
        self.connection = connection
        self.acquire_calls = 0

    def get_connection(self):
        self.acquire_calls += 1
        return self.connection


def test_logging_module_does_not_import_shared_helpers_facade():
    path = PROJECT_ROOT / "backend/shared/logging_utils.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    facade_imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            facade_imports.extend(
                alias.name
                for alias in node.names
                if alias.name == "backend.shared.helpers"
            )
        elif (
            isinstance(node, ast.ImportFrom)
            and node.module == "backend.shared.helpers"
        ):
            facade_imports.append(node.module)

    assert facade_imports == []


@pytest.mark.parametrize("append_fails", [False, True])
def test_standalone_audit_always_returns_its_connection_to_the_pool(
    monkeypatch,
    append_fails,
):
    connection = _Connection()
    database = _Database(connection)
    monkeypatch.setattr(db_helper, "database", database)

    # The old implementation imported the same object through this facade.
    # Patching both keeps the test focused on connection ownership during the
    # red-to-green transition rather than the import location.
    from backend.shared import helpers

    monkeypatch.setattr(helpers, "database", database)
    monkeypatch.setattr(logging_utils, "log_error", lambda *_args, **_kwargs: None)

    if append_fails:
        def append(_connection, **_event):
            raise RuntimeError("audit write failed")
    else:
        def append(_connection, **_event):
            return "audit-hash"

    monkeypatch.setattr(logging_utils, "append_audit_row", append)

    result = logging_utils.log_audit("package.updated")

    assert database.acquire_calls == 1
    assert connection.close_calls == 1
    if append_fails:
        assert result is None
    else:
        assert result == "audit-hash"
