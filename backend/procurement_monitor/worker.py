"""Durable twice-daily checks with transactional notification/outbox publication."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timedelta
import json
import os
from threading import Lock
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
# Cluster-wide fetch permits use session-level advisory locks in this keyspace
# (``pg_try_advisory_lock(key, permit_index)``); no schema change is required.
FETCH_PERMIT_LOCK_KEY = 0x50524D4E  # "PRMN"
PACKAGE_SELECT = """SELECT gt.* FROM goi_thau gt
    JOIN ke_hoach_lcnt plan ON plan.id = gt.ke_hoach_id
      AND plan.organization_id = gt.organization_id
    WHERE gt.is_latest = 1 AND gt.archived_at IS NULL
      AND plan.is_latest = 1 AND plan.archived_at IS NULL
      AND gt.trang_thai IN ('INVITED', 'OPENED', 'EVALUATING', 'PARTIALLY_AWARDED', 'AWARDED')
      AND (gt.owner_type = 'personal' OR EXISTS (
          SELECT 1 FROM to_chuc org WHERE org.id = gt.organization_id AND org.trang_thai = 'active'))
"""


def _bounded_float(environment, name, default, minimum, maximum):
    try:
        value = float(environment.get(name, default))
    except (TypeError, ValueError):
        value = float(default)
    return max(minimum, min(maximum, value))


def monitor_settings(environment=None):
    """Load bounded throttling settings for the scheduled monitor."""
    env = os.environ if environment is None else environment
    return {
        # At most this many source fetches run at once across all web workers.
        "max_concurrency": int(_bounded_float(env, "PROCUREMENT_MONITOR_MAX_CONCURRENCY", 1, 1, 8)),
        # Minimum pause between two fetches made by the same worker loop.
        "min_interval_seconds": _bounded_float(env, "PROCUREMENT_MONITOR_MIN_INTERVAL_MS", 1000, 0, 60_000) / 1000,
        # A hung source call is abandoned well before the 30-minute lease expires.
        "fetch_timeout_seconds": _bounded_float(
            env, "PROCUREMENT_MONITOR_FETCH_TIMEOUT_SECONDS", 120, 1, LEASE_SECONDS / 2,
        ),
        # Same notice in the same slot is fetched once per worker for N tenants.
        "fetch_cache_seconds": _bounded_float(env, "PROCUREMENT_MONITOR_FETCH_CACHE_SECONDS", 600, 0, 3600),
    }


def classify_source_error(error):
    """Return a payload-free error code for logs."""
    if isinstance(error, (FutureTimeoutError, TimeoutError)):
        return "SOURCE_TIMEOUT"
    code = str(getattr(error, "code", "") or (error.args[0] if getattr(error, "args", None) else "") or "")
    if code.replace("_", "").isalnum() and code.upper() == code and len(code) <= 64:
        return code if code.startswith(("SOURCE_", "PROCUREMENT_")) else f"SOURCE_{code}"
    return "SOURCE_" + type(error).__name__.upper()[:48]


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
        self.settings = monitor_settings(self.environment)
        self._fetch_cache = {}
        self._fetch_cache_lock = Lock()
        # One dedicated thread: a hung source call cannot pile up more threads.
        self._fetch_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="procurement-monitor-fetch")

    def close(self):
        self._fetch_executor.shutdown(wait=False, cancel_futures=True)

    def _acquire_fetch_permit(self):
        """Take one cluster-wide fetch permit; returns (connection, index) or None."""
        connection = self.database.get_connection()
        try:
            for index in range(self.settings["max_concurrency"]):
                row = connection.execute(
                    "SELECT pg_try_advisory_lock(?, ?)", (FETCH_PERMIT_LOCK_KEY, index),
                ).fetchone()
                if row and bool(row[0]):
                    # Session-level locks survive commit; never sit idle in a transaction.
                    connection.commit()
                    return connection, index
            connection.commit()
        except Exception:
            connection.rollback()
            connection.close()
            raise
        connection.close()
        return None

    @staticmethod
    def _release_fetch_permit(permit):
        connection, index = permit
        try:
            connection.execute("SELECT pg_advisory_unlock(?, ?)", (FETCH_PERMIT_LOCK_KEY, index)).fetchone()
            connection.commit()
        except Exception:  # noqa: BLE001 - closing the session releases the lock anyway.
            log_error("Fetch permit release failed", "procurement_monitor_permit", level="WARN")
        finally:
            connection.close()

    def _cached_fetch(self, code, slot):
        ttl = self.settings["fetch_cache_seconds"]
        key = (code, slot)
        now = time.monotonic()
        if ttl > 0:
            with self._fetch_cache_lock:
                for cached_key, (expires_at, _value) in list(self._fetch_cache.items()):
                    if expires_at <= now or cached_key[1] != slot:
                        self._fetch_cache.pop(cached_key, None)
                hit = self._fetch_cache.get(key)
            if hit is not None:
                return json.loads(hit[1])
        future = self._fetch_executor.submit(self.fetch, code)
        observed = future.result(timeout=self.settings["fetch_timeout_seconds"])
        complete = isinstance(observed, dict) and all(
            observed.get(category) is not None for category in ("clarification", "petition")
        )
        if ttl > 0 and complete:
            # Only complete reads are shared; partial failures are re-fetched.
            with self._fetch_cache_lock:
                self._fetch_cache[key] = (now + ttl, json.dumps(observed))
        return observed

    def process_next(self):
        now = datetime.fromtimestamp(self.clock(), VIETNAM_TIMEZONE)
        slot = due_slot(now)
        baseline_only = slot is None
        if baseline_only:
            # Arm newly tracked notices before the first daily scheduled check.
            # Midnight is only an initialization retry bucket, not a mail slot.
            slot = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        permit = self._acquire_fetch_permit()
        if permit is None:
            # Another worker holds every permit; its loop will keep draining.
            return False
        try:
            return self._process_claimed(now, slot, baseline_only)
        finally:
            self._release_fetch_permit(permit)

    def _process_claimed(self, now, slot, baseline_only):
        claim = self._claim(now, slot, baseline_only=baseline_only)
        if not claim:
            return False
        package, token = claim
        try:
            observed = self._cached_fetch(notice_code(package["ma_goi_thau"]), slot)
        except Exception as error:  # noqa: BLE001 - normalize source/outbox failures without leaking payloads.
            # Neither source payloads nor provider URLs belong in notifications/logs.
            log_error(classify_source_error(error), "procurement_monitor_fetch", level="WARN")
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
    pause_after_work = max(1.0, processor.settings["min_interval_seconds"])
    try:
        while True:
            try:
                worked = await run_owned_blocking_io(processor.process_next, timeout_seconds=None, lane="procurement_monitor")
            except Exception:  # noqa: BLE001 - worker must survive transient DB/source failures.
                log_error("Scheduled check failed; will retry", "procurement_monitor_worker", level="WARN")
                worked = False
            await asyncio.sleep(pause_after_work if worked else 30)
    finally:
        processor.close()
