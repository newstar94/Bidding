# ruff: noqa: S608 - dynamic SQL uses only the static TABLE_KEYS registry
"""Bounded, snapshot-stable delta synchronization pages."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

from starlette.responses import JSONResponse

from backend.shared.access_policy import can_read_record
from backend.shared.database_io import run_database_read
from backend.shared.helpers import database, get_active_org, verify_session
from backend.shared.media_helper import public_image_path
from backend.shared.sensitive_data import (
    resolve_sensitive_read_policy,
    serialize_sensitive_read_item,
)
from backend.sync.conflict_projection import project_conflict_record
from backend.sync.mapper import attach_child_rows_to_items, map_db_to_json
from backend.sync.queries import TABLE_KEYS
from backend.sync.visibility_epoch import build_visibility_token
from backend.sync.visibility_scope import VisibilityScope, scoped_deletion_branches


_CURSOR_VERSION = 1
_TABLE_KEYS_BY_NAME = {table: key for key, table in TABLE_KEYS.items()}
_CHILD_BEARING_TABLES = frozenset({
    "ke_hoach_lcnt",
    "goi_thau",
    "nha_thau",
    "thong_tin_mo_thau",
})


class DeltaCursorError(ValueError):
    pass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _binding(organization_id: str, user_id: str) -> str:
    return hashlib.sha256(f"{organization_id}\n{user_id}".encode()).hexdigest()


def encode_delta_cursor(
    *, signing_key, organization_id, user_id, after_version,
    through_version, marker, expires_at, visibility_token=None,
) -> str:
    payload = {
        "v": _CURSOR_VERSION,
        "bind": _binding(organization_id, user_id),
        "after": int(after_version),
        "through": int(through_version),
        "marker": list(marker),
        "exp": int(expires_at),
        "visibility": str(visibility_token or ""),
    }
    encoded = _b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    )
    signature = hmac.new(
        str(signing_key).encode(), encoded.encode(), hashlib.sha256
    ).digest()
    return f"{encoded}.{_b64encode(signature)}"


def decode_delta_cursor(
    value, *, signing_key, organization_id, user_id, now=None,
):
    try:
        encoded, supplied_signature = str(value).split(".", 1)
        expected_signature = hmac.new(
            str(signing_key).encode(), encoded.encode(), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(expected_signature, _b64decode(supplied_signature)):
            raise DeltaCursorError("CURSOR_TAMPERED")
        payload = json.loads(_b64decode(encoded))
        marker = payload["marker"]
        if (
            payload.get("v") != _CURSOR_VERSION
            or payload.get("bind") != _binding(organization_id, user_id)
            or not isinstance(marker, list)
            or len(marker) != 4
        ):
            raise DeltaCursorError("CURSOR_BINDING_INVALID")
        if int(payload["exp"]) < int(now if now is not None else time.time()):
            raise DeltaCursorError("CURSOR_EXPIRED")
        payload["marker"] = (
            int(marker[0]), str(marker[1]), str(marker[2]), str(marker[3])
        )
        payload["after"] = int(payload["after"])
        payload["through"] = int(payload["through"])
        return payload
    except DeltaCursorError:
        raise
    except Exception as exc:
        raise DeltaCursorError("CURSOR_INVALID") from exc


def _bounded_int(name, default, minimum, maximum):
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _delta_union_sql(visibility_scope=None):
    statements = []
    parameters = []
    for payload_key, table_name in TABLE_KEYS.items():
        predicate = (
            visibility_scope.live_predicate(table_name, "source_row")
            if visibility_scope
            else None
        )
        visibility_sql = (
            predicate.sql if predicate else "source_row.organization_id = ?"
        )
        statements.append(
            f"""SELECT sync_version AS version, 'upsert' AS kind,
                       '{payload_key}' AS table_key, id AS record_id,
                       to_jsonb(source_row) AS record_json,
                       NULL::text AS snapshot_json
                  FROM {table_name} AS source_row
                 WHERE {visibility_sql}
                   AND sync_version > ? AND sync_version <= ?"""
        )
        parameters.extend(
            predicate.parameters if predicate else (visibility_scope.organization_id if visibility_scope else None,)
        )
        parameters.extend(("$after", "$through"))
    if visibility_scope:
        for payload_key, _table_name, predicate in scoped_deletion_branches(
            visibility_scope, "deleted_row"
        ):
            statements.append(
                f"""SELECT delete_version AS version, 'delete' AS kind,
                          '{payload_key}' AS table_key, record_id,
                          NULL::jsonb AS record_json,
                          record_snapshot_json AS snapshot_json
                     FROM deleted_records AS deleted_row
                    WHERE {predicate.sql}
                      AND delete_version > ? AND delete_version <= ?"""
            )
            parameters.extend(predicate.parameters)
            parameters.extend(("$after", "$through"))
    else:
        statements.append(
            """SELECT delete_version AS version, 'delete' AS kind,
                      table_name AS table_key, record_id,
                      NULL::jsonb AS record_json,
                      record_snapshot_json AS snapshot_json
                 FROM deleted_records
                WHERE organization_id = ?
                  AND delete_version > ? AND delete_version <= ?"""
        )
        parameters.extend((None, "$after", "$through"))
    return " UNION ALL ".join(statements), parameters


def _load_candidates(
    cursor, organization_id, after_version, through_version, marker, limit,
    visibility_scope=None,
):
    union_sql, parameter_template = _delta_union_sql(visibility_scope)
    params = [
        after_version if value == "$after"
        else through_version if value == "$through"
        else organization_id if value is None
        else value
        for value in parameter_template
    ]
    params.extend((*marker, limit))
    return cursor.execute(
        f"""SELECT version, kind, table_key, record_id,
                   record_json, snapshot_json
              FROM ({union_sql}) AS delta
             WHERE (version, kind, table_key, record_id) > (?, ?, ?, ?)
             ORDER BY version, kind, table_key, record_id
             LIMIT ?""",
        tuple(params),
    ).fetchall()


def _json_object(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _prepare_upsert_items(cursor, rows, organization_id):
    items_by_table = {}
    prepared = {}
    for row in rows:
        if str(row["kind"]) != "upsert":
            continue
        raw_table_key = str(row["table_key"])
        table_name = TABLE_KEYS.get(raw_table_key, raw_table_key)
        raw_record = _json_object(row["record_json"])
        if table_name not in TABLE_KEYS.values() or not raw_record:
            continue
        item = map_db_to_json(table_name, raw_record)
        prepared[(table_name, str(row["record_id"]))] = item
        items_by_table.setdefault(table_name, []).append(item)
    for table_name, items in items_by_table.items():
        if table_name in _CHILD_BEARING_TABLES:
            attach_child_rows_to_items(
                cursor,
                table_name,
                items,
                organization_id=organization_id,
            )
    return prepared


def _project_candidate(
    cursor, row, *, role, user_id, organization_id,
    media_session_token, sensitive_policy, prepared_upserts=None,
):
    kind = str(row["kind"])
    raw_table_key = str(row["table_key"])
    table_name = TABLE_KEYS.get(raw_table_key, raw_table_key)
    payload_key = _TABLE_KEYS_BY_NAME.get(table_name, raw_table_key)
    if payload_key not in TABLE_KEYS:
        return None
    raw_record = _json_object(
        row["record_json"] if kind == "upsert" else row["snapshot_json"]
    )
    item = (prepared_upserts or {}).get((table_name, str(row["record_id"])))
    if item is None:
        item = (
            map_db_to_json(table_name, raw_record)
            if raw_record else {"id": row["record_id"]}
        )
        if kind == "upsert" and table_name in _CHILD_BEARING_TABLES:
            attach_child_rows_to_items(
                cursor,
                table_name,
                [item],
                organization_id=organization_id,
            )
    if not can_read_record(
        cursor, role, user_id, organization_id,
        payload_key, table_name, item,
    ):
        return None
    if kind == "delete":
        return {
            "kind": "delete", "table": payload_key,
            "id": str(row["record_id"]), "version": int(row["version"]),
        }
    if table_name == "chuyen_gia":
        item["anhChungChi"] = public_image_path(
            raw_record.get("anh_chung_chi"),
            session_token=media_session_token,
            organization_id=organization_id,
        )
        item["anhChuKy"] = public_image_path(
            raw_record.get("anh_chu_ky"),
            session_token=media_session_token,
            organization_id=organization_id,
        )
    elif table_name == "nha_thau":
        item["anhDau"] = public_image_path(
            raw_record.get("anh_dau"),
            session_token=media_session_token,
            organization_id=organization_id,
        )
    item = serialize_sensitive_read_item(table_name, item, sensitive_policy)
    return {
        "kind": "upsert", "table": payload_key,
        "record": project_conflict_record(item),
        "version": int(row["version"]),
    }


def _read_delta_page_blocking(request):
    valid, role = verify_session(request)
    if not valid:
        return JSONResponse({"code": "AUTH_REQUIRED"}, status_code=403)
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        organization_id = get_active_org(request, role.user_id, cursor=cursor)
        signing_key = str(getattr(request, "cookies", {}).get("session_token", ""))
        if not signing_key:
            return JSONResponse({"code": "AUTH_REQUIRED"}, status_code=403)
        now = int(time.time())
        raw_cursor = str(request.query_params.get("cursor") or "").strip()
        if raw_cursor:
            try:
                state = decode_delta_cursor(
                    raw_cursor,
                    signing_key=signing_key,
                    organization_id=organization_id,
                    user_id=role.user_id,
                    now=now,
                )
            except DeltaCursorError as exc:
                return JSONResponse({"code": str(exc)}, status_code=400)
            after_version = state["after"]
            through_version = state["through"]
            marker = state["marker"]
        else:
            try:
                after_version = max(
                    0, int(request.query_params.get("after_version", 0))
                )
            except (TypeError, ValueError):
                return JSONResponse(
                    {"code": "SYNC_VERSION_INVALID"}, status_code=400
                )
            metadata = cursor.execute(
                "SELECT current_version FROM sync_metadata WHERE organization_id = ?",
                (organization_id,),
            ).fetchone()
            through_version = int(metadata[0] or 0) if metadata else 0
            marker = (after_version, "", "", "")
        visibility_token = build_visibility_token(
            cursor, organization_id, role.user_id, role
        )
        visibility_scope = VisibilityScope.resolve(
            cursor, role, role.user_id, organization_id
        )
        supplied_visibility = (
            str(state.get("visibility") or "")
            if raw_cursor
            else str(request.query_params.get("visibility_token") or "")
        )
        if (
            after_version > 0
            and not supplied_visibility
        ) or (
            supplied_visibility
            and not hmac.compare_digest(supplied_visibility, visibility_token)
        ):
            return JSONResponse({
                "code": "SYNC_VISIBILITY_RESET_REQUIRED",
                "requiresFullSync": True,
            }, status_code=409)
        metadata = cursor.execute(
            "SELECT min_available_version FROM sync_metadata WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
        minimum = int(metadata[0] or 0) if metadata else 0
        if after_version < minimum:
            return JSONResponse(
                {"code": "FULL_SYNC_REQUIRED", "requiresFullSync": True},
                status_code=409,
            )

        record_limit = _bounded_int("SYNC_DELTA_PAGE_ITEMS", 250, 10, 1000)
        byte_limit = _bounded_int(
            "SYNC_DELTA_PAGE_BYTES", 524_288, 16_384, 4_194_304
        )
        candidate_limit = record_limit * 4 + 1
        candidates = _load_candidates(
            cursor, organization_id, after_version,
            through_version, marker, candidate_limit,
            visibility_scope=visibility_scope,
        )
        prepared_upserts = _prepare_upsert_items(
            cursor,
            candidates,
            organization_id,
        )
        policy = resolve_sensitive_read_policy(
            cursor, role, role.user_id, organization_id
        )
        entries = []
        used_bytes = 256
        processed_marker = marker
        stopped_early = False
        for row in candidates:
            candidate_marker = (
                int(row["version"]), str(row["kind"]),
                str(row["table_key"]), str(row["record_id"]),
            )
            projected = _project_candidate(
                cursor, row, role=role, user_id=role.user_id,
                organization_id=organization_id,
                media_session_token=signing_key,
                sensitive_policy=policy,
                prepared_upserts=prepared_upserts,
            )
            projected_size = (
                len(json.dumps(
                    projected, ensure_ascii=False, default=str
                ).encode()) if projected else 0
            )
            if projected and (
                len(entries) >= record_limit
                or used_bytes + projected_size > byte_limit
            ):
                if not entries:
                    return JSONResponse(
                        {"code": "DELTA_RECORD_TOO_LARGE"}, status_code=413
                    )
                stopped_early = True
                break
            processed_marker = candidate_marker
            if projected:
                entries.append(projected)
                used_bytes += projected_size

        has_more = stopped_early or len(candidates) >= candidate_limit
        next_cursor = None
        if has_more:
            next_cursor = encode_delta_cursor(
                signing_key=signing_key,
                organization_id=organization_id,
                user_id=role.user_id,
                after_version=after_version,
                through_version=through_version,
                marker=processed_marker,
                expires_at=now + _bounded_int(
                    "SYNC_DELTA_CURSOR_TTL_SECONDS", 900, 60, 3600
                ),
                visibility_token=visibility_token,
            )
        payload = {
            "deletions": [], "partial": bool(has_more),
            "throughVersion": through_version, "nextCursor": next_cursor,
            "visibilityToken": visibility_token,
        }
        for entry in entries:
            if entry["kind"] == "delete":
                payload["deletions"].append(
                    {"table": entry["table"], "id": entry["id"]}
                )
            else:
                payload.setdefault(entry["table"], []).append(entry["record"])
        if not has_more:
            payload["syncVersion"] = through_version
        connection.commit()
        return JSONResponse(payload)
    finally:
        connection.close()


async def read_delta_page(request):
    return await run_database_read(
        _read_delta_page_blocking, request, timeout_seconds=30.0
    )
