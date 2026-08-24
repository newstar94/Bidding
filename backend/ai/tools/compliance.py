"""Strict read-only adapter for deterministic compliance context."""

from __future__ import annotations

import os
from urllib.parse import urlparse

from backend.ai.errors import ai_error
from backend.ai.types import ToolResult
from backend.auth.auth_helper import SessionRole
from backend.compliance import ComplianceContext
from backend.compliance.repository import ComplianceContextRepository
from backend.legal_versioning.routes import legal_versioning_enabled
from backend.sync.visibility_scope import VisibilityScope


def compliance_tool_enabled(environ=None):
    environment = os.environ if environ is None else environ
    return (
        str(environment.get("AI_COMPLIANCE_ENABLED", "false")).strip().casefold() == "true"
        and legal_versioning_enabled(environment)
    )


def compliance_tool_definitions():
    if not compliance_tool_enabled():
        return []
    return [{
        "type": "function",
        "name": "get_compliance_context",
        "description": "Đọc finding deadline/timeline-readiness deterministic của đúng phiên bản đã được phân quyền. Không tạo kết luận pháp lý hoặc thay đổi dữ liệu.",
        "parameters": {
            "type": "object",
            "properties": {
                "targetType": {"type": "string", "enum": ["kehoach", "goithau"]},
                "targetId": {"type": "string", "minLength": 1, "maxLength": 200},
                "versionId": {"type": ["string", "null"], "maxLength": 200},
            },
            "required": ["targetType", "targetId", "versionId"],
            "additionalProperties": False,
        },
        "strict": True,
    }]


def _role(context):
    return SessionRole(
        context.active_role or context.platform_role,
        context.user_id,
        platform_role=context.platform_role,
        active_role=context.active_role or None,
        active_role_organization_id=context.organization_id,
    )


def execute_compliance_tool(cursor, context, arguments):
    scope = VisibilityScope.resolve(
        cursor, _role(context), context.user_id, context.organization_id
    )
    snapshot = ComplianceContext(
        ComplianceContextRepository(cursor, scope)
    ).get_snapshot(arguments)
    if snapshot is None:
        raise ai_error(
            "AI_PERMISSION_DENIED",
            "Không tìm thấy phiên bản trong phạm vi được phép đọc.",
            status_code=404,
        )
    counts = {status: 0 for status in ("PASS", "FAIL", "NEEDS_REVIEW", "NOT_EVALUATED")}
    for finding in snapshot["findings"]:
        counts[finding["result"]] = counts.get(finding["result"], 0) + 1
    target_url = (
        f"/ke-hoach/{snapshot['target']['exactVersionId']}"
        if snapshot["target"]["type"] == "kehoach"
        else f"/goi-thau-chi-tiet/{snapshot['target']['exactVersionId']}"
    )
    links = [{"label": "Bản ghi được kiểm tra", "url": target_url}]
    for source in snapshot["legalBinding"]["sources"]:
        parsed = urlparse(str(source.get("sourceUri") or ""))
        if parsed.scheme == "https" and parsed.netloc and not parsed.username:
            links.append({
                "label": f"{source.get('documentType') or ''} {source.get('documentNumber') or source.get('title') or ''}".strip(),
                "url": source["sourceUri"],
                "title": source.get("title") or "Nguồn pháp lý chính xác",
                "effectiveFrom": source.get("effectiveFrom"),
            })
    return ToolResult(
        tool_name="get_compliance_context",
        scope={"organizationId": context.organization_id, "targetType": snapshot["target"]["type"]},
        filters={"targetId": snapshot["target"]["id"], "versionId": snapshot["target"]["exactVersionId"]},
        summary={
            "snapshotVersion": snapshot["snapshotVersion"],
            "bundleVersionId": snapshot["complianceBundle"]["bundleVersionId"],
            "findingCounts": counts,
            "notEvaluatedCount": len(snapshot["notEvaluated"]),
        },
        records=[snapshot],
        source_links=links,
        status="ok",
    )
