import ast
from pathlib import Path

import pytest

from backend.observability import metrics
from backend.observability.recording import (
    document_worker_acquired,
    document_worker_finished,
    document_worker_rejected,
    document_worker_wait_started,
    record_audit_chain_verification,
    record_audit_checkpoint,
    record_database_operation,
    record_database_phase,
    record_partner_lookup,
    record_partner_upstream,
    reset_recorded_metrics_for_tests,
    runtime_log_dropped,
    snapshot_recorded_metrics,
    websocket_attempted,
    websocket_authentication_failed,
    websocket_connected,
    websocket_disconnected,
    websocket_rejected,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _imports_module(path: Path, module_name: str) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(alias.name == module_name for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom) and node.module == module_name:
            return True
    return False


def test_database_and_logging_producers_do_not_import_prometheus_renderer():
    producers = (
        "backend/auth/session_store.py",
        "backend/auth/session_utils.py",
        "backend/db/db_helper.py",
        "backend/documents/document_worker.py",
        "backend/partners/address_routes.py",
        "backend/partners/partner_lookup_service.py",
        "backend/shared/audit_monitor.py",
        "backend/shared/database_io.py",
        "backend/shared/logging_utils.py",
        "backend/sync/websocket.py",
    )

    coupled = [
        relative
        for relative in producers
        if _imports_module(
            PROJECT_ROOT / relative,
            "backend.observability.metrics",
        )
    ]

    assert coupled == []


def test_partner_and_websocket_hot_paths_do_not_import_shared_helpers_facade():
    producers = (
        "backend/partners/partner_lookup_service.py",
        "backend/sync/websocket.py",
    )

    coupled = [
        relative
        for relative in producers
        if _imports_module(
            PROJECT_ROOT / relative,
            "backend.shared.helpers",
        )
    ]

    assert coupled == []


def test_recording_module_has_no_application_imports():
    path = PROJECT_ROOT / "backend/observability/recording.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    backend_imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            backend_imports.extend(
                alias.name for alias in node.names if alias.name.startswith("backend.")
            )
        elif (
            isinstance(node, ast.ImportFrom)
            and node.module
            and node.module.startswith("backend.")
        ):
            backend_imports.append(node.module)

    assert backend_imports == []


def test_recording_snapshot_and_reset_cover_database_phases_and_log_drops():
    reset_recorded_metrics_for_tests()

    record_database_operation("read", 0.003, outcome="ok", busy=True)
    record_database_operation("not a safe label", -1, outcome="also unsafe")
    record_database_phase("sync", "prefetch", 0.02)
    runtime_log_dropped()

    snapshot = snapshot_recorded_metrics()
    assert snapshot.database_operations[("read", "ok")] == 1
    assert snapshot.database_operations[("unknown", "error")] == 1
    assert snapshot.database_busy["read"] == 1
    assert snapshot.database_duration_count["read"] == 1
    assert snapshot.database_duration_buckets[("read", 0.005)] == 1
    assert snapshot.database_phase_count[("sync", "prefetch", "ok")] == 1
    assert snapshot.database_phase_max[("sync", "prefetch", "ok")] == 0.02
    assert snapshot.runtime_log_dropped == 1

    reset_recorded_metrics_for_tests()
    reset_snapshot = snapshot_recorded_metrics()
    assert reset_snapshot.database_operations == {}
    assert reset_snapshot.database_phase_count == {}
    assert reset_snapshot.database_phase_max == {}
    assert reset_snapshot.runtime_log_dropped == 0


def test_prometheus_renderer_consumes_recording_snapshot(monkeypatch):
    metrics._reset_metrics_for_tests()
    metrics.record_database_operation("write", 0.01, outcome="busy", busy=True)
    metrics.record_database_phase("sync", "commit", 0.025, outcome="ok")
    metrics.runtime_log_dropped()
    monkeypatch.setattr(
        metrics,
        "_filesystem_metrics",
        lambda: {
            "postgres_database_bytes": 0,
            "postgres_pool": {},
            "websocket_outbox_rows": 0,
            "websocket_outbox_oldest_seconds": 0,
            "disk": {},
            "backup_timestamp": None,
            "backup_age": None,
            "restore_timestamp": None,
            "restore_age": None,
            "artifact_checked_at": 0,
        },
    )

    rendered = metrics.render_prometheus()

    assert (
        'biddingflow_database_operations_total{lane="write",outcome="busy"} 1'
        in rendered
    )
    assert (
        'biddingflow_database_phase_duration_seconds_count{outcome="ok",phase="commit",scope="sync"} 1'
        in rendered
    )
    assert "biddingflow_runtime_log_dropped_total 1" in rendered


def test_recording_snapshot_covers_worker_partner_websocket_and_audit_events():
    reset_recorded_metrics_for_tests()

    document_worker_wait_started()
    document_worker_acquired(0.1)
    document_worker_finished("completed", 0.2)
    document_worker_wait_started()
    document_worker_rejected(0.3)
    record_partner_lookup("found")
    record_partner_lookup("unsupported")
    record_partner_upstream("vietqr", "timeout")
    record_partner_upstream("unsupported", "unsupported")
    websocket_attempted()
    websocket_rejected("origin")
    websocket_authentication_failed("protocol")
    websocket_connected("user-1")
    websocket_disconnected()
    websocket_connected("user-1")
    websocket_disconnected()
    record_audit_chain_verification("valid", 0.4, 7)
    record_audit_checkpoint("success")

    snapshot = snapshot_recorded_metrics()
    assert snapshot.document_worker["submitted"] == 2
    assert snapshot.document_worker["completed"] == 1
    assert snapshot.document_worker["rejected"] == 1
    assert snapshot.document_worker["active"] == 0
    assert snapshot.document_worker["waiting"] == 0
    assert snapshot.document_worker_queue_wait_seconds == pytest.approx(0.4)
    assert snapshot.document_worker_duration_seconds == pytest.approx(0.2)
    assert snapshot.partner_lookup_requests["found"] == 1
    assert snapshot.partner_lookup_requests["error"] == 1
    assert snapshot.partner_upstreams[("vietqr", "timeout")] == 1
    assert snapshot.partner_upstreams[("unknown", "error")] == 1
    assert snapshot.websocket["attempted"] == 1
    assert snapshot.websocket["rejected:origin"] == 1
    assert snapshot.websocket["auth_failed:protocol"] == 1
    assert snapshot.websocket["connected"] == 2
    assert snapshot.websocket["disconnected"] == 2
    assert snapshot.websocket["reconnected"] == 1
    assert snapshot.websocket["active"] == 0
    assert snapshot.audit_chain_checks["valid"] == 1
    assert snapshot.audit_chain_available == 1
    assert snapshot.audit_chain_valid == 1
    assert snapshot.audit_chain_rows == 7
    assert snapshot.audit_chain_check_duration_seconds == pytest.approx(0.4)
    assert snapshot.audit_checkpoints["success"] == 1
    assert snapshot.audit_checkpoint_last_success_timestamp > 0

    reset_recorded_metrics_for_tests()
    reset_snapshot = snapshot_recorded_metrics()
    assert reset_snapshot.document_worker == {}
    assert reset_snapshot.partner_lookup_requests == {}
    assert reset_snapshot.partner_upstreams == {}
    assert reset_snapshot.websocket == {}
    assert reset_snapshot.audit_chain_checks == {}
    assert reset_snapshot.audit_checkpoints == {}
