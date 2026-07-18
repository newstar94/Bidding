import copy
import json
from pathlib import Path

import pytest

from scripts.validate_postgresql_connection_budget import (
    ConnectionBudgetError,
    validate_connection_budget,
)


CONFIG_PATH = Path("load/postgresql-connection-budget.json")


@pytest.fixture
def connection_budget():
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def test_versioned_postgresql_connection_budget_has_rolling_deploy_headroom(
    connection_budget,
):
    result = validate_connection_budget(connection_budget)
    assert result == {
        "contractVersion": 1,
        "peakApplicationInstances": 3,
        "applicationConnections": 30,
        "applicationRoleCapacityAfterHeadroom": 45,
        "migrationConnections": 2,
        "monitoringConnections": 5,
        "emergencyOperatorConnections": 5,
        "committedConnections": 42,
        "operationalReserveConnections": 10,
        "serverConnectionsAvailable": 97,
        "serverUtilizationLimit": 67,
        "remainingConnectionsAfterReserve": 45,
        "passed": True,
    }

    example_environment = Path(".env.example").read_text(encoding="utf-8")
    assert "POSTGRES_POOL_MAX_SIZE=10" in example_environment


def test_budget_rejects_application_pool_exhaustion(connection_budget):
    unsafe = copy.deepcopy(connection_budget)
    unsafe["deployment"]["poolMaxPerApplicationInstance"] = 20
    with pytest.raises(ConnectionBudgetError, match="role budget permits 45"):
        validate_connection_budget(unsafe)


def test_budget_rejects_server_overcommit_even_when_role_limits_fit(
    connection_budget,
):
    unsafe = copy.deepcopy(connection_budget)
    unsafe["server"]["maxConnections"] = 55
    with pytest.raises(ConnectionBudgetError, match="utilization limit"):
        validate_connection_budget(unsafe)


def test_budget_rejects_migration_or_monitor_role_overcommit(connection_budget):
    unsafe_migration = copy.deepcopy(connection_budget)
    unsafe_migration["deployment"]["migrationConnections"] = 3
    with pytest.raises(ConnectionBudgetError, match="Migration demand"):
        validate_connection_budget(unsafe_migration)

    unsafe_monitoring = copy.deepcopy(connection_budget)
    unsafe_monitoring["deployment"]["monitoringConnections"] = 6
    with pytest.raises(ConnectionBudgetError, match="Monitoring demand"):
        validate_connection_budget(unsafe_monitoring)
