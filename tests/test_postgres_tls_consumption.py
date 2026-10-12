import pytest

from backend.db import db_helper
from backend.startup import _validate_postgresql_configuration, StartupValidationError


URL = "postgresql://test:fixture@db.example.test/bidding?sslmode=disable"


@pytest.fixture
def consumers(monkeypatch):
    calls = []

    class Connection:
        def cursor(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def execute(self, *_args):
            pass

    class Pool:
        def __init__(self, **kwargs):
            calls.append(("pool", kwargs))

        def open(self, **_kwargs):
            pass

    def connect(url, **kwargs):
        calls.append(("listener", {"conninfo": url, "kwargs": kwargs}))
        return Connection()

    monkeypatch.setattr(db_helper, "ConnectionPool", Pool)
    monkeypatch.setattr(db_helper.psycopg, "connect", connect)
    return calls


def test_environment_tls_mode_reaches_pool_and_listener(monkeypatch, consumers):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("DATABASE_SSLMODE", " VERIFY-FULL ")
    database = db_helper.PostgresDatabase()
    database.open()
    database.listen_connection()
    assert [kwargs["kwargs"].get("sslmode") for _, kwargs in consumers] == [
        "verify-full", "verify-full",
    ]


def test_explicit_worker_url_retains_its_tls_mode(monkeypatch, consumers):
    monkeypatch.setenv("DATABASE_SSLMODE", "disable")
    database = db_helper.PostgresDatabase(URL.replace("disable", "verify-full"))
    database.open()
    database.listen_connection()
    assert all("sslmode" not in kwargs["kwargs"] for _, kwargs in consumers)
    assert all("sslmode=verify-full" in kwargs["conninfo"] for _, kwargs in consumers)


@pytest.mark.parametrize("invalid", ["", "verify_full", "unknown"])
def test_invalid_environment_mode_fails_before_connect(monkeypatch, consumers, invalid):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("DATABASE_SSLMODE", invalid)
    with pytest.raises(ValueError, match="sslmode"):
        db_helper.PostgresDatabase().open()
    assert consumers == []


def test_startup_checks_the_explicit_database_consumer_mode(monkeypatch):
    monkeypatch.setenv("DATABASE_SSLMODE", "verify-full")
    database = db_helper.PostgresDatabase(URL)
    environment = {
        "DATABASE_URL": URL,
        "DATABASE_SSLMODE": "verify-full",
        "DATABASE_AUTO_MIGRATE": "false",
        "DATABASE_PRIVATE_NETWORK_CONFIRMED": "true",
    }
    with pytest.raises(StartupValidationError, match="verify-full"):
        _validate_postgresql_configuration(database, environment, production=True)


def test_url_only_certificate_mode_remains_valid(monkeypatch, consumers):
    monkeypatch.delenv("DATABASE_SSLMODE", raising=False)
    monkeypatch.setenv("DATABASE_URL", URL.replace("disable", "verify%2Dfull"))
    database = db_helper.PostgresDatabase()
    database.open()
    database.listen_connection()
    assert all("sslmode" not in kwargs["kwargs"] for _, kwargs in consumers)
    _validate_postgresql_configuration(database, {
        "DATABASE_URL": URL.replace("disable", "verify%2Dfull"),
        "DATABASE_AUTO_MIGRATE": "false",
        "DATABASE_PRIVATE_NETWORK_CONFIRMED": "true",
    }, production=True)
