"""Prepare-confirm staged export of full authorized record projections."""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone

from backend.db.id_utils import generate_record_id
from backend.shared.idempotency import acquire_idempotency_lock
from backend.sync.mapper import attach_child_rows_to_items, map_db_to_json

from .registry import resolve_action
from .storage import publish_bytes, storage_key


TABLES = {"kehoach": "ke_hoach_lcnt", "goithau": "goi_thau"}
CODE_FIELDS = {"kehoach": "ma_ke_hoach", "goithau": "ma_goi_thau"}
TITLE_FIELDS = {"kehoach": "ten_ke_hoach", "goithau": "ten_goi_thau"}
PREVIEW_TTL = timedelta(minutes=10)
ARTIFACT_TTL = timedelta(hours=24)
MAX_ZIP_BYTES = 100 * 1024 * 1024


class BulkOperationError(ValueError):
    def __init__(self, code, *, status_code=400, fields=None):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.fields = fields or {}


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), default=str)


def _sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_name(value, fallback):
    result = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip(".-")
    return (result[:100] or fallback)


class BulkOperationService:
    def __init__(self, cursor):
        self.cursor = cursor

    def prepare(self, organization_id, actor_user_id, action_key, target_type,
                selection_mode, record_ids, visibility):
        action = resolve_action(action_key)
        if not action:
            raise BulkOperationError("BULK_ACTION_UNSUPPORTED")
        if target_type not in action.target_types:
            raise BulkOperationError("BULK_TARGET_UNSUPPORTED")
        if selection_mode != "EXPLICIT_IDS":
            raise BulkOperationError("BULK_SELECTION_MODE_UNSUPPORTED")
        if not isinstance(record_ids, list) or not record_ids:
            raise BulkOperationError("BULK_SELECTION_REQUIRED")
        ids = [str(value or "").strip() for value in record_ids]
        if any(not value for value in ids) or len(ids) != len(set(ids)):
            raise BulkOperationError("BULK_SELECTION_INVALID")
        if len(ids) > action.max_size:
            raise BulkOperationError("BULK_SELECTION_TOO_LARGE")
        rows = self._visible_rows(target_type, ids, visibility)
        if len(rows) != len(ids):
            raise BulkOperationError("BULK_SELECTION_DENIED", status_code=403)
        by_id = {str(row["id"]): row for row in rows}
        ordered = [by_id[value] for value in ids]
        items = [{
            "id": row["id"], "rowVersion": int(row["row_version"]),
            "code": row.get(CODE_FIELDS[target_type]) or row["id"],
            "title": row.get(TITLE_FIELDS[target_type]) or "",
        } for row in ordered]
        operation_id = generate_record_id("bulk-operation")
        selection_hash = _sha(_canonical(ids))
        expires_at = _iso(datetime.now(timezone.utc) + PREVIEW_TTL)
        preview = {
            "operationId": operation_id, "actionKey": action.key,
            "contractVersion": action.version, "targetType": target_type,
            "selectionMode": selection_mode, "selectionHash": selection_hash,
            "execution": action.execution,
            "sideEffectBoundary": action.side_effect_boundary,
            "expiresAt": expires_at, "items": items,
        }
        self.cursor.execute(
            """INSERT INTO bulk_operation
                 (organization_id, id, actor_user_id, action_key,
                  contract_version, target_type, selection_mode,
                  selection_json, selection_hash, dependency_json,
                  preview_json, status, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREVIEW_READY', ?)""",
            (organization_id, operation_id, actor_user_id, action.key,
             action.version, target_type, selection_mode, _canonical(ids),
             selection_hash,
             _canonical({item["id"]: item["rowVersion"] for item in items}),
             _canonical(preview), expires_at),
        )
        for item in items:
            self.cursor.execute(
                """INSERT INTO bulk_operation_item
                     (organization_id, id, operation_id, target_id,
                      expected_row_version, display_code, display_title)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (organization_id, generate_record_id("bulk-item"), operation_id,
                 item["id"], item["rowVersion"], item["code"], item["title"]),
            )
        return preview

    def confirm(self, organization_id, actor_user_id, operation_id,
                idempotency_key, visibility):
        acquire_idempotency_lock(
            self.cursor, "bulk_operation", organization_id, actor_user_id,
            idempotency_key,
        )
        request_hash = _sha(f"{operation_id}:{idempotency_key}")
        replay = self.cursor.execute(
            """SELECT request_hash, result_json FROM bulk_operation
                WHERE organization_id = ? AND actor_user_id = ?
                  AND idempotency_key = ? AND status = 'COMPLETED'""",
            (organization_id, actor_user_id, idempotency_key),
        ).fetchone()
        if replay:
            if replay[0] != request_hash:
                raise BulkOperationError(
                    "BULK_IDEMPOTENCY_KEY_REUSED", status_code=409
                )
            return json.loads(replay[1]), None
        row = self.cursor.execute(
            """SELECT action_key, contract_version, target_type, selection_json,
                      dependency_json, status, expires_at
                 FROM bulk_operation
                WHERE organization_id = ? AND id = ? AND actor_user_id = ?
                FOR UPDATE""",
            (organization_id, operation_id, actor_user_id),
        ).fetchone()
        if not row:
            raise BulkOperationError("BULK_OPERATION_NOT_FOUND", status_code=404)
        if row[5] != "PREVIEW_READY":
            raise BulkOperationError("BULK_OPERATION_STATE_INVALID", status_code=409)
        if datetime.fromisoformat(str(row[6]).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            self.cursor.execute(
                "UPDATE bulk_operation SET status = 'STALE' WHERE organization_id = ? AND id = ?",
                (organization_id, operation_id),
            )
            return None, "BULK_PREVIEW_EXPIRED"
        action = resolve_action(row[0])
        if not action or action.version != row[1]:
            return None, "BULK_CONTRACT_STALE"
        ids = json.loads(row[3])
        expected = json.loads(row[4])
        records = self._visible_rows(row[2], ids, visibility)
        if len(records) != len(ids) or any(
            int(record["row_version"]) != int(expected.get(str(record["id"]), -1))
            for record in records
        ):
            self.cursor.execute(
                "UPDATE bulk_operation SET status = 'STALE' WHERE organization_id = ? AND id = ?",
                (organization_id, operation_id),
            )
            return None, "BULK_PREVIEW_STALE"
        records_by_id = {str(record["id"]): record for record in records}
        records = [records_by_id[str(record_id)] for record_id in ids]
        self.cursor.execute(
            """UPDATE bulk_operation SET status = 'PROCESSING',
                      idempotency_key = ?, request_hash = ?,
                      confirmed_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ?""",
            (idempotency_key, request_hash,
             organization_id, operation_id),
        )
        projections = self._projections(row[2], records, organization_id)
        content = self._zip(row[2], projections)
        key = storage_key(organization_id, operation_id)
        publish_bytes(key, content)
        digest = hashlib.sha256(content).hexdigest()
        artifact_id = generate_record_id("bulk-artifact")
        expires_at = _iso(datetime.now(timezone.utc) + ARTIFACT_TTL)
        filename = f"biddingflow-{row[2]}-{operation_id}.zip"
        self.cursor.execute(
            """INSERT INTO bulk_operation_artifact
                 (organization_id, id, operation_id, storage_key, filename,
                  media_type, byte_size, sha256, expires_at)
               VALUES (?, ?, ?, ?, ?, 'application/zip', ?, ?, ?)""",
            (organization_id, artifact_id, operation_id, key, filename,
             len(content), digest, expires_at),
        )
        result = {
            "operationId": operation_id, "status": "COMPLETED",
            "recordCount": len(projections), "artifactId": artifact_id,
            "sha256": digest, "byteSize": len(content),
            "expiresAt": expires_at,
        }
        self.cursor.execute(
            """UPDATE bulk_operation SET status = 'COMPLETED', result_json = ?,
                      completed_at = CURRENT_TIMESTAMP
                WHERE organization_id = ? AND id = ?""",
            (_canonical(result), organization_id, operation_id),
        )
        return result, None

    def artifact(self, organization_id, actor_user_id, operation_id, visibility):
        row = self.cursor.execute(
            """SELECT operation.target_type, operation.selection_json,
                      artifact.id, artifact.storage_key, artifact.filename,
                      artifact.media_type, artifact.byte_size, artifact.sha256,
                      artifact.expires_at
                 FROM bulk_operation AS operation
                 JOIN bulk_operation_artifact AS artifact
                   ON artifact.organization_id = operation.organization_id
                  AND artifact.operation_id = operation.id
                WHERE operation.organization_id = ? AND operation.id = ?
                  AND operation.actor_user_id = ? AND operation.status = 'COMPLETED'""",
            (organization_id, operation_id, actor_user_id),
        ).fetchone()
        if not row:
            raise BulkOperationError("BULK_ARTIFACT_NOT_FOUND", status_code=404)
        if datetime.fromisoformat(str(row[8]).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
            raise BulkOperationError("BULK_ARTIFACT_EXPIRED", status_code=410)
        ids = json.loads(row[1])
        if len(self._visible_rows(row[0], ids, visibility)) != len(ids):
            raise BulkOperationError("BULK_ARTIFACT_ACCESS_DENIED", status_code=403)
        return {"id": row[2], "storageKey": row[3], "filename": row[4],
                "mediaType": row[5], "byteSize": int(row[6]),
                "sha256": row[7]}

    def cancel(self, organization_id, actor_user_id, operation_id):
        result = self.cursor.execute(
            """UPDATE bulk_operation SET status = 'CANCELLED'
                WHERE organization_id = ? AND id = ? AND actor_user_id = ?
                  AND status = 'PREVIEW_READY'""",
            (organization_id, operation_id, actor_user_id),
        )
        if int(result.rowcount or 0) != 1:
            raise BulkOperationError("BULK_CANCEL_NOT_ALLOWED", status_code=409)
        return {"operationId": operation_id, "status": "CANCELLED"}

    def _visible_rows(self, target_type, ids, visibility):
        table = TABLES[target_type]
        predicate = visibility.live_predicate(table, "record")
        rows = self.cursor.execute(
            f"""SELECT record.* FROM {table} AS record
                 WHERE {predicate.sql} AND record.id = ANY(?)
                   AND record.archived_at IS NULL""",  # noqa: S608
            (*predicate.parameters, ids),
        ).fetchall()
        return [dict(row) for row in rows]

    def _projections(self, target_type, records, organization_id):
        table = TABLES[target_type]
        items = [map_db_to_json(table, record) for record in records]
        attach_child_rows_to_items(
            self.cursor, table, items, organization_id=organization_id
        )
        by_id = {str(item["id"]): item for item in items}
        return [by_id[str(record["id"])] for record in records]

    @staticmethod
    def _zip(target_type, projections):
        buffer = io.BytesIO()
        manifest = []
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, projection in enumerate(projections, start=1):
                code = projection.get("maKeHoach" if target_type == "kehoach" else "maGoiThau")
                filename = f"records/{index:03d}-{_safe_name(code, str(index))}.json"
                raw = json.dumps(projection, ensure_ascii=False, sort_keys=True,
                                 indent=2, default=str).encode("utf-8")
                archive.writestr(filename, raw)
                manifest.append({"id": projection.get("id"), "file": filename,
                                 "sha256": hashlib.sha256(raw).hexdigest()})
            archive.writestr("manifest.json", json.dumps(
                {"schemaVersion": "export-record-data-v1", "records": manifest},
                ensure_ascii=False, sort_keys=True, indent=2,
            ).encode("utf-8"))
        content = buffer.getvalue()
        if len(content) > MAX_ZIP_BYTES:
            raise BulkOperationError("BULK_ARTIFACT_TOO_LARGE")
        return content
