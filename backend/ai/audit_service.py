"""AI audit records contain metadata only, never prompts or raw tool output."""

from __future__ import annotations

from backend.ai.redaction import redact_value, scope_hash
from backend.shared.logging_utils import log_audit


def audit_tool_execution(request, context, conversation_id, tool_name, *, mode="data", arguments, record_count, duration_ms, status, error_code=None):
    log_audit(
        "ai.tool_execution",
        actor_user_id=context.user_id,
        organization_id=context.organization_id,
        target_type="ai_conversation",
        target_id=str(conversation_id),
        request=request,
        metadata={
            "conversation_id": str(conversation_id),
            "mode": str(mode),
            "tool_name": str(tool_name),
            "arguments": redact_value(arguments),
            "permission_scope_hash": scope_hash(context),
            "record_count": int(record_count),
            "duration_ms": int(duration_ms),
            "status": str(status),
            "error_code": error_code,
        },
    )


def audit_chat(
    request,
    context,
    conversation_id,
    *,
    mode,
    status,
    model=None,
    input_tokens=0,
    output_tokens=0,
    tool_call_count=0,
    error_code=None,
):
    log_audit(
        "ai.chat",
        actor_user_id=context.user_id,
        organization_id=context.organization_id,
        target_type="ai_conversation",
        target_id=str(conversation_id),
        request=request,
        metadata={
            "conversation_id": str(conversation_id),
            "mode": mode,
            "status": status,
            "model": str(model or ""),
            "input_tokens": max(0, int(input_tokens or 0)),
            "output_tokens": max(0, int(output_tokens or 0)),
            "tool_call_count": max(0, int(tool_call_count or 0)),
            "error_code": error_code,
        },
    )
