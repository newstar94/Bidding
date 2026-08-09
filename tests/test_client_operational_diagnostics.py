import pytest

from backend.observability.client_errors import normalize_client_error_payload


@pytest.mark.parametrize(
    ("error_name", "source"),
    [
        ("Sync.Conflict", "/frontend/app/SyncPushService.js"),
        ("Sync.OfflineQueued", "/frontend/app/WorkspaceDataStore.js"),
        ("Outbox.TransportFailure", "/frontend/app/SyncPushService.js"),
        ("Outbox.StartupRetry", "/frontend/app/startupReconciliation.js"),
        ("ExcelWorker.Failure", "/frontend/documents/ExcelParseWorkerClient.js"),
        ("ExcelWorker.Fallback", "/frontend/documents/excelFileReader.js"),
        ("WebSocket.Reconnect", "/frontend/app/WebSocketSyncClient.js"),
        ("WebSocket.PollingFallback.30sTo5m", "/frontend/app/WebSocketSyncClient.js"),
        ("AggregateVersion.Conflict", "/frontend/shared/AggregateVersionClient.js"),
        ("LegacyVersionFallback.CapabilityMissing", "/frontend/shared/AggregateVersionClient.js"),
    ],
)
def test_operational_diagnostics_fit_the_pii_safe_bounded_contract(error_name, source):
    normalized, errors = normalize_client_error_payload(
        {
            "kind": "error",
            "releaseId": "test-release",
            "errorName": error_name,
            "source": source,
            "line": 0,
            "column": 0,
        }
    )

    assert errors == []
    assert normalized["errorName"] == error_name
    assert set(normalized) == {"kind", "releaseId", "errorName", "source", "line", "column"}


def test_structured_operational_diagnostic_accepts_only_bounded_redacted_dimensions():
    payload = {
        "kind": "error",
        "releaseId": "test-release",
        "errorName": "Sync.TransportFailure",
        "source": "/frontend/app/SyncPushService.js",
        "line": 0,
        "column": 0,
        "operation": "sync-push",
        "phase": "transport",
        "retryable": True,
        "backendStatus": "transport-error",
        "workspaceHash": "0123456789abcdef",
        "correlationId": "request-123",
    }

    normalized, errors = normalize_client_error_payload(payload)

    assert errors == []
    assert normalized == payload
    assert "organizationId" not in normalized
    assert "message" not in normalized


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("workspaceHash", "org-private-raw"),
        ("correlationId", "request id with spaces"),
        ("operation", "sync/prompt=private"),
        ("message", "private contractor data"),
        ("prompt", "raw AI prompt"),
        ("token", "secret"),
    ],
)
def test_operational_diagnostic_rejects_raw_or_unbounded_context(field, value):
    payload = {
        "kind": "error",
        "releaseId": "test-release",
        "errorName": "Sync.TransportFailure",
        "source": "/frontend/app/SyncPushService.js",
        "line": 0,
        "column": 0,
        field: value,
    }

    normalized, errors = normalize_client_error_payload(payload)

    assert normalized is None
    assert errors
