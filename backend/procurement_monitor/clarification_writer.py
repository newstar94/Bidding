"""ADR 0091 append of new HSMT clarifications inside the monitor publication transaction."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os

from backend.activity.service import ActivityEvent, insert_activity_events
from backend.db.db_helper import OperationalError
from backend.shared.audit_chain import EMPTY_AUDIT_HASH, insert_audit_row
from backend.shared.date_utils import vietnam_now_sql
from backend.sync.repository import next_sync_version
from backend.sync.websocket import enqueue_websocket_event

from .clarification_merge import NoticeTargetError, plan_append, resolve_notice_target
from .entitlement import auto_write_entitled


WRITTEN = "WRITTEN"
ALREADY_PRESENT = "ALREADY_PRESENT"
NEWER_REVISION = "NEWER_REVISION"
NOT_ENTITLED = "NOT_ENTITLED"
TARGET_INVALID = "TARGET_INVALID"
BUSY = "BUSY"
SYSTEM_ACTOR_NAME = "Hệ thống"
_LOCK_NOT_AVAILABLE = "55P03"


@dataclass(frozen=True)
class WriteOutcome:
    status: str
    requests: int = 0
    responses: int = 0


def auto_write_enabled(environment=None) -> bool:
    env = os.environ if environment is None else environment
    return str(env.get("PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED", "true")).strip().lower() == "true"


def _lock_nowait(cursor, sql, parameters) -> bool:
    """Take a shared serialization row without waiting.

    The caller already holds the package row. Sync saves lock these rows before
    package rows, so waiting here could close a deadlock cycle; failing fast
    leaves the write to a later attempt instead.
    """
    cursor.execute("SAVEPOINT procurement_monitor_write_lock")
    try:
        cursor.execute(sql + " FOR UPDATE NOWAIT", parameters).fetchone()
    except OperationalError as error:
        if getattr(error, "sqlstate", None) != _LOCK_NOT_AVAILABLE:
            raise
        cursor.execute("ROLLBACK TO SAVEPOINT procurement_monitor_write_lock")
        cursor.execute("RELEASE SAVEPOINT procurement_monitor_write_lock")
        return False
    cursor.execute("RELEASE SAVEPOINT procurement_monitor_write_lock")
    return True


def _lock_serialization_rows(cursor, organization_id) -> bool:
    cursor.execute(
        "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, 0) ON CONFLICT (organization_id) DO NOTHING",
        (organization_id,),
    )
    cursor.execute(
        """INSERT INTO audit_chain_heads (chain_id, last_sequence, last_log_id, last_hash)
           VALUES (?, 0, NULL, ?) ON CONFLICT (chain_id) DO NOTHING""",
        (str(organization_id), EMPTY_AUDIT_HASH),
    )
    return (
        _lock_nowait(cursor, "SELECT current_version FROM sync_metadata WHERE organization_id = ?", (organization_id,))
        and _lock_nowait(cursor, "SELECT last_sequence FROM audit_chain_heads WHERE chain_id = ?", (str(organization_id),))
    )


def append_clarifications(cursor, package, rows_by_version, *, now_epoch, slot, environment=None) -> WriteOutcome:
    """Append rows for an eligible package the caller holds ``FOR UPDATE``.

    Nothing is changed unless rows are appended. Every effect shares the
    caller's transaction, so a later rollback also discards the write.
    """
    try:
        notice_no, target_version = resolve_notice_target(package)
    except NoticeTargetError:
        return WriteOutcome(TARGET_INVALID)
    if not auto_write_entitled(cursor, package, now=now_epoch, environment=environment):
        return WriteOutcome(NOT_ENTITLED)
    organization_id = package["organization_id"]
    package_id = package["id"]
    current = [dict(row) for row in cursor.execute(
        """SELECT id, loai, thoi_gian, noi_dung, sort_order FROM goi_thau_lam_ro
           WHERE organization_id = ? AND goi_thau_id = ? ORDER BY sort_order, id""",
        (organization_id, package_id),
    ).fetchall()]
    try:
        planned = plan_append(
            package_id=package_id, notice_no=notice_no, target_version=target_version,
            current_rows=current, rows_by_version=rows_by_version,
        )
    except NoticeTargetError:
        return WriteOutcome(TARGET_INVALID)
    requests, responses = planned["yeu_cau"], planned["tra_loi"]
    if not requests and not responses:
        return WriteOutcome(NEWER_REVISION if planned["newer_revision_rows"] else ALREADY_PRESENT)
    if not _lock_serialization_rows(cursor, organization_id):
        return WriteOutcome(BUSY)

    sync_version = next_sync_version(cursor, organization_id)
    updated_at = vietnam_now_sql()
    # Saves replace whole clarification lists, so a stale editor must get the
    # ordinary 409 instead of silently deleting these rows (ADR 0091).
    cursor.execute(
        """UPDATE goi_thau SET row_version = row_version + 1, sync_version = ?, updated_at = ?
           WHERE organization_id = ? AND id = ? AND row_version = ?""",
        (sync_version, updated_at, organization_id, package_id, package["row_version"]),
    )
    if cursor.rowcount != 1:
        raise RuntimeError("PROCUREMENT_MONITOR_PACKAGE_VERSION_CHANGED")
    next_order = {
        loai: max((int(row.get("sort_order") or 0) for row in current if row.get("loai") == loai), default=-1) + 1
        for loai in ("yeu_cau", "tra_loi")
    }
    inserted = []
    for row in (*requests, *responses):
        inserted.append((
            row["id"], organization_id, package["owner_type"], package_id, row["loai"],
            row["thoi_gian"], row["noi_dung"], next_order[row["loai"]], sync_version, updated_at,
        ))
        next_order[row["loai"]] += 1
    cursor.executemany(
        """INSERT INTO goi_thau_lam_ro (
               id, organization_id, owner_type, goi_thau_id, loai, thoi_gian,
               noi_dung, sort_order, sync_version, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        inserted,
    )
    metadata = {
        "source": "procurement_monitor", "slot": int(slot), "noticeNo": notice_no,
        "noticeVersion": target_version, "addedRequests": len(requests),
        "addedResponses": len(responses), "rowIds": [row[0] for row in inserted],
    }
    insert_audit_row(
        cursor, actor_user_id=None, organization_id=organization_id,
        action="procurement_monitor.clarification_auto_write", target_type="goi_thau",
        target_id=package_id, created_at=updated_at,
        metadata_json=json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
    )
    changed = [field for field, rows in (("yeu_cau_lam_ro_list", requests), ("tra_loi_lam_ro_list", responses)) if rows]
    insert_activity_events(
        cursor, organization_id=organization_id, owner_type=package["owner_type"],
        actor_user_id=None, actor_name=SYSTEM_ACTOR_NAME, occurred_at=updated_at,
        events=[ActivityEvent(
            target_type="goithau", target_id=package_id,
            target_root_id=str(package.get("id_goc") or package_id), action="goithau.updated",
            metadata={"changedFields": changed, "source": "procurement_monitor",
                      "addedRequests": len(requests), "addedResponses": len(responses)},
        )],
    )
    enqueue_websocket_event(
        cursor, "broadcast", organization_id=organization_id,
        payload={"type": "sync_update", "table": "goithau", "id": package_id, "syncVersion": sync_version},
    )
    return WriteOutcome(WRITTEN, len(requests), len(responses))
