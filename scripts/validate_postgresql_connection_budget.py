"""Fail CI when a PostgreSQL deployment can exhaust its role or server budget."""

import argparse
import json
import math
from pathlib import Path


DEFAULT_CONFIG = Path("load/postgresql-connection-budget.json")


class ConnectionBudgetError(ValueError):
    """Raised when the versioned deployment budget is unsafe or incomplete."""


def _integer(mapping, key, *, minimum=0):
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ConnectionBudgetError(f"{key} must be an integer >= {minimum}.")
    return value


def validate_connection_budget(config):
    if config.get("contractVersion") != 1:
        raise ConnectionBudgetError("contractVersion must be 1.")
    server = config.get("server") or {}
    roles = config.get("roles") or {}
    deployment = config.get("deployment") or {}

    max_connections = _integer(server, "maxConnections", minimum=1)
    superuser_reserved = _integer(server, "superuserReservedConnections")
    operational_reserve = _integer(server, "operationalReserveConnections")
    max_utilization = server.get("maxCommittedUtilization")
    if (
        isinstance(max_utilization, bool)
        or not isinstance(max_utilization, (int, float))
        or not 0 < max_utilization < 1
    ):
        raise ConnectionBudgetError(
            "maxCommittedUtilization must be greater than 0 and less than 1."
        )

    application_limit = _integer(roles, "applicationConnectionLimit", minimum=1)
    application_headroom = _integer(roles, "applicationHeadroomConnections")
    migration_limit = _integer(roles, "migrationConnectionLimit", minimum=1)
    monitoring_limit = _integer(roles, "monitoringConnectionLimit", minimum=1)

    steady_instances = _integer(
        deployment, "steadyApplicationInstances", minimum=1
    )
    surge_instances = _integer(deployment, "rollingSurgeInstances")
    pool_per_instance = _integer(
        deployment, "poolMaxPerApplicationInstance", minimum=1
    )
    worker_processes = _integer(deployment, "externalDatabaseWorkerProcesses")
    pool_per_worker = _integer(deployment, "poolMaxPerExternalWorker")
    migration_connections = _integer(
        deployment, "migrationConnections", minimum=1
    )
    monitoring_connections = _integer(
        deployment, "monitoringConnections", minimum=1
    )
    emergency_connections = _integer(
        deployment, "emergencyOperatorConnections", minimum=1
    )

    peak_instances = steady_instances + surge_instances
    application_connections = (
        peak_instances * pool_per_instance
        + worker_processes * pool_per_worker
    )
    application_capacity = application_limit - application_headroom
    if application_capacity < 1:
        raise ConnectionBudgetError(
            "Application role headroom leaves no usable application connection."
        )
    if application_connections > application_capacity:
        raise ConnectionBudgetError(
            "Peak application pools require "
            f"{application_connections} connections but the role budget permits "
            f"{application_capacity} after headroom."
        )
    if migration_connections > migration_limit:
        raise ConnectionBudgetError(
            f"Migration demand {migration_connections} exceeds role limit "
            f"{migration_limit}."
        )
    if monitoring_connections > monitoring_limit:
        raise ConnectionBudgetError(
            f"Monitoring demand {monitoring_connections} exceeds role limit "
            f"{monitoring_limit}."
        )

    server_available = max_connections - superuser_reserved
    committed_connections = (
        application_connections
        + migration_connections
        + monitoring_connections
        + emergency_connections
    )
    committed_with_reserve = committed_connections + operational_reserve
    utilization_limit = math.floor(server_available * max_utilization)
    if committed_connections > utilization_limit:
        raise ConnectionBudgetError(
            f"Committed demand {committed_connections} exceeds the configured "
            f"utilization limit {utilization_limit}."
        )
    if committed_with_reserve > server_available:
        raise ConnectionBudgetError(
            f"Demand plus operational reserve {committed_with_reserve} exceeds "
            f"the {server_available} non-superuser server connections."
        )

    return {
        "contractVersion": 1,
        "peakApplicationInstances": peak_instances,
        "applicationConnections": application_connections,
        "applicationRoleCapacityAfterHeadroom": application_capacity,
        "migrationConnections": migration_connections,
        "monitoringConnections": monitoring_connections,
        "emergencyOperatorConnections": emergency_connections,
        "committedConnections": committed_connections,
        "operationalReserveConnections": operational_reserve,
        "serverConnectionsAvailable": server_available,
        "serverUtilizationLimit": utilization_limit,
        "remainingConnectionsAfterReserve": (
            server_available - committed_with_reserve
        ),
        "passed": True,
    }


def load_and_validate(path=DEFAULT_CONFIG):
    config_path = Path(path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return validate_connection_budget(config)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args(argv)
    try:
        result = load_and_validate(arguments.config)
    except (ConnectionBudgetError, json.JSONDecodeError, OSError) as error:
        parser.error(str(error))
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
