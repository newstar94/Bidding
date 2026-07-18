import copy
import json
from pathlib import Path

import pytest

from scripts.validate_recovery_objectives import (
    RecoveryObjectiveError,
    validate_recovery_objectives,
)


@pytest.fixture
def recovery_objectives():
    return json.loads(
        Path("load/recovery-objectives.json").read_text(encoding="utf-8")
    )


def test_versioned_recovery_objectives_are_complete_and_consistent(
    recovery_objectives,
):
    result = validate_recovery_objectives(recovery_objectives)
    assert result["applicationRpoSeconds"] == 15 * 60
    assert result["applicationRtoSeconds"] == 2 * 60 * 60
    assert result["components"]["postgresql"] == {
        "rpoSeconds": 5 * 60,
        "rtoSeconds": 60 * 60,
    }
    assert result["restoreDrillIntervalDays"] == 30
    assert result["passed"] is True


def test_component_cannot_be_weaker_than_application_objective(
    recovery_objectives,
):
    unsafe_rpo = copy.deepcopy(recovery_objectives)
    unsafe_rpo["components"]["postgresql"]["rpoSeconds"] = 901
    with pytest.raises(RecoveryObjectiveError, match="weaker than application RPO"):
        validate_recovery_objectives(unsafe_rpo)

    unsafe_rto = copy.deepcopy(recovery_objectives)
    unsafe_rto["components"]["businessFiles"]["rtoSeconds"] = 7201
    with pytest.raises(RecoveryObjectiveError, match="weaker than application RTO"):
        validate_recovery_objectives(unsafe_rto)


def test_recovery_retention_must_cover_drill_and_daily_backup_windows(
    recovery_objectives,
):
    short_pitr = copy.deepcopy(recovery_objectives)
    short_pitr["retention"]["pitrDays"] = 29
    with pytest.raises(RecoveryObjectiveError, match="restore-drill interval"):
        validate_recovery_objectives(short_pitr)

    early_alert = copy.deepcopy(recovery_objectives)
    early_alert["retention"]["verifiedBackupAlertAfterHours"] = 24
    with pytest.raises(RecoveryObjectiveError, match="daily backup schedule"):
        validate_recovery_objectives(early_alert)


def test_prometheus_restore_and_backup_alerts_match_recovery_contract(
    recovery_objectives,
):
    alert_rules = Path("deploy/prometheus/biddingflow-alerts.yml").read_text(
        encoding="utf-8"
    )
    restore_seconds = (
        recovery_objectives["retention"]["restoreDrillAlertAfterDays"] * 86400
    )
    backup_seconds = (
        recovery_objectives["retention"]["verifiedBackupAlertAfterHours"] * 3600
    )
    assert f"biddingflow_restore_drill_age_seconds > {restore_seconds}" in alert_rules
    assert f"biddingflow_backup_age_seconds > {backup_seconds}" in alert_rules
