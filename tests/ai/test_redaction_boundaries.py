import pytest
import json
from types import SimpleNamespace

from backend.ai.redaction import redact_value


@pytest.mark.parametrize("text", ["Ngày 2026-09-12", "Giá 1.000.000.000 VND", "Giá 123456789 VND"])
def test_audit_redaction_preserves_dates_and_amounts(text):
    assert redact_value(text) == text


def test_long_text_never_exposes_partial_secret_at_cutoff():
    text = "a " * 994 + "github_pat_12345678901234567890"
    assert "github_pat" not in redact_value(text)


@pytest.mark.parametrize("phone", ["0912345678", "+84 912 345 678", "+1 202 555 0198"])
def test_recognized_phone_is_removed(phone):
    assert phone not in redact_value(f"Liên hệ {phone}")


def test_tool_audit_sanitizes_arguments_without_losing_forensic_metadata(monkeypatch):
    from backend.ai import audit_service

    recorded = []
    monkeypatch.setattr(audit_service, "log_audit", lambda event, **fields: recorded.append((event, fields)))
    context = SimpleNamespace(user_id="user-a", organization_id="org-a",
                              permission_hash_payload=lambda: {"user": "user-a", "org": "org-a"})
    arguments = {"query": "Liên hệ person@example.test; Bearer abc-secret", "limit": 20}
    audit_service.audit_tool_execution(
        None, context, "conversation-a", "search_workspace", arguments=arguments,
        record_count=7, duration_ms=42, status="completed",
    )
    event, fields = recorded[0]
    assert event == "ai.tool_execution"
    assert fields["actor_user_id"] == "user-a"
    assert fields["organization_id"] == "org-a"
    metadata = fields["metadata"]
    assert metadata["record_count"] == 7
    assert metadata["duration_ms"] == 42
    assert metadata["arguments"]["limit"] == 20
    assert len(metadata["permission_scope_hash"]) == 24
    serialized = json.dumps(fields, ensure_ascii=False)
    assert "person@example.test" not in serialized
    assert "abc-secret" not in serialized
    assert arguments["query"].endswith("Bearer abc-secret")
