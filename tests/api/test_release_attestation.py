import json

import pytest

from scripts.release_attestation import ReleaseAttestationError, build_attestation
from scripts.write_ci_evidence import build_ci_evidence


def _valid_environment():
    return {
        "RELEASE_P0_SECURITY_GATE": "passed",
        "RELEASE_CAPACITY_GATE": "passed",
        "RELEASE_EXTERNAL_AUTH_GATE": "passed",
        "RELEASE_PROXY_LIMITS_GATE": "passed",
        "RELEASE_BACKUP_RESTORE_GATE": "passed",
        "RELEASE_MIGRATION_REHEARSAL_GATE": "passed",
        "RELEASE_DATABASE_GATE": "passed",
        "RELEASE_DATABASE_MODE": "sqlite-single-instance",
        "RELEASE_SOURCE_REVISION": "b" * 40,
        "RELEASE_REPOSITORY": "owner/biddingflow",
        "RELEASE_CI_RUN_ID": "123",
    }


def _ci_evidence(tmp_path, **changes):
    evidence = {
        "format": "biddingflow-ci-evidence",
        "version": 1,
        "workflow": "Production CI",
        "repository": "owner/biddingflow",
        "runId": "123",
        "sourceRevision": "b" * 40,
        "conclusion": "success",
        "automatedGates": {
            "quality": "success",
            "api": "success",
            "supplyChain": "success",
            "packageSmoke": "success",
            "e2e": "success",
        },
    }
    evidence.update(changes)
    path = tmp_path / "ci-evidence.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")
    return path


def test_release_attestation_records_all_passed_gates_without_secrets(tmp_path):
    result = build_attestation(
        _valid_environment(), ci_evidence_path=_ci_evidence(tmp_path)
    )

    assert result["format"] == "biddingflow-release-attestation"
    assert result["version"] == 2
    assert result["databaseMode"] == "sqlite-single-instance"
    assert set(result["gates"].values()) == {"passed"}
    assert result["evidence"]["reference"].endswith("/actions/runs/123")
    assert len(result["evidence"]["sha256"]) == 64
    assert "password" not in str(result).casefold()


def test_release_attestation_fails_closed_when_any_gate_failed(tmp_path):
    environment = _valid_environment()
    environment["RELEASE_CAPACITY_GATE"] = "failed"

    with pytest.raises(ReleaseAttestationError, match="capacity"):
        build_attestation(environment, ci_evidence_path=_ci_evidence(tmp_path))


@pytest.mark.parametrize(
    ("variable", "value", "message"),
    (
        ("RELEASE_SOURCE_REVISION", "short", "full Git revision"),
        ("RELEASE_CI_RUN_ID", "not-numeric", "run ID"),
        ("RELEASE_DATABASE_MODE", "sqlite-multi-instance", "sqlite-single-instance"),
    ),
)
def test_release_attestation_rejects_invalid_or_unsafe_evidence(
    tmp_path, variable, value, message
):
    environment = _valid_environment()
    environment[variable] = value

    with pytest.raises(ReleaseAttestationError, match=message):
        build_attestation(environment, ci_evidence_path=_ci_evidence(tmp_path))


@pytest.mark.parametrize(
    ("changes", "message"),
    (
        ({"sourceRevision": "c" * 40}, "source revision"),
        ({"repository": "attacker/repository"}, "repository"),
        ({"runId": "999"}, "run ID"),
        ({"workflow": "Untrusted workflow"}, "successful Production CI"),
        ({"conclusion": "failure"}, "successful Production CI"),
        ({"automatedGates": {"quality": "success"}}, "exact automated gate"),
    ),
)
def test_release_attestation_rejects_wrong_provenance(tmp_path, changes, message):
    with pytest.raises(ReleaseAttestationError, match=message):
        build_attestation(
            _valid_environment(), ci_evidence_path=_ci_evidence(tmp_path, **changes)
        )


def test_ci_evidence_writer_requires_every_automated_gate():
    environment = {
        "GITHUB_SHA": "b" * 40,
        "GITHUB_REPOSITORY": "owner/biddingflow",
        "GITHUB_RUN_ID": "123",
        "QUALITY_RESULT": "success",
        "API_RESULT": "success",
        "SUPPLY_CHAIN_RESULT": "success",
        "PACKAGE_RESULT": "success",
        "E2E_RESULT": "success",
    }
    result = build_ci_evidence(environment)
    assert set(result["automatedGates"].values()) == {"success"}

    environment["API_RESULT"] = "failure"
    with pytest.raises(ValueError, match="Every automated"):
        build_ci_evidence(environment)
