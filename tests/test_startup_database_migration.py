from types import SimpleNamespace

import pytest

from backend import app as app_module
from backend.db.db_utils import (
    DB_RUNTIME_MAX_SCHEMA_VERSION,
    DB_RUNTIME_MIN_SCHEMA_VERSION,
    DB_SCHEMA_VERSION,
)
from backend.lifecycle import database_auto_migration_enabled
from backend.startup import (
    REQUIRED_APPLICATION_TABLES,
    StartupValidationError,
    verify_database_readiness,
    verify_database_responsive,
)
from scripts import manage_database


class _RuntimeSchemaConnection:
    def __init__(self, version):
        self.version = version

    def execute(self, statement, _parameters=()):
        normalized = " ".join(statement.split())
        if "SELECT schema_version FROM database_metadata" in normalized:
            rows = [(self.version,)]
        elif "FROM information_schema.tables" in normalized:
            rows = [(table,) for table in REQUIRED_APPLICATION_TABLES]
        elif "FROM pg_constraint" in normalized:
            rows = []
        elif "FROM tai_khoan AS users" in normalized:
            rows = [(1,)]
        elif normalized == "SELECT 1 FROM tai_khoan LIMIT 1":
            rows = [(1,)]
        else:
            rows = []
        return SimpleNamespace(
            fetchone=lambda: rows[0] if rows else None,
            fetchall=lambda: rows,
        )

    def rollback(self):
        return None

    def close(self):
        return None


class _RuntimeSchemaDatabase:
    def __init__(self, version):
        self.version = version

    def get_connection(self):
        return _RuntimeSchemaConnection(self.version)


def test_v63_expand_contract_runtime_accepts_only_schema_62_through_63():
    assert (DB_RUNTIME_MIN_SCHEMA_VERSION, DB_RUNTIME_MAX_SCHEMA_VERSION) == (
        62,
        63,
    )
    assert DB_SCHEMA_VERSION == DB_RUNTIME_MAX_SCHEMA_VERSION == 63
    for version in (62, 63):
        verify_database_readiness(
            _RuntimeSchemaDatabase(version),
            DB_RUNTIME_MIN_SCHEMA_VERSION,
            DB_RUNTIME_MAX_SCHEMA_VERSION,
        )
        verify_database_responsive(
            _RuntimeSchemaDatabase(version),
            DB_RUNTIME_MIN_SCHEMA_VERSION,
            DB_RUNTIME_MAX_SCHEMA_VERSION,
        )
    for version in (61, 64):
        for verification in (
            verify_database_readiness,
            verify_database_responsive,
        ):
            with pytest.raises(StartupValidationError):
                verification(
                    _RuntimeSchemaDatabase(version),
                    DB_RUNTIME_MIN_SCHEMA_VERSION,
                    DB_RUNTIME_MAX_SCHEMA_VERSION,
                )


def test_auto_migration_defaults_to_enabled_outside_production():
    assert database_auto_migration_enabled({"APP_ENV": "development"}) is True
    assert database_auto_migration_enabled({"APP_ENV": "test"}) is True


def test_auto_migration_defaults_to_disabled_in_production():
    assert database_auto_migration_enabled({"APP_ENV": "production"}) is False
    assert database_auto_migration_enabled({"APP_ENV": "prod"}) is False


def test_auto_migration_can_be_explicitly_disabled_in_development():
    assert database_auto_migration_enabled(
        {"APP_ENV": "development", "DATABASE_AUTO_MIGRATE": "false"}
    ) is False


def test_startup_migration_uses_migrator_credentials(monkeypatch):
    events = []

    class FakeDatabase:
        def __init__(self, database_url):
            events.append(("open", database_url))

        def close(self):
            events.append(("close", None))

    def initialize(database):
        assert isinstance(database, FakeDatabase)
        events.append(("initialize", None))

    monkeypatch.setenv("DATABASE_URL", "postgresql://runtime/database")
    monkeypatch.setenv("MIGRATOR_DATABASE_URL", "postgresql://migrator/database")
    monkeypatch.setattr("backend.db.db_helper.PostgresDatabase", FakeDatabase)
    monkeypatch.setattr("backend.db.postgres_schema.initialize_and_log", initialize)

    app_module._initialize_database()

    assert events == [
        ("open", "postgresql://migrator/database"),
        ("initialize", None),
        ("close", None),
    ]


def test_startup_migration_closes_connection_after_failure(monkeypatch):
    events = []

    class FakeDatabase:
        def __init__(self, database_url):
            events.append(("open", database_url))

        def close(self):
            events.append(("close", None))

    def fail_migration(_database):
        events.append(("initialize", None))
        raise RuntimeError("migration failed")

    monkeypatch.delenv("MIGRATOR_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://runtime/database")
    monkeypatch.setattr("backend.db.db_helper.PostgresDatabase", FakeDatabase)
    monkeypatch.setattr(
        "backend.db.postgres_schema.initialize_and_log",
        fail_migration,
    )

    try:
        app_module._initialize_database()
    except RuntimeError as exc:
        assert str(exc) == "migration failed"
    else:
        raise AssertionError("Expected startup migration to fail")

    assert events == [
        ("open", "postgresql://runtime/database"),
        ("initialize", None),
        ("close", None),
    ]


def test_application_startup_auto_starts_managed_local_postgres(monkeypatch):
    events = []
    monkeypatch.setattr(
        "scripts.setup_local_postgres.should_auto_start_local_postgres",
        lambda _environment: True,
    )
    monkeypatch.setattr(
        "scripts.setup_local_postgres.ensure_local_postgres_running",
        lambda: events.append("postgres-started"),
    )

    assert app_module._start_local_database_if_managed() is True
    assert events == ["postgres-started"]


def test_debug_reloader_supervisor_starts_postgres_before_workers(monkeypatch):
    events = []
    monkeypatch.delenv(app_module.LOCAL_DATABASE_SUPERVISOR_ENV, raising=False)
    monkeypatch.setattr(
        app_module,
        "_start_local_database_if_managed",
        lambda: events.append("postgres-started") or True,
    )

    assert app_module._start_local_database_before_reloader() is True
    assert events == ["postgres-started"]
    assert app_module.os.environ[app_module.LOCAL_DATABASE_SUPERVISOR_ENV] == "1"


def test_reloader_worker_does_not_own_supervisor_postgres(monkeypatch):
    monkeypatch.setenv(app_module.LOCAL_DATABASE_SUPERVISOR_ENV, "1")
    monkeypatch.setattr(
        "scripts.setup_local_postgres.ensure_local_postgres_running",
        lambda: pytest.fail("reload worker must not start the supervisor database"),
    )

    assert app_module._start_local_database_if_managed() is False


def test_production_startup_skips_absent_local_postgres_setup(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    assert app_module._start_local_database_if_managed() is False


def test_manage_database_preflight_is_read_only(monkeypatch, capsys):
    events = []
    report = {
        "currentVersion": 35,
        "targetVersion": 43,
        "upgradeRequired": True,
        "v36CanonicalLotCodes": {
            "applies": True,
            "rowsLoadedIntoPython": 9000,
            "requiresTransactionalDryRun": True,
        },
    }

    class FakeDatabase:
        def __init__(self, database_url):
            events.append(("open", database_url))

        def close(self):
            events.append(("close", None))

    monkeypatch.setenv("MIGRATOR_DATABASE_URL", "postgresql://migrator/database")
    monkeypatch.setattr("backend.db.db_helper.PostgresDatabase", FakeDatabase)
    monkeypatch.setattr(
        manage_database,
        "_read_upgrade_preflight",
        lambda database: events.append(("preflight", database)) or report,
    )
    monkeypatch.setattr(
        "backend.db.postgres_schema.initialize_postgres_database",
        lambda *_args, **_kwargs: pytest.fail("preflight must not run migrations"),
    )

    assert manage_database.main(["--preflight"]) == 0
    output = capsys.readouterr().out

    assert '"rowsLoadedIntoPython": 9000' in output
    assert events[0] == ("open", "postgresql://migrator/database")
    assert events[-1] == ("close", None)


def test_manage_database_dry_run_executes_then_rolls_back(monkeypatch, capsys):
    events = []

    class FakeDatabase:
        def __init__(self, _database_url):
            pass

        def close(self):
            events.append("close")

    monkeypatch.setenv("MIGRATOR_DATABASE_URL", "postgresql://migrator/database")
    monkeypatch.setattr("backend.db.db_helper.PostgresDatabase", FakeDatabase)
    monkeypatch.setattr(
        manage_database,
        "_read_upgrade_preflight",
        lambda _database: {
            "currentVersion": 35,
            "targetVersion": 43,
            "upgradeRequired": True,
            "v36CanonicalLotCodes": {
                "applies": True,
                "requiresTransactionalDryRun": True,
            },
        },
    )

    def initialize(_database, *, dry_run=False):
        events.append(("initialize", dry_run))
        return 43

    monkeypatch.setattr(
        "backend.db.postgres_schema.initialize_postgres_database",
        initialize,
    )

    assert manage_database.main(["--dry-run"]) == 0
    assert events == [("initialize", True), "close"]
    assert "rolled back" in capsys.readouterr().out
