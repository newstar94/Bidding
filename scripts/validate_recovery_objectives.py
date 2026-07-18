"""Validate BiddingFlow RPO/RTO and recovery-retention contracts."""

import argparse
import json
from pathlib import Path


DEFAULT_CONFIG = Path("load/recovery-objectives.json")


class RecoveryObjectiveError(ValueError):
    """Raised when recovery targets are incomplete or internally inconsistent."""


def _positive_integer(mapping, key):
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise RecoveryObjectiveError(f"{key} must be a positive integer.")
    return value


def validate_recovery_objectives(config):
    if config.get("contractVersion") != 1:
        raise RecoveryObjectiveError("contractVersion must be 1.")
    if config.get("scope") != "postgresql-production":
        raise RecoveryObjectiveError("scope must be postgresql-production.")

    application = config.get("application") or {}
    application_rpo = _positive_integer(application, "rpoSeconds")
    application_rto = _positive_integer(application, "rtoSeconds")
    if not str(application.get("owner") or "").strip():
        raise RecoveryObjectiveError("application owner is required.")

    components = config.get("components") or {}
    required_components = {"postgresql", "businessFiles", "auditCheckpoints"}
    if set(components) != required_components:
        raise RecoveryObjectiveError(
            "components must contain PostgreSQL, business files and audit checkpoints."
        )
    normalized_components = {}
    for component_name, component in components.items():
        rpo = _positive_integer(component, "rpoSeconds")
        rto = _positive_integer(component, "rtoSeconds")
        if rpo > application_rpo:
            raise RecoveryObjectiveError(
                f"{component_name} RPO {rpo}s is weaker than application RPO "
                f"{application_rpo}s."
            )
        if rto > application_rto:
            raise RecoveryObjectiveError(
                f"{component_name} RTO {rto}s is weaker than application RTO "
                f"{application_rto}s."
            )
        if not str(component.get("mechanism") or "").strip():
            raise RecoveryObjectiveError(f"{component_name} mechanism is required.")
        if not str(component.get("owner") or "").strip():
            raise RecoveryObjectiveError(f"{component_name} owner is required.")
        normalized_components[component_name] = {"rpoSeconds": rpo, "rtoSeconds": rto}

    retention = config.get("retention") or {}
    pitr_days = _positive_integer(retention, "pitrDays")
    immutable_days = _positive_integer(retention, "immutableBackupDays")
    drill_interval = _positive_integer(
        retention, "monthlyRestoreDrillIntervalDays"
    )
    drill_alert = _positive_integer(retention, "restoreDrillAlertAfterDays")
    backup_alert_hours = _positive_integer(
        retention, "verifiedBackupAlertAfterHours"
    )
    if pitr_days < drill_interval:
        raise RecoveryObjectiveError(
            "PITR retention must cover at least one restore-drill interval."
        )
    if immutable_days < pitr_days:
        raise RecoveryObjectiveError(
            "Immutable backup retention cannot be shorter than PITR retention."
        )
    if drill_alert <= drill_interval:
        raise RecoveryObjectiveError(
            "Restore-drill alert must allow the scheduled interval to complete."
        )
    if backup_alert_hours <= 24:
        raise RecoveryObjectiveError(
            "Verified-backup alert must allow the daily backup schedule to complete."
        )

    return {
        "contractVersion": 1,
        "scope": config["scope"],
        "applicationRpoSeconds": application_rpo,
        "applicationRtoSeconds": application_rto,
        "components": normalized_components,
        "pitrDays": pitr_days,
        "immutableBackupDays": immutable_days,
        "restoreDrillIntervalDays": drill_interval,
        "restoreDrillAlertAfterDays": drill_alert,
        "verifiedBackupAlertAfterHours": backup_alert_hours,
        "passed": True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args(argv)
    try:
        config = json.loads(arguments.config.read_text(encoding="utf-8"))
        result = validate_recovery_objectives(config)
    except (RecoveryObjectiveError, json.JSONDecodeError, OSError) as error:
        parser.error(str(error))
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
