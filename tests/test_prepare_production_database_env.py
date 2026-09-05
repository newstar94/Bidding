import json
import os
import stat
from urllib.parse import unquote, urlsplit

import pytest

from scripts.prepare_production_database_env import (
    ProductionDatabaseEnvironmentError,
    build_scoped_environments,
    prepare,
)


def payload():
    return {
        "version": 1,
        "databaseUrl": "postgresql://runtime:runtime-secret@db.internal:5432/biddingflow?sslmode=verify-full",
        "roles": {
            "migrator": {"password": "migrate secret"},
            "backup": {"password": "backup@secret"},
            "documentWorker": {"password": "document/secret"},
        },
    }


def test_builds_scoped_urls_without_cross_service_secrets():
    result = build_scoped_environments(payload())
    assert set(result) == {"web", "migrator", "backup", "documentWorker"}
    assert set(result["web"]) == {"APP_ENV", "DATABASE_RUNTIME_ROLE", "DATABASE_URL"}
    assert set(result["migrator"]) == {"APP_ENV", "MIGRATOR_DATABASE_URL"}
    assert set(result["backup"]) == {"APP_ENV", "BACKUP_DATABASE_URL"}
    assert set(result["documentWorker"]) == {
        "APP_ENV", "DATABASE_DOCUMENT_WORKER_ROLE", "DOCUMENT_WORKER_DATABASE_URL"
    }
    for scope, key, username, password in (
        ("migrator", "MIGRATOR_DATABASE_URL", "biddingflow_migrator", "migrate secret"),
        ("backup", "BACKUP_DATABASE_URL", "biddingflow_backup", "backup@secret"),
        ("documentWorker", "DOCUMENT_WORKER_DATABASE_URL", "biddingflow_document_worker", "document/secret"),
    ):
        parsed = urlsplit(result[scope][key])
        assert parsed.hostname == "db.internal"
        assert parsed.path == "/biddingflow"
        assert parsed.query == "sslmode=verify-full"
        assert unquote(parsed.username) == username
        assert unquote(parsed.password) == password


@pytest.mark.parametrize("change", ["tls", "role", "password"])
def test_rejects_unsafe_or_shared_production_credentials(change):
    source = payload()
    if change == "tls":
        source["databaseUrl"] = source["databaseUrl"].replace("verify-full", "require")
    elif change == "role":
        source["roles"]["backup"]["username"] = "runtime"
    else:
        source["roles"]["backup"]["password"] = "runtime-secret"
    with pytest.raises(ProductionDatabaseEnvironmentError):
        build_scoped_environments(source)


def test_prepare_writes_private_files_and_refuses_silent_overwrite(tmp_path):
    source = tmp_path / "source.json"
    source.write_text(json.dumps(payload()), encoding="utf-8")
    if os.name != "nt":
        source.chmod(0o600)
    output = tmp_path / "output"
    paths = prepare(source, output)
    assert len(paths) == 4
    assert all(path.is_file() for path in paths)
    assert all("DATABASE_" in path.read_text() for path in paths)
    assert all("='" in path.read_text() for path in paths)
    assert all("runtime-secret" not in path.read_text() for path in paths if "web" not in path.name)
    if os.name != "nt":
        assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in paths)
    with pytest.raises(ProductionDatabaseEnvironmentError, match="replace"):
        prepare(source, output)


def test_custom_service_database_changes_only_the_path():
    source = payload()
    source["roles"]["backup"]["database"] = "biddingflow_backup"
    result = build_scoped_environments(source)
    assert urlsplit(result["backup"]["BACKUP_DATABASE_URL"]).path == "/biddingflow_backup"
