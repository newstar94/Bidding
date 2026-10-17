"""Durable twice-daily checks with transactional notification/outbox publication."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import json
import os
import time
import uuid

from backend.auth.auth_helper import SessionRole
from backend.notifications.service import queue_user_notifications
from backend.shared.access_policy import can_read_record
from backend.shared.async_io import run_owned_blocking_io
from backend.shared.date_utils import VIETNAM_TIMEZONE
from backend.shared.logging_utils import log_error

from .domain import changes, due_slot, eligible, notice_code, snapshots


LEASE_SECONDS = 1800
MAX_ATTEMPTS = 3
PACKAGE_SELECT = """SELECT gt.* FROM goi_thau gt
    JOIN ke_hoach_lcnt plan ON plan.id = gt.ke_hoach_id
      AND plan.organization_id = gt.organization_id
    WHERE gt.is_latest = 1 AND gt.archived_at IS NULL
      AND plan.is_latest = 1 AND plan.archived_at IS NULL
      AND gt.trang_thai IN ('INVITED', 'OPENED', 'EVALUATING', 'PARTIALLY_AWARDED', 'AWARDED')
      AND (gt.owner_type = 'personal' OR EXISTS (
          SELECT 1 FROM to_chuc org WHERE org.id = gt.organization_id AND org.trang_thai = 'active'))
"""


def monitor_enabled(environment=None):
    env = os.environ if environment is None else environment
    return (str(env.get("PROCUREMENT_LOOKUP_ENABLED", "true")).strip().lower() == "true"
            and str(env.get("PROCUREMENT_MONITOR_ENABLED", "true")).strip().lower() == "true")


def fetch_updates(code):
    from backend.integrations.muasamcong_browser.registry import get_muasamcong_source

    source = get_muasamcong_source()
    return snapshots(source.get_notice_updates(code), code)


def recipients(cursor, package):
    """Resolve current responsibilities, then reuse unchanged record-read policy."""
    organization_id = package["organization_id"]
    if package["owner_type"] == "personal":
        user_id = organization_id.removeprefix("personal:")
        candidates = cursor.execute(
            "SELECT id, 'employee' FROM tai_khoan WHERE id = ? AND trang_thai = 'active' AND trim(email) != '' FOR SHARE",
            (user_id,),
        ).fetchall()
    else:
        candidates = cursor.execute(
            """SELECT tv.user_id, tv.vai_tro_trong_to_chuc FROM thanh_vien_to_chuc tv
               JOIN tai_khoan tk ON tk.id = tv.user_id
               JOIN to_chuc org ON org.id = tv.organization_id AND org.trang_thai = 'active'
               WHERE tv.organization_id = ? AND tv.trang_thai_thanh_vien = 'active'
                 AND tk.trang_thai = 'active' AND trim(tk.email) != ''
                 AND (tv.vai_tro_trong_to_chuc = 'manager' OR org.owner_user_id = tv.user_id
                      OR EXISTS (SELECT 1 FROM phan_cong_nhan_su pc
                          WHERE pc.organization_id = tv.organization_id AND pc.id_nhan_vien = tv.user_id
                            AND pc.id_muc_tieu = ? AND pc.loai_doi_tuong = 'goithau'))
               FOR SHARE OF tv, tk, org""",
            (organization_id, package["id"]),
        ).fetchall()
        # Hold existing authorization rows until publication; a concurrent
        # assignment/permission revocation must precede or follow the email tx.
        cursor.execute(
            """SELECT id FROM phan_cong_nhan_su WHERE organization_id = ?
               AND id_muc_tieu = ? AND loai_doi_tuong = 'goithau' FOR SHARE""",
            (organization_id, package["id"]),
        ).fetchall()
        cursor.execute(
            "SELECT emp_id FROM ma_tran_phan_quyen WHERE organization_id = ? AND emp_id = ANY(?) FOR SHARE",
            (organization_id, [str(row[0]) for row in candidates]),
        ).fetchall()
    return sorted({
        str(row[0]) for row in candidates
        if can_read_record(
            cursor, SessionRole("user", str(row[0]), active_role=row[1],
                                active_role_organization_id=organization_id),
            str(row[0]), organization_id, "goithau", "goi_thau", package["id"],
        )
    })


class ProcurementMonitor:
    def __init__(self, database, *, fetch=None, clock=None, environment=None):
        self.database = database
        self.fetch = fetch or fetch_updates
        self.clock = clock or time.time
        self.environment = os.environ if environment is None else environment

    def process_next(self):
        now = datetime.fromtimestamp(self.clock(), VIETNAM_TIMEZONE)
        slot = due_slot(now)
        baseline_only = slot is None
        if baseline_only:
            # Arm newly tracked notices before the first daily scheduled check.
            # Midnight is only an initialization retry bucket, not a mail slot.
            slot = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        claim = self._claim(now, slot, baseline_only=baseline_only)
        if not claim:
            return False
        package, token = claim
        try:
            observed = self.fetch(notice_code(package["ma_goi_thau"]))
        except Exception:  # noqa: BLE001 - normalize source/outbox failures without leaking payloads.
            # Neither source payloads nor provider URLs belong in notifications/logs.
            self._finish(package, token, slot, None, baseline_only=baseline_only)
        else:
            try:
                self._finish(package, token, slot, observed, baseline_only=baseline_only)
            except Exception:  # noqa: BLE001 - rolled-back publication must remain retryable.
                self._finish(package, token, slot, None, baseline_only=baseline_only,
                             failure_reason="NOTIFICATION_ENQUEUE_FAILED")
        return True

    @staticmethod
    def _key(package):
        return (package["organization_id"], package.get("id_goc") or package["id"],
                notice_code(package["ma_goi_thau"]))

    def _claim(self, now, slot, *, baseline_only=False):
        connection = self.database.get_connection()
        epoch = int(now.timestamp())
        try:
            connection.execute("BEGIN")
            row = connection.execute(
                PACKAGE_SELECT + """  -- fixed SQL only; all values remain parameters
                  AND upper(trim(gt.ma_goi_thau)) ~ '^IB[0-9]{10}(-[0-9]{2})?$'
                  AND (gt.trang_thai != 'AWARDED' OR gt.ngay_quyet_dinh_ket_qua IS NULL
                       OR CAST(gt.ngay_quyet_dinh_ket_qua AS DATE) >= CAST(? AS DATE))
                  AND (? = 0 OR NOT EXISTS (SELECT 1 FROM procurement_monitor_state initialized
                    WHERE initialized.organization_id = gt.organization_id
                      AND initialized.package_root_id = COALESCE(NULLIF(gt.id_goc, ''), gt.id)
                      AND initialized.notice_no = left(upper(trim(gt.ma_goi_thau)), 12)
                      AND jsonb_typeof(initialized.seen_json::jsonb -> 'clarification') = 'array'
                      AND jsonb_typeof(initialized.seen_json::jsonb -> 'petition') = 'array'))
                  AND NOT EXISTS (SELECT 1 FROM procurement_monitor_state state
                    WHERE state.organization_id = gt.organization_id
                      AND state.package_root_id = COALESCE(NULLIF(gt.id_goc, ''), gt.id)
                      AND state.notice_no = left(upper(trim(gt.ma_goi_thau)), 12)
                      AND (state.completed_slot >= ? OR state.lease_until > ?
                           OR (state.attempt_slot = ? AND state.retry_after > ?)))
                ORDER BY gt.organization_id, gt.id LIMIT 1 FOR UPDATE OF gt SKIP LOCKED""",  # noqa: S608 - concatenation of fixed SQL literals only.
                ((now.date() - timedelta(days=10)).isoformat(), int(baseline_only), slot, epoch, slot, epoch),
            ).fetchone()
            if not row:
                connection.rollback()
                return None
            package = dict(row)
            token = str(uuid.uuid4())
            leased = connection.execute(
                """INSERT INTO procurement_monitor_state
                   (organization_id, package_root_id, notice_no, lease_token, lease_until, attempt_slot, attempts)
                   VALUES (?, ?, ?, ?, ?, ?, 1)
                   ON CONFLICT (organization_id, package_root_id, notice_no) DO UPDATE SET
                     lease_token = excluded.lease_token, lease_until = excluded.lease_until,
                     attempts = CASE WHEN procurement_monitor_state.attempt_slot = excluded.attempt_slot
                       THEN procurement_monitor_state.attempts + 1 ELSE 1 END,
                     attempt_slot = excluded.attempt_slot
                   WHERE procurement_monitor_state.lease_until <= ?
                     AND procurement_monitor_state.completed_slot < ?
                   RETURNING lease_token""",
                (*self._key(package), token, epoch + LEASE_SECONDS, slot, epoch, slot),
            ).fetchone()
            connection.commit()
            return (package, token) if leased else None
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _finish(self, package, token, slot, observed, *, baseline_only=False, failure_reason=None):
        connection = self.database.get_connection()
        epoch = int(self.clock())
        now = datetime.fromtimestamp(epoch, VIETNAM_TIMEZONE)
        key = self._key(package)
        try:
            connection.execute("BEGIN")
            # Use the same package -> state lock order as claim, avoiding an
            # expired-lease takeover deadlock while an older owner finishes.
            current = connection.execute(
                PACKAGE_SELECT + " AND gt.organization_id = ? AND gt.id = ? FOR SHARE OF gt, plan",
                (package["organization_id"], package["id"]),
            ).fetchone()
            state = connection.execute(
                """SELECT * FROM procurement_monitor_state WHERE organization_id = ?
                   AND package_root_id = ? AND notice_no = ? AND lease_token = ? FOR UPDATE""",
                (*key, token),
            ).fetchone()
            if not state:
                connection.rollback()
                return
            state = dict(state)
            if not current or self._key(dict(current)) != key or not eligible(dict(current), now):
                connection.execute(
                    """UPDATE procurement_monitor_state SET lease_token = NULL, lease_until = 0
                       WHERE organization_id = ? AND package_root_id = ? AND notice_no = ?""", key,
                )
                connection.commit()
                return
            current = dict(current)
            previous = json.loads(state["seen_json"])
            observed = observed or {"clarification": None, "petition": None}
            if baseline_only:
                # Retrying an unavailable category must not consume new content
                # in an already initialized category ahead of the email schedule.
                observed = {category: rows for category, rows in observed.items()
                            if previous.get(category) is None}
            updated, counts, failures = changes(previous, observed)
            error = failure_reason or ("SOURCE_UNAVAILABLE:" + ",".join(failures) if failures else None)
            if counts:
                targets = recipients(connection.cursor(), current)
                if not targets or not str(self.environment.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip():
                    # Keep the old baseline: detecting new content is not delivery.
                    updated = previous
                    error = "EMAIL_CONFIGURATION_MISSING" if targets else "NO_ELIGIBLE_RECIPIENT"
                else:
                    self._notify(connection.cursor(), current, targets, counts, epoch)
            completed = slot if not error or state["attempts"] >= MAX_ATTEMPTS else state["completed_slot"]
            connection.execute(
                """UPDATE procurement_monitor_state SET seen_json = ?, completed_slot = ?,
                   lease_token = NULL, lease_until = 0, retry_after = ?, last_checked_at = ?, last_error = ?
                   WHERE organization_id = ? AND package_root_id = ? AND notice_no = ? AND lease_token = ?""",
                (json.dumps(updated), completed, epoch + 300 * state["attempts"], epoch, error, *key, token),
            )
            connection.commit()
            if error:
                log_error(error, "procurement_monitor_check", level="WARN")
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _notify(cursor, package, targets, counts, epoch):
        categories = []
        if counts.get("clarification"):
            categories.append(f"làm rõ HSMT ({counts['clarification']} nội dung mới)")
        if counts.get("petition"):
            categories.append(f"kiến nghị ({counts['petition']} nội dung mới)")
        title = "Gói thầu có thông tin mới"
        message = f"Gói thầu {package['ma_goi_thau']} – {package['ten_goi_thau']}: " + "; ".join(categories) + "."
        queue_user_notifications(cursor, [{
            "user_id": user_id, "organization_id": package["organization_id"],
            "kind": "procurement_update", "title": title, "message": message,
            "email_subject": f"[BiddingFlow] {package['ma_goi_thau']} có thông tin mới",
            "target_type": "goithau", "target_id": package["id"],
            "route": f"/goi-thau-chi-tiet/{package['id']}", "now": epoch,
        } for user_id in targets])


async def run_procurement_monitor(database):
    processor = ProcurementMonitor(database)
    while True:
        try:
            worked = await run_owned_blocking_io(processor.process_next, timeout_seconds=None, lane="procurement_monitor")
        except Exception:  # noqa: BLE001 - worker must survive transient DB/source failures.
            log_error("Scheduled check failed; will retry", "procurement_monitor_worker", level="WARN")
            worked = False
        await asyncio.sleep(1 if worked else 30)
