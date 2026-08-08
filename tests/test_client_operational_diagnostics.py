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
