from __future__ import annotations

import pytest

from backend.lifecycle import database_auto_migration_enabled
from backend.startup import StartupValidationError, verify_database_readiness


class _Connection:
    def __init__(self, version):
        self.version = version
        self.closed = False
        self.rolled_back = False

    def execute(self, statement, parameters=()):
        del statement, parameters
        return self

    def fetchone(self):
        return (self.version,)

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class _Database:
    def __init__(self, version):
        self.connection = _Connection(version)

    def get_connection(self):
        return self.connection


@pytest.mark.parametrize(
    "environment",
    [{}, {"APP_ENV": "development"}, {"APP_DEBUG": "True"}],
)
def test_database_auto_migration_is_disabled_by_default(environment):
    assert database_auto_migration_enabled(environment) is False


@pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes"])
def test_database_auto_migration_requires_explicit_opt_in(value):
    assert database_auto_migration_enabled({"DATABASE_AUTO_MIGRATE": value}) is True


def test_older_schema_error_points_to_explicit_migration_command():
    database = _Database(version=13)

    with pytest.raises(StartupValidationError) as error:
        verify_database_readiness(database, expected_schema_version=14)

    assert "installed=13, required=14" in str(error.value)
    assert "python scripts/manage_database.py" in str(error.value)
    assert database.connection.rolled_back is True
    assert database.connection.closed is True


def test_newer_schema_error_forbids_lowering_metadata():
    database = _Database(version=15)

    with pytest.raises(StartupValidationError) as error:
        verify_database_readiness(database, expected_schema_version=14)

    assert "installed=15, required=14" in str(error.value)
    assert "Do not lower schema metadata" in str(error.value)
    assert database.connection.rolled_back is True
    assert database.connection.closed is True
