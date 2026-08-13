from backend.sync.payload_validation import validate_sync_payload_shape
from backend.procurement_import.sync_binding import _session_records


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


def test_sync_accepts_only_bounded_source_revision_authority_on_plan_and_package():
    authority = {
        "sessionId": "session-1", "workspaceLease": "lease-1",
        "provider": "MUASAMCONG",
        "familyNo": "PL2600000001", "revisionId": "rev-00",
        "revisionNumber": "00", "revisionDigest": "sha256:" + "a" * 64,
    }
    errors = validate_sync_payload_shape({
        "clientMutationId": "mutation-1",
        "kehoach": [{"id": "plan-1", "sourceRevision": authority}],
        "goithau": [{
            "id": "package-1",
            "sourceRevision": {
                **authority, "packageObservationId": "detail-a",
                "stablePackageId": "stable-a", "packageRevisionNumber": "01",
            },
        }],
    })
    assert errors == []

    malicious = validate_sync_payload_shape({
        "clientMutationId": "mutation-2",
        "kehoach": [{
            "id": "plan-1",
            "sourceRevision": {**authority, "canonicalPayload": {"name": "fake"}},
        }],
    })
    assert any(
        error["field"].endswith("sourceRevision.canonicalPayload")
        and error["code"] == "UNKNOWN_FIELD"
        for error in malicious
    )


def test_import_authority_uses_only_records_that_carry_bounded_authority():
    def authority(number):
        return {
            "sessionId": "session-1", "workspaceLease": "lease-1",
            "provider": "MUASAMCONG",
            "familyNo": "PL2600000001", "revisionId": f"rev-{number}",
            "revisionNumber": number, "revisionDigest": "sha256:" + number[0] * 64,
        }

    context = _session_records({
        "kehoach": [
            {"id": "plan-00"},
            {"id": "plan-01", "sourceRevision": authority("01")},
        ],
        "goithau": [
            {"id": "package-00"},
            {"id": "package-01", "sourceRevision": authority("01")},
        ],
    })
    assert context["revisionNumber"] == "01"
    assert [row["id"] for row in context["plans"]] == ["plan-01"]
    assert [row["id"] for row in context["packages"]] == ["package-01"]


def test_import_authority_rejects_two_source_revisions_even_if_client_demotes_one():
    def authority(number):
        return {
            "sessionId": "session-1", "workspaceLease": "lease-1",
            "provider": "MUASAMCONG",
            "familyNo": "PL2600000001", "revisionId": f"rev-{number}",
            "revisionNumber": number, "revisionDigest": "sha256:" + "a" * 64,
        }

    import pytest

    with pytest.raises(ValueError, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        _session_records({
            "kehoach": [
                {"id": "plan-00", "isLatest": 0, "sourceRevision": authority("00")},
                {"id": "plan-01", "isLatest": 1, "sourceRevision": authority("01")},
            ],
        })
from backend.sync.record_validator import historical_record_mutation_error


def test_generic_sync_rejects_historical_plan_and_package_mutation():
    for table_name in ("ke_hoach_lcnt", "goi_thau"):
        error = historical_record_mutation_error(
            table_name, {"id": "historical", "is_latest": 0}
        )
        assert error["code"] == "HISTORICAL_RECORD_IMMUTABLE"
    assert historical_record_mutation_error(
        "goi_thau", {"id": "latest", "is_latest": 1}
    ) is None
