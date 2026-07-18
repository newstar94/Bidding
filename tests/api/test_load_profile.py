import copy
import json
from pathlib import Path

import pytest

from scripts.load_profile import (
    LoadProfileError,
    build_execution_plan,
    load_profile,
    validate_profile,
    validate_runtime_inputs,
)
from scripts.validate_load_profile import main as validate_main


ROOT = Path(__file__).resolve().parents[2]
MIXED_PROFILE = ROOT / "load" / "profiles" / "mixed-100.json"
SOAK_PROFILE = ROOT / "load" / "profiles" / "soak-100.json"


def test_committed_profiles_validate_without_server_or_credentials():
    mixed = load_profile(MIXED_PROFILE)
    soak = load_profile(SOAK_PROFILE)

    mixed_plan = build_execution_plan(mixed)
    assert mixed_plan["valid"] is True
    assert mixed_plan["targetConcurrentActiveUsers"] == 100
    assert mixed_plan["totalDurationSeconds"] == 2100
    assert set(mixed_plan["scenarios"]) == {
        "login",
        "pagination",
        "sync",
        "upload",
        "export",
        "websocket",
        "recovery",
    }
    assert build_execution_plan(soak)["totalDurationSeconds"] == 5400


def test_profile_rejects_invalid_slo_and_burst_rate():
    profile = load_profile(MIXED_PROFILE)
    invalid_latency = copy.deepcopy(profile)
    invalid_latency["thresholds"]["readP99Ms"] = 100
    with pytest.raises(LoadProfileError, match="cannot be lower"):
        validate_profile(invalid_latency)

    invalid_burst = copy.deepcopy(profile)
    invalid_burst["scenarios"]["sync"]["burstRatePerMinute"] = 1
    with pytest.raises(LoadProfileError, match="cannot be lower"):
        validate_profile(invalid_burst)


def test_runtime_validation_counts_inputs_without_returning_secrets(tmp_path):
    profile = load_profile(MIXED_PROFILE)
    sessions = {
        "sessions": [
            {
                "cookie": f"session_token=secret-token-{index}",
                "organizationId": f"org-{index}",
                "packageId": f"package-{index}",
                "planId": f"plan-{index}",
            }
            for index in range(100)
        ]
    }
    users = {
        "users": [
            {"username": f"load-user-{index}", "password": f"secret-password-{index}"}
            for index in range(10)
        ]
    }
    sessions_path = tmp_path / "sessions.json"
    users_path = tmp_path / "users.json"
    upload_path = tmp_path / "fixture.docx"
    sync_path = tmp_path / "sync.json"
    sessions_path.write_text(json.dumps(sessions), encoding="utf-8")
    users_path.write_text(json.dumps(users), encoding="utf-8")
    upload_path.write_bytes(b"PK-safe-test-fixture")
    sync_path.write_text(json.dumps({"goithau": [{"id": "fixture"}]}), encoding="utf-8")

    runtime = validate_runtime_inputs(
        profile,
        sessions_path=sessions_path,
        login_users_path=users_path,
        upload_fixture_path=upload_path,
        sync_fixture_path=sync_path,
    )
    rendered = json.dumps(build_execution_plan(profile, runtime=runtime))

    assert runtime == {
        "validated": True,
        "distinctSessions": 100,
        "distinctLoginUsers": 10,
        "uploadFixtureBytes": 20,
        "syncFixtureItems": 1,
    }
    assert "secret-token" not in rendered
    assert "secret-password" not in rendered
    assert "package-" not in rendered
    assert "org-" not in rendered


def test_runtime_validation_rejects_duplicate_session_tokens(tmp_path):
    profile = load_profile(MIXED_PROFILE)
    sessions_path = tmp_path / "sessions.json"
    sessions_path.write_text(
        json.dumps({
            "sessions": [
                {
                    "cookie": "session_token=repeated",
                    "organizationId": "org",
                    "packageId": "package",
                }
                for _ in range(100)
            ]
        }),
        encoding="utf-8",
    )
    with pytest.raises(LoadProfileError, match="distinct cookie"):
        validate_runtime_inputs(profile, sessions_path=sessions_path)


def test_cli_dry_run_is_redacted_and_writes_machine_plan(tmp_path, capsys, monkeypatch):
    def block_network(*_args, **_kwargs):
        raise AssertionError("dry-run must not access the network")

    monkeypatch.setattr("socket.socket.connect", block_network)
    output = tmp_path / "plan.json"

    assert validate_main([str(MIXED_PROFILE), "--output", str(output)]) == 0
    stdout = capsys.readouterr().out
    payload = json.loads(stdout)

    assert payload["valid"] is True
    assert json.loads(output.read_text(encoding="utf-8")) == payload
    assert "BF_BASE_URL" not in stdout
    assert "session_token" not in stdout


def test_k6_harness_has_target_interlock_and_machine_summary():
    harness = (ROOT / "load" / "k6" / "mixed_load.js").read_text(encoding="utf-8")

    assert "production targets are intentionally prohibited" in harness
    assert "BF_LOAD_RUN_ACK" in harness
    assert "BF_LOAD_TARGET_ACK" in harness
    assert "dropped_iterations" in harness
    assert "handleSummary" in harness
    assert "passed" in harness
    assert "prepareExportSnapshot" in harness
    assert "http.get(\n    `${baseUrl}/api/sync-version`" in harness
    assert "operation: 'export_snapshot_read'" in harness
    assert "operation: 'export_snapshot_sync'" not in harness
    assert "snapshotVersion=" in harness
    assert "snapshot_conflict_rate" in harness
