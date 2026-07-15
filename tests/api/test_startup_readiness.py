import asyncio
import importlib
import json
from types import SimpleNamespace

import pytest

from backend.db.db_helper import SQLiteDatabase
from backend.startup import (
    StartupValidationError,
    validate_startup_configuration,
    verify_database_readiness,
    verify_database_responsive,
)


def _create_ready_database(path, schema_version=1):
    database = SQLiteDatabase(path)
    conn = database.get_connection()
    try:
        conn.executescript(
            f"""
            PRAGMA user_version = {int(schema_version)};
            CREATE TABLE tai_khoan (
                id TEXT PRIMARY KEY,
                vai_tro TEXT NOT NULL
            );
            CREATE TABLE to_chuc (
                id TEXT PRIMARY KEY
            );
            CREATE TABLE thanh_vien_to_chuc (
                user_id TEXT NOT NULL,
                organization_id TEXT NOT NULL
            );
            CREATE TABLE schema_migrations (
                id INTEGER PRIMARY KEY
            );
            CREATE TABLE password_reset_tokens (
                id TEXT PRIMARY KEY
            );
            CREATE TABLE rate_limit_buckets (
                bucket_key TEXT PRIMARY KEY
            );
            INSERT INTO tai_khoan (id, vai_tro) VALUES ('admin-1', 'super_admin');
            INSERT INTO to_chuc (id) VALUES ('org-1');
            INSERT INTO thanh_vien_to_chuc (user_id, organization_id)
            VALUES ('admin-1', 'org-1');
            """
        )
        conn.commit()
    finally:
        conn.close()
    return database


def test_first_run_requires_admin_password_before_migration(tmp_path):
    database = SQLiteDatabase(tmp_path / "fresh.db")

    with pytest.raises(StartupValidationError, match="ADMIN_PASSWORD"):
        validate_startup_configuration(database, {})

    assert not (tmp_path / "fresh.db").exists()


def test_ready_database_passes_bootstrap_and_responsive_checks(tmp_path):
    database = _create_ready_database(tmp_path / "ready.db")

    validate_startup_configuration(database, {})
    verify_database_readiness(database, expected_schema_version=1)
    verify_database_responsive(database, expected_schema_version=1)


def test_readiness_rejects_schema_version_drift(tmp_path):
    database = _create_ready_database(tmp_path / "wrong-version.db", schema_version=2)

    with pytest.raises(StartupValidationError, match="schema version"):
        verify_database_readiness(database, expected_schema_version=1)


def test_lifespan_propagates_database_initialization_failure(monkeypatch):
    app_module = importlib.import_module("backend.app")
    application = SimpleNamespace(state=SimpleNamespace())

    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "log_error", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        app_module,
        "validate_startup_configuration",
        lambda _database: None,
    )

    def fail_initialization():
        raise RuntimeError("database migration failed")

    monkeypatch.setattr(app_module, "_initialize_database", fail_initialization)

    async def enter_lifespan():
        async with app_module.lifespan(application):
            pass

    with pytest.raises(RuntimeError, match="database migration failed"):
        asyncio.run(enter_lifespan())

    assert application.state.ready is False
    assert application.state.startup_complete is False


def test_health_endpoints_distinguish_liveness_and_readiness(monkeypatch):
    app_module = importlib.import_module("backend.app")
    application = SimpleNamespace(
        state=SimpleNamespace(ready=False, startup_complete=False)
    )
    request = SimpleNamespace(app=application)

    live_response = asyncio.run(app_module.health_live_api(request))
    not_ready_response = asyncio.run(app_module.health_ready_api(request))

    assert live_response.status_code == 200
    assert json.loads(live_response.body) == {"status": "live"}
    assert not_ready_response.status_code == 503
    assert json.loads(not_ready_response.body) == {"status": "not_ready"}

    monkeypatch.setattr(
        app_module,
        "verify_database_responsive",
        lambda _database, _version: None,
    )
    application.state.ready = True
    application.state.startup_complete = True
    ready_response = asyncio.run(app_module.health_ready_api(request))

    assert ready_response.status_code == 200
    assert json.loads(ready_response.body) == {"status": "ready"}
