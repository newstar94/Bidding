"""Source-load hardening for the scheduled monitor (ADR 0090 rules unchanged)."""

import time

import psycopg

from backend.procurement_monitor.worker import (
    FETCH_PERMIT_LOCK_KEY,
    ProcurementMonitor,
    classify_source_error,
    monitor_settings,
)
from tests.test_procurement_monitor import moment
from tests.test_procurement_monitor_postgres import emails, monitor_db  # noqa: F401 - fixture


def test_settings_are_bounded():
    settings = monitor_settings({
        "PROCUREMENT_MONITOR_MAX_CONCURRENCY": "999",
        "PROCUREMENT_MONITOR_MIN_INTERVAL_MS": "-5",
        "PROCUREMENT_MONITOR_FETCH_TIMEOUT_SECONDS": "999999",
        "PROCUREMENT_MONITOR_FETCH_CACHE_SECONDS": "bad",
    })
    assert settings["max_concurrency"] == 8
    assert settings["min_interval_seconds"] == 0
    assert settings["fetch_timeout_seconds"] == 900
    assert settings["fetch_cache_seconds"] == 600


def test_source_errors_are_classified_without_payload():
    class SourceError(Exception):
        code = "PROCUREMENT_SCHEMA_CHANGED"

    assert classify_source_error(TimeoutError()) == "SOURCE_TIMEOUT"
    assert classify_source_error(SourceError("https://secret/url?x=1")) == "PROCUREMENT_SCHEMA_CHANGED"
    assert classify_source_error(RuntimeError("raw <html> payload")) == "SOURCE_RUNTIMEERROR"


def test_same_notice_is_fetched_once_per_slot_and_everyone_is_notified(monitor_db):  # noqa: F811
    f = monitor_db
    f.conn.execute("INSERT INTO goi_thau (id, organization_id, ke_hoach_id) VALUES ('package-2', 'org', 'plan')")
    f.conn.execute(
        "INSERT INTO phan_cong_nhan_su (id, organization_id, id_nhan_vien, id_muc_tieu) "
        "VALUES ('assigned-2', 'org', 'assigned', 'package-2')"
    )
    f.conn.commit()
    calls = []

    def fetch(code):
        calls.append(code)
        return {"clarification": list(f.observed["clarification"]), "petition": list(f.observed["petition"])}

    worker = ProcurementMonitor(f.db, fetch=fetch, clock=lambda: f.clock[0])
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    assert worker.process_next() and worker.process_next()  # baseline both packages
    assert len(calls) == 1
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    f.observed["petition"] = [{"id": "new-petition"}]
    assert worker.process_next() and worker.process_next()
    assert not worker.process_next()
    assert len(calls) == 2  # one fetch per (notice, slot), not per package
    notified = f.conn.execute(
        "SELECT target_id FROM user_notifications WHERE user_id = 'manager' ORDER BY target_id"
    ).fetchall()
    assert [row[0] for row in notified] == ["package", "package-2"]
    assert emails(f)


def test_hung_fetch_is_abandoned_and_lease_released(monitor_db):  # noqa: F811
    f = monitor_db

    def hang(_code):
        time.sleep(3)
        return dict(f.observed)

    worker = ProcurementMonitor(
        f.db, fetch=hang, clock=lambda: f.clock[0],
        environment={"PROCUREMENT_MONITOR_FETCH_TIMEOUT_SECONDS": "1", "EMAIL_OUTBOX_ENCRYPTION_KEY": "x"},
    )
    started = time.monotonic()
    assert worker.process_next()
    assert time.monotonic() - started < 2.5
    state = f.conn.execute(
        "SELECT lease_token, lease_until, last_error FROM procurement_monitor_state"
    ).fetchone()
    assert state["lease_token"] is None and state["lease_until"] == 0
    assert str(state["last_error"]).startswith("SOURCE_UNAVAILABLE")
    worker.close()


def test_no_fetch_when_every_cluster_permit_is_taken(monitor_db):  # noqa: F811
    f = monitor_db
    holder = psycopg.connect(f.database_url(), autocommit=True)
    try:
        assert holder.execute("SELECT pg_try_advisory_lock(%s, 0)", (FETCH_PERMIT_LOCK_KEY,)).fetchone()[0]
        calls = []
        worker = ProcurementMonitor(f.db, fetch=lambda code: calls.append(code) or f.observed,
                                    clock=lambda: f.clock[0])
        assert worker.process_next() is False
        assert calls == []
    finally:
        holder.close()
    assert worker.process_next() is True
    assert calls
