import asyncio
import importlib
import json
from types import SimpleNamespace

import pytest

from backend.db.db_helper import SQLiteDatabase
from backend.startup import (
    StartupValidationError,
    _validate_production_postgresql_layout,
    database_requires_admin_bootstrap,
    validate_startup_configuration,
    verify_database_readiness,
    verify_database_responsive,
)


class _PostgreSQLResult:
    def __init__(self, *, one=None, all_rows=None):
        self._one = one
        self._all_rows = [] if all_rows is None else all_rows

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all_rows


class _PostgreSQLConnection:
    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.closed = False

    def execute(self, statement, _params=None):
        self.statements.append(statement)
        return self._results.pop(0)

    def close(self):
        self.closed = True


class _PostgreSQLDatabase:
    backend_name = "postgresql"

    def __init__(self, results, dsn="postgresql://app@db/bidding?sslmode=verify-full"):
        self.dsn = dsn
        self.connection = _PostgreSQLConnection(results)

    def get_connection(self):
        return self.connection


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


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://app@db/bidding",
        "postgresql://app@db/bidding?sslmode=require",
        "sqlite:///bidding.db?sslmode=verify-full",
    ],
)
def test_production_postgresql_requires_verified_tls(dsn):
    database = _PostgreSQLDatabase([], dsn=dsn)

    with pytest.raises(StartupValidationError):
        _validate_production_postgresql_layout(database)


def test_production_postgresql_accepts_verified_tls():
    database = _PostgreSQLDatabase([])

    _validate_production_postgresql_layout(
        database,
        {
            "BIDDING_MIGRATION_DATABASE_URL": (
                "postgresql://migrator@db/bidding?sslmode=verify-full"
            )
        },
    )


def test_production_postgresql_requires_separate_matching_migration_role():
    database = _PostgreSQLDatabase([])
    with pytest.raises(StartupValidationError, match="migration roles must be different"):
        _validate_production_postgresql_layout(
            database,
            {
                "BIDDING_MIGRATION_DATABASE_URL": (
                    "postgresql://app@db/bidding?sslmode=verify-full"
                )
            },
        )
    with pytest.raises(StartupValidationError, match="same PostgreSQL database"):
        _validate_production_postgresql_layout(
            database,
            {
                "BIDDING_MIGRATION_DATABASE_URL": (
                    "postgresql://migrator@other/bidding?sslmode=verify-full"
                )
            },
        )


def test_production_postgresql_validates_tls_before_connecting():
    class _MustNotConnect(_PostgreSQLDatabase):
        def get_connection(self):
            raise AssertionError("connection attempted before TLS validation")

    database = _MustNotConnect(
        [], dsn="postgresql://app@db/bidding?sslmode=require"
    )

    with pytest.raises(StartupValidationError, match="sslmode=verify-full"):
        validate_startup_configuration(
            database,
            {
                "APP_ENV": "production",
                "BIDDING_MIGRATION_DATABASE_URL": (
                    "postgresql://migrator@db/bidding?sslmode=verify-full"
                ),
            },
        )


def test_postgresql_bootstrap_detection_handles_missing_and_empty_user_table():
    missing = _PostgreSQLDatabase([_PostgreSQLResult(one=(None,))])
    assert database_requires_admin_bootstrap(missing) is True
    assert missing.connection.closed is True

    empty = _PostgreSQLDatabase(
        [_PostgreSQLResult(one=("tai_khoan",)), _PostgreSQLResult(one=None)]
    )
    assert database_requires_admin_bootstrap(empty) is True
    assert empty.connection.closed is True

    populated = _PostgreSQLDatabase(
        [_PostgreSQLResult(one=("tai_khoan",)), _PostgreSQLResult(one=(1,))]
    )
    assert database_requires_admin_bootstrap(populated) is False
    assert populated.connection.closed is True


def _postgresql_schema_tables():
    from backend.db.postgresql_schema import POSTGRESQL_EXTRA_TABLES, SCHEMA_DINH_NGHIA

    return [(name,) for name in set(SCHEMA_DINH_NGHIA) | set(POSTGRESQL_EXTRA_TABLES)]


def test_postgresql_readiness_and_responsive_checks_pass():
    readiness = _PostgreSQLDatabase(
        [
            _PostgreSQLResult(one=(1,)),
            _PostgreSQLResult(all_rows=_postgresql_schema_tables()),
            _PostgreSQLResult(one=(1,)),
        ]
    )
    assert verify_database_readiness(readiness, expected_schema_version=1) is True
    assert readiness.connection.closed is True

    responsive = _PostgreSQLDatabase(
        [_PostgreSQLResult(one=(1,)), _PostgreSQLResult(one=(1,))]
    )
    verify_database_responsive(responsive, expected_schema_version=1)
    assert responsive.connection.closed is True


def test_postgresql_readiness_rejects_missing_table():
    table_rows = _postgresql_schema_tables()[1:]
    database = _PostgreSQLDatabase(
        [
            _PostgreSQLResult(one=(1,)),
            _PostgreSQLResult(all_rows=table_rows),
        ]
    )

    with pytest.raises(StartupValidationError, match="tables are missing"):
        verify_database_readiness(database, expected_schema_version=1)

    assert database.connection.closed is True


def test_postgresql_readiness_rejects_schema_version_drift():
    database = _PostgreSQLDatabase([_PostgreSQLResult(one=(2,))])

    with pytest.raises(StartupValidationError, match="schema version"):
        verify_database_readiness(database, expected_schema_version=1)

    assert database.connection.closed is True


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
