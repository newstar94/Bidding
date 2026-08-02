from pathlib import Path

import pytest

from scripts import package_production


def test_package_path_guard_allows_runtime_security_module_and_rejects_artifacts():
    package_production._assert_safe(Path("backend/security/turnstile.py"))

    for forbidden_path in (
        Path("security/checklist.md"),
        Path("backend/__pycache__/app.cpython-314.pyc"),
    ):
        with pytest.raises(RuntimeError, match="Forbidden production path"):
            package_production._assert_safe(forbidden_path)


def test_extracted_smoke_environment_cannot_inherit_another_database(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://runtime/dev")
    monkeypatch.setenv("MIGRATOR_DATABASE_URL", "postgresql://migrator/dev")
    monkeypatch.setenv("DATABASE_ADMIN_URL", "postgresql://admin/dev")
    monkeypatch.setenv("API_TEST_DATABASE_URL", "postgresql://test/discovery")

    isolated = "postgresql://isolated/package_smoke_test"
    environment = package_production._isolated_smoke_environment(isolated)

    assert environment["DATABASE_URL"] == isolated
    assert environment["MIGRATOR_DATABASE_URL"] == isolated
    assert "DATABASE_ADMIN_URL" not in environment
    assert "API_TEST_DATABASE_URL" not in environment


def test_package_smoke_child_uses_only_its_synthetic_trusted_hosts(tmp_path):
    environment = package_production._smoke_child_environment(
        "postgresql://isolated/package_smoke_test",
        tmp_path,
    )

    assert environment["ALLOWED_HOSTS"] == "testserver,localhost,127.0.0.1"
    assert environment["PYTHONPATH"] == str(tmp_path.resolve())
