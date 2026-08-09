import re
from pathlib import Path

import pytest

from scripts import package_production


PACKAGED_OPERATIONAL_REFERENCE = re.compile(
    r"(?<![\w./-])((?:scripts|deploy|docs/runbooks)/[A-Za-z0-9_./-]+"
    r"|docs/production-security-information\.md)"
)


def test_package_path_guard_allows_runtime_security_module_and_rejects_artifacts():
    package_production._assert_safe(Path("backend/security/turnstile.py"))

    for forbidden_path in (
        Path("security/checklist.md"),
        Path("backend/__pycache__/app.cpython-314.pyc"),
    ):
        with pytest.raises(RuntimeError, match="Forbidden production path"):
            package_production._assert_safe(forbidden_path)


def test_private_client_symbols_and_public_source_maps_are_never_packageable():
    for forbidden_path in (
        Path("release/private-symbols/release.symbols.json"),
        Path("dist/assets/app-deadbeef.js.map"),
    ):
        with pytest.raises(RuntimeError, match="Forbidden production"):
            package_production._assert_safe(forbidden_path)


@pytest.mark.parametrize(
    "release_id",
    (None, "", " ", "development", "Development", "unknown", "UNKNOWN", "v2.0.0"),
)
def test_production_release_id_rejects_mutable_or_placeholder_values(release_id):
    with pytest.raises(RuntimeError, match="immutable release ID"):
        package_production._validate_release_id({"releaseId": release_id})


@pytest.mark.parametrize("release_id", ("a" * 40, "B" * 64))
def test_production_release_id_accepts_full_commit_or_content_hash(release_id):
    assert package_production._validate_release_id({"releaseId": release_id}) == release_id


def test_production_release_id_must_match_the_build_environment(monkeypatch):
    marker_release = "a" * 40
    monkeypatch.setenv("APP_RELEASE_ID", "b" * 40)

    with pytest.raises(RuntimeError, match="does not match APP_RELEASE_ID"):
        package_production._validate_release_id({"releaseId": marker_release})


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


def test_packaged_deployment_readme_only_references_packaged_operational_paths(
    monkeypatch,
):
    monkeypatch.setattr(
        package_production,
        "_validate_release_id",
        lambda _marker: "a" * 40,
    )
    readme = (package_production.PROJECT_ROOT / "deploy" / "README.md").read_text(
        encoding="utf-8"
    )
    references = set(PACKAGED_OPERATIONAL_REFERENCE.findall(readme))
    packaged_paths = {
        relative_path.as_posix()
        for _, relative_path in package_production.collect_runtime_files()
    }

    assert references
    missing = sorted(
        reference
        for reference in references
        if not (
            reference in packaged_paths
            or (
                reference.endswith("/")
                and any(path.startswith(reference) for path in packaged_paths)
            )
        )
    )
    assert missing == []


def test_normalized_postgres_contract_is_in_the_runtime_package(monkeypatch):
    monkeypatch.setattr(
        package_production,
        "_validate_release_id",
        lambda _marker: "a" * 40,
    )
    packaged_paths = {
        relative_path.as_posix()
        for _, relative_path in package_production.collect_runtime_files()
    }

    assert "backend/db/postgres_schema_contract.json" in packaged_paths
