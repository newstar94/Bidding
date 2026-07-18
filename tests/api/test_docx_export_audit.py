from types import SimpleNamespace

import pytest

from backend.documents import routes_docx


class _Role:
    user_id = "user-1"

    def __str__(self):
        return "employee"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("export_kind", "document_type", "target_type"),
    [
        ("plan", "plan", "ke_hoach_lcnt"),
        ("report", "evaluation", "goi_thau"),
    ],
)
async def test_word_export_audit_records_scope_and_groups_without_raw_pii(
    monkeypatch,
    export_kind,
    document_type,
    target_type,
):
    audit_calls = []
    request = SimpleNamespace(
        path_params={
            "plan_id" if export_kind == "plan" else "package_id": "record-1"
        },
        query_params={"type": document_type} if export_kind == "report" else {},
    )
    context = (
        {"ke_hoach": {"ma_ke_hoach": "KH-01"}}
        if export_kind == "plan"
        else {"goi_thau": {"ma_goi_thau": "GT-01"}}
    )

    async def fake_database_read(function, *args, **kwargs):
        expected = (
            routes_docx._prepare_plan_render
            if export_kind == "plan"
            else routes_docx._prepare_report_render
        )
        assert function is expected
        assert kwargs["timeout_seconds"] == 30
        return (
            context,
            {"version": 1},
            [],
            "template.docx",
            ["financial", "identity", "signature"],
        )

    async def fake_document_job(operation, payload):
        assert operation == "render_docx"
        assert payload["context"] is context
        return b"safe-docx"

    monkeypatch.setattr(routes_docx, "verify_session", lambda _request: (True, _Role()))
    monkeypatch.setattr(routes_docx, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(
        routes_docx,
        "_validate_export_snapshot",
        lambda *_args: (7, None),
    )
    monkeypatch.setattr(routes_docx, "_can_export_record", lambda *_args: True)
    monkeypatch.setattr(routes_docx, "run_database_read", fake_database_read)
    monkeypatch.setattr(routes_docx, "run_document_job_async", fake_document_job)
    monkeypatch.setattr(
        routes_docx,
        "_ensure_export_snapshot_unchanged",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        routes_docx,
        "log_audit",
        lambda event, **kwargs: audit_calls.append((event, kwargs)),
    )

    response = (
        await routes_docx.export_plan_api(request)
        if export_kind == "plan"
        else await routes_docx.export_report_api(request)
    )

    assert response.status_code == 200
    assert len(audit_calls) == 1
    event, audit = audit_calls[0]
    assert event == "document.word_exported"
    assert audit["actor_user_id"] == "user-1"
    assert audit["organization_id"] == "org-1"
    assert audit["required"] is True
    assert audit["target_type"] == target_type
    assert audit["target_id"] == "record-1"
    assert audit["metadata"] == {
        "organization_id": "org-1",
        "document_type": document_type,
        "sensitive_capabilities_used": ["financial", "identity", "signature"],
    }
    serialized_audit = repr(audit)
    assert "123456789" not in serialized_audit
    assert "001234567890" not in serialized_audit
    assert "stamp.png" not in serialized_audit
