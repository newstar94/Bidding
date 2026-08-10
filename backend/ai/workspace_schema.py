"""Safe, model-visible metadata for the workspace business schema.

The model receives logical entities, columns and foreign-key relationships,
never arbitrary database/system tables. Query execution remains in this
allowlisted workspace-query module so tenant scope and permissions cannot be
overridden by model-generated SQL.
"""

# ruff: noqa: S608 - SQL fragments are built only from code-owned allowlists.

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from backend.ai.errors import ai_error
from backend.ai.types import AiRequestContext, ToolResult
from backend.ai.workspace_search import ENTITY_SPECS, _optional_filter, _scope, _value
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.shared.domain_enums import enum_code


_FOREIGN_KEY_PATTERN = re.compile(
    r"FOREIGN\s+KEY\s*\((?P<local>[^)]+)\)\s+REFERENCES\s+"
    r"(?P<table>[a-zA-Z0-9_]+)\s*\((?P<remote>[^)]+)\)",
    re.IGNORECASE,
)


def _split_columns(value: str) -> list[str]:
    return [item.strip().strip('"') for item in value.split(",") if item.strip()]


def _table_definition(table: str) -> dict[str, Any]:
    definition = SCHEMA_DINH_NGHIA.get(table) or {}
    return definition if isinstance(definition, dict) else {}


def _primary_keys(definition: dict[str, Any]) -> list[str]:
    explicit = definition.get("primary_keys")
    if isinstance(explicit, list):
        return [str(item) for item in explicit]
    columns = definition.get("columns") or {}
    return [str(name) for name, sql_type in columns.items() if "PRIMARY KEY" in str(sql_type).upper()]


def _relationships(spec, allowed_tables: set[str]) -> list[dict[str, Any]]:
    definition = _table_definition(spec.table)
    relationships: list[dict[str, Any]] = []
    for foreign_key in definition.get("foreign_keys") or ():
        match = _FOREIGN_KEY_PATTERN.search(str(foreign_key))
        if not match or match.group("table") not in allowed_tables:
            continue
        target_table = match.group("table")
        target_entity = next(
            (key for key, target in ENTITY_SPECS.items() if target.table == target_table),
            target_table,
        )
        relationships.append({
            "type": "many_to_one",
            "columns": _split_columns(match.group("local")),
            "targetEntity": target_entity,
            "targetTable": target_table,
            "targetColumns": _split_columns(match.group("remote")),
        })
    return relationships


def _visible_specs(context: AiRequestContext):
    return [spec for spec in ENTITY_SPECS.values() if context.permissions.get(spec.module)]


_FORBIDDEN_QUERY_COLUMNS = frozenset({
    "mat_khau", "token_hash", "credential", "client_secret", "secret_key",
    "snapshot_json", "source_payload", "storage_key",
})


def _field_options(spec) -> dict[str, str]:
    definition = _table_definition(spec.table)
    columns = set((definition.get("columns") or {}).keys())
    options = {
        output: column
        for output, column in spec.projection
        if column in columns and column not in _FORBIDDEN_QUERY_COLUMNS
    }
    for column in columns:
        if column not in _FORBIDDEN_QUERY_COLUMNS:
            options.setdefault(column, column)
    return options


def query_workspace_records(cursor, context: AiRequestContext, arguments: dict[str, Any]) -> ToolResult:
    entity = str(arguments.get("entity") or "").strip()
    spec = ENTITY_SPECS.get(entity)
    if not spec:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "Loại dữ liệu workspace không được hỗ trợ.")
    if not context.permissions.get(spec.module):
        raise ai_error("AI_PERMISSION_DENIED", "Bạn không có quyền xem loại dữ liệu này trong workspace hiện tại.")
    operation = str(arguments.get("operation") or "list").strip()
    if operation not in {"count", "list"}:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "operation không hợp lệ.")
    field_options = _field_options(spec)
    requested_fields = arguments.get("fields") or []
    if (
        not isinstance(requested_fields, list)
        or len(requested_fields) > 20
        or any(not isinstance(field, str) for field in requested_fields)
        or len(set(requested_fields)) != len(requested_fields)
        or any(field not in field_options for field in requested_fields)
    ):
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "fields chứa cột không được phép trong schema.")
    selected_fields = requested_fields or [output for output, _ in spec.projection if output in field_options]
    query = _optional_filter(arguments.get("query"), 200)
    status = _optional_filter(arguments.get("status"), 120)
    package_id = _optional_filter(arguments.get("packageId"), 160)
    limit = arguments.get("limit", 20)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 50:
        raise ai_error("AI_TOOL_INVALID_ARGUMENTS", "limit phải nằm trong khoảng 1-50.")
    alias = "record"
    where, params = _scope(spec, context, alias)
    if spec.latest:
        where.append(f"{alias}.is_latest = 1")
    if spec.archived:
        where.append(f"{alias}.archived_at IS NULL")
    if status and spec.status_column:
        status = enum_code(spec.table, spec.status_column, status)
        where.append(f"{alias}.{spec.status_column} = ?")
        params.append(status)
    if package_id and spec.parent_column:
        where.append(f"{alias}.{spec.parent_column} = ?")
        params.append(package_id)
    elif package_id and spec.key == "packages":
        where.append(f"{alias}.id = ?")
        params.append(package_id)
    if query and spec.searchable:
        where.append("(" + " OR ".join(f"LOWER(COALESCE({alias}.{column}, '')) LIKE ?" for column in spec.searchable) + ")")
        params.extend([f"%{query.casefold()}%"] * len(spec.searchable))
    where_sql = " AND ".join(where)
    if operation == "count":
        row = cursor.execute(f"SELECT COUNT(*) AS record_count FROM {spec.table} AS {alias} WHERE {where_sql}", tuple(params)).fetchone()
        count = int(_value(row, "record_count") or 0)
        records: list[dict[str, Any]] = []
    else:
        select_columns = ", ".join(f'{alias}.{field_options[output]} AS "{output}"' for output in selected_fields)
        rows = cursor.execute(
            f"SELECT {select_columns} FROM {spec.table} AS {alias} WHERE {where_sql} "
            f"ORDER BY {alias}.{spec.order_column} DESC NULLS LAST LIMIT ?",
            tuple(params + [limit]),
        ).fetchall()
        records = [{output: _value(row, output) for output in selected_fields if _value(row, output) not in (None, "")} for row in rows]
        count = len(records)
    return ToolResult(
        tool_name="query_workspace",
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={"entity": entity, "fields": selected_fields, "query": query or None, "status": status or None, "packageId": package_id or None, "operation": operation},
        summary={"recordCount": count, "entity": entity, "entityLabel": spec.label, "truncated": operation == "list" and count >= limit},
        records=records,
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=[{"type": "list", "label": f"Mở danh sách {spec.label}", "url": spec.route}],
    )


def _matches(spec, query: str) -> bool:
    if not query:
        return True
    haystack = " ".join((spec.key, spec.label, spec.table, spec.module)).casefold()
    return query.casefold() in haystack


def describe_workspace_schema(
    context: AiRequestContext,
    *,
    query: str = "",
    include_relationships: bool = True,
    limit: int = 50,
) -> ToolResult:
    normalized_query = str(query or "").strip()[:200]
    safe_limit = max(1, min(50, int(limit)))
    visible_specs = _visible_specs(context)
    allowed_tables = {spec.table for spec in visible_specs}
    records: list[dict[str, Any]] = []
    for spec in visible_specs:
        if not _matches(spec, normalized_query):
            continue
        definition = _table_definition(spec.table)
        columns = list((definition.get("columns") or {}).keys())
        if not columns:
            columns = [column for _, column in spec.projection]
        record: dict[str, Any] = {
            "entity": spec.key,
            "label": spec.label,
            "table": spec.table,
            "module": spec.module,
            "columns": columns,
            "primaryKeys": _primary_keys(definition) or ["id"],
            "organizationScoped": "organization_id" in columns,
            "latestOnly": spec.latest,
            "activeOnly": spec.archived,
        }
        if include_relationships:
            record["relationships"] = _relationships(spec, allowed_tables)
        records.append(record)
        if len(records) >= safe_limit:
            break
    if not records and normalized_query:
        raise ai_error("AI_SCHEMA_NOT_FOUND", "Không tìm thấy bảng nghiệp vụ phù hợp trong schema workspace.")
    return ToolResult(
        tool_name="describe_workspace_schema",
        scope={"organizationId": context.organization_id, "organizationName": context.organization_name},
        filters={"query": normalized_query or None, "includeRelationships": include_relationships, "limit": safe_limit},
        summary={"recordCount": len(records), "tableCount": len(records), "truncated": len(records) >= safe_limit},
        records=records,
        generated_at=datetime.now().astimezone().isoformat(),
        source_links=[],
    )


def workspace_schema_tool_definitions() -> list[dict]:
    return [{
        "type": "function",
        "name": "describe_workspace_schema",
        "description": (
            "Liệt kê các bảng nghiệp vụ được phép trong workspace, cột, khóa chính và quan hệ khóa ngoại. "
            "Dùng khi cần hiểu schema trước khi chọn entity hoặc quan hệ để tra cứu. "
            "Không bao gồm bảng tài khoản, session, secret hoặc hệ thống."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "includeRelationships": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["query", "includeRelationships", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    }]


def workspace_query_tool_definitions() -> list[dict]:
    return [{
        "type": "function",
        "name": "query_workspace",
        "description": (
            "Thực hiện truy vấn đọc theo schema workspace: chọn entity, cột, bộ lọc và count/list. "
            "Backend tự sinh SQL an toàn, tự áp quyền và organization scope; không truyền raw SQL."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "entity": {"type": "string", "enum": list(ENTITY_SPECS)},
                "operation": {"type": "string", "enum": ["count", "list"]},
                "fields": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
                "query": {"type": "string"},
                "status": {"type": "string"},
                "packageId": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["entity", "operation", "fields", "query", "status", "packageId", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    }]


__all__ = [
    "describe_workspace_schema",
    "workspace_schema_tool_definitions",
    "query_workspace_records",
    "workspace_query_tool_definitions",
]
