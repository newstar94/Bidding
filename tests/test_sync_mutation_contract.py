from backend.sync.payload_validation import validate_sync_payload_shape


def test_mutating_sync_payload_requires_client_mutation_id():
    errors = validate_sync_payload_shape({
        "goithau": [{"id": "package-1"}],
        "baseSyncVersion": 1,
    })

    assert any(
        error["field"] == "clientMutationId"
        and error["code"] == "MUTATION_ID_REQUIRED"
        for error in errors
    )


def test_read_only_sync_payload_does_not_require_client_mutation_id():
    errors = validate_sync_payload_shape({"includeDashboardSummary": True})

    assert not any(error["field"] == "clientMutationId" for error in errors)
