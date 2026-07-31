from backend import app as app_module
from backend.lifecycle import database_auto_migration_enabled


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


def test_production_startup_skips_absent_local_postgres_setup(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    assert app_module._start_local_database_if_managed() is False
