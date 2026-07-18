import pytest

from scripts.rehearse_postgresql_multi_instance import (
    _latency_summary,
    _require_loopback_admin_url,
    evaluate_evidence,
)


def test_multi_instance_rehearsal_refuses_remote_or_non_postgresql_targets():
    _require_loopback_admin_url(
        "postgresql://operator@127.0.0.1:55432/postgres?sslmode=disable"
    )
    with pytest.raises(ValueError, match="loopback"):
        _require_loopback_admin_url(
            "postgresql://operator@db.example.test/postgres?sslmode=verify-full"
        )
    with pytest.raises(ValueError, match="PostgreSQL URL"):
        _require_loopback_admin_url("https://127.0.0.1/database")


def test_multi_instance_latency_summary_is_stable():
    summary = _latency_summary([50, 10, 40, 20, 30])
    assert summary == {
        "count": 5,
        "p50Ms": 30.0,
        "p95Ms": 50.0,
        "p99Ms": 50.0,
        "maxMs": 50,
    }


def test_multi_instance_gate_requires_every_cross_instance_invariant():
    evidence = {
        "sessions": {"distinct": 100, "target": 100},
        "instances": {"ready": 2, "target": 2},
        "http": {"totalRequests": 1000, "unexpectedFailures": 0, "server5xx": 0},
        "latency": {
            "read": {"p95Ms": 10, "p99Ms": 20},
            "sync": {"p95Ms": 20, "p99Ms": 30},
            "recovery": {"p95Ms": 5, "p99Ms": 10},
        },
        "websocket": {"authenticatedConnections": 100, "broadcastDeliveries": 100},
        "database": {
            "uniqueMutations": 101,
            "expectedMutations": 101,
            "brokerEvents": 101,
            "expectedBrokerEvents": 101,
        },
    }
    thresholds = {
        "unexpectedFailureRate": 0.01,
        "server5xxRate": 0.005,
        "readP95Ms": 750,
        "readP99Ms": 2000,
        "syncP95Ms": 1500,
        "syncP99Ms": 4000,
        "recoveryP95Ms": 250,
        "recoveryP99Ms": 750,
    }
    checks, passed = evaluate_evidence(evidence, thresholds)
    assert passed is True
    assert all(checks.values())

    evidence["database"]["brokerEvents"] = 100
    checks, passed = evaluate_evidence(evidence, thresholds)
    assert passed is False
    assert checks["brokerEventUniqueness"] is False
