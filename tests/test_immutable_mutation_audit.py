import re

from backend.sync.mutation_audit import build_mutation_audit_event


def test_mutation_audit_uses_hashes_and_field_names_without_raw_sensitive_values():
    event = build_mutation_audit_event(
        "nha_thau",
        {
            "id": "contractor-1",
            "organization_id": "org-1",
            "ten_nha_thau": "Nhà thầu A",
            "so_tai_khoan": "000011112222",
            "session_token": "old-secret",
        },
        {
            "id": "contractor-1",
            "organization_id": "org-1",
            "ten_nha_thau": "Nhà thầu A",
            "so_tai_khoan": "999988887777",
            "session_token": "new-secret",
        },
        client_mutation_id="mutation-audit-1",
        request_id="request-audit-1",
    )

    assert event.action == "sync.record_updated"
    assert event.target_type == "nha_thau"
    assert event.target_id == "contractor-1"
    assert event.metadata["changedFields"] == ["so_tai_khoan"]
    assert re.fullmatch(r"[0-9a-f]{64}", event.metadata["beforeHash"])
    assert re.fullmatch(r"[0-9a-f]{64}", event.metadata["afterHash"])
    assert event.metadata["clientMutationId"] == "mutation-audit-1"
    assert event.metadata["requestId"] == "request-audit-1"
    serialized = repr(event.metadata)
    assert "000011112222" not in serialized
    assert "999988887777" not in serialized
    assert "old-secret" not in serialized
    assert "new-secret" not in serialized


def test_unchanged_record_does_not_create_material_audit_event():
    record = {"id": "package-1", "organization_id": "org-1", "name": "Same"}

    assert build_mutation_audit_event(
        "goi_thau",
        record,
        dict(record),
        client_mutation_id="mutation-audit-2",
        request_id=None,
    ) is None
