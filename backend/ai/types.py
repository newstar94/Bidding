"""Typed request and scope objects used by the gateway."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


MODES = frozenset({"data", "procurement_advice", "app_help"})


@dataclass(frozen=True)
class AiRequestContext:
    user_id: str
    organization_id: str
    organization_name: str
    platform_role: str
    membership_role: str
    scope_type: str
    active_role: str = ""
    permissions: dict[str, str] = field(default_factory=dict)
    timezone: str = "Asia/Bangkok"

    def permission_hash_payload(self) -> dict[str, Any]:
        return {
            "userId": self.user_id,
            "organizationId": self.organization_id,
            "scopeType": self.scope_type,
            "permissions": dict(sorted(self.permissions.items())),
        }


@dataclass(frozen=True)
class ToolResult:
    tool_name: str
    scope: dict[str, str]
    filters: dict[str, Any]
    summary: dict[str, Any]
    records: list[dict[str, Any]] = field(default_factory=list)
    generated_at: str = ""
    source_links: list[dict[str, str]] = field(default_factory=list)
    status: str = "ok"
    missing_fields: list[str] = field(default_factory=list)

    @property
    def record_count(self) -> int:
        return len(self.records)

    def as_dict(self) -> dict[str, Any]:
        return {
            "scope": self.scope,
            "filters": self.filters,
            "summary": self.summary,
            "records": self.records,
            "generatedAt": self.generated_at,
            "sourceLinks": self.source_links,
            "status": self.status,
            "missingFields": self.missing_fields,
        }
