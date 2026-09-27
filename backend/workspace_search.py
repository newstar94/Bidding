"""Bounded, ordinary search for top-level records in the active workspace."""

from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.routing import Route

from backend.ai.errors import AiError
from backend.ai.permission_context import build_request_context
from backend.analytics.query_scope import visibility_clause
from backend.db.db_helper import DatabaseError
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import database
from backend.shared.logging_utils import error_response, log_error
from backend.shared.request_validation import read_json_object
from backend.auth.session_utils import OrgPermissionError


# Only ordinary codes and names. New fields or entities need their own access and
# query-cost review; in particular this must not search identity or document data.
SEARCH_ENTITIES = {
    "plans": ("ke_hoach_lcnt", "ma_ke_hoach", "ten_ke_hoach"),
    "packages": ("goi_thau", "ma_goi_thau", "ten_goi_thau"),
    "contracts": ("hop_dong", "so_hop_dong", "ten_hop_dong"),
}


def _search_records(context, entity: str, query: str, limit: int, offset: int):
    table, code_column, name_column = SEARCH_ENTITIES[entity]
    scope_sql, scope_params = visibility_clause(context, entity, "record")
    # Literal matching keeps '%' and '_' in a user query from widening a scan.
    pattern = "%" + query.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        rows = cursor.execute(
            f"SELECT record.id, record.{code_column} AS code, record.{name_column} AS name "  # noqa: S608 - fixed allowlist
            f"FROM {table} AS record WHERE {scope_sql} "
            "AND record.is_latest = 1 AND record.archived_at IS NULL "
            f"AND (LOWER(COALESCE(record.{code_column}, '')) LIKE ? ESCAPE '\\' "
            f"OR LOWER(COALESCE(record.{name_column}, '')) LIKE ? ESCAPE '\\') "
            "ORDER BY record.updated_at DESC NULLS LAST, record.id DESC LIMIT ? OFFSET ?",
            (*scope_params, pattern, pattern, limit + 1, offset),
        ).fetchall()
        items = [
            {"id": str(row["id"]), "code": row["code"], "name": row["name"], "entity": entity}
            for row in rows[:limit]
        ]
        return {"items": items, "hasMore": len(rows) > limit, "nextOffset": offset + limit if len(rows) > limit else None}
    finally:
        connection.close()


async def search_workspace_api(request):
    payload, error = await read_json_object(request)
    if error:
        return error
    entity = payload.get("entity")
    query = payload.get("query")
    limit = payload.get("limit", 20)
    offset = payload.get("offset", 0)
    if (
        entity not in SEARCH_ENTITIES
        or not isinstance(query, str) or not 2 <= len(query.strip()) <= 100
        or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20
        or not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= 1000
    ):
        return error_response(request, "WORKSPACE_SEARCH_INVALID", "Điều kiện tìm kiếm không hợp lệ.", status_code=422)
    try:
        context = await run_database_read(build_request_context, request, timeout_seconds=10)
        result = await run_database_read(_search_records, context, entity, query.strip(), limit, offset, timeout_seconds=10)
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})
    except AiError as exc:
        return error_response(request, exc.code, exc.message, status_code=exc.status_code)
    except (DatabaseError, OrgPermissionError, BlockingIOBusyError, BlockingIOTimeoutError) as exc:
        log_error(exc, "workspace_search")
        return error_response(request, "WORKSPACE_SEARCH_UNAVAILABLE", "Không thể tìm kiếm lúc này.", status_code=503)


workspace_search_routes = [Route("/api/workspace-search", search_workspace_api, methods=["POST"])]
