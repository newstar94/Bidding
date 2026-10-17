"""Real PostgreSQL worker/outbox tests, isolated with connection-local TEMP tables.

No production rows, real source requests or SMTP deliveries are touched.
"""

from datetime import timedelta
import json
import os
from types import SimpleNamespace

from cryptography.fernet import Fernet
import pytest

from backend.db.db_helper import PostgresDatabase
from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import _upgrade_to_v101_add_procurement_monitor
from backend.procurement_monitor.domain import due_slot
from backend.procurement_monitor.worker import ProcurementMonitor, recipients
from tests.test_procurement_monitor import moment


@pytest.fixture
def monitor_db(monkeypatch):
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL required for TEMP-table PostgreSQL tests")
    database = PostgresDatabase(url)
    connection = database.get_connection()
    view = SimpleNamespace(execute=connection.execute, cursor=connection.cursor,
                           commit=connection.commit, rollback=connection.rollback, close=lambda: None)
    proxy = SimpleNamespace(get_connection=lambda: view)
    try:
        for ddl in (
            "CREATE TEMP TABLE ke_hoach_lcnt (id TEXT, organization_id TEXT, is_latest INTEGER DEFAULT 1, archived_at TEXT)",
            """CREATE TEMP TABLE goi_thau (id TEXT, organization_id TEXT, id_goc TEXT,
                owner_type TEXT DEFAULT 'organization', ke_hoach_id TEXT,
                ma_goi_thau TEXT DEFAULT 'IB2600271825', ten_goi_thau TEXT DEFAULT 'Gói kiểm thử',
                trang_thai TEXT DEFAULT 'INVITED', ngay_quyet_dinh_ket_qua DATE,
                is_latest INTEGER DEFAULT 1, archived_at TEXT)""",
            "CREATE TEMP TABLE to_chuc (id TEXT, owner_user_id TEXT, trang_thai TEXT DEFAULT 'active')",
            """CREATE TEMP TABLE tai_khoan (id TEXT, email TEXT, ho_ten TEXT, ten_dang_nhap TEXT,
                vai_tro TEXT DEFAULT 'user', trang_thai TEXT DEFAULT 'active')""",
            """CREATE TEMP TABLE thanh_vien_to_chuc (user_id TEXT, organization_id TEXT,
                vai_tro_trong_to_chuc TEXT DEFAULT 'employee', trang_thai_thanh_vien TEXT DEFAULT 'active')""",
            """CREATE TEMP TABLE phan_cong_nhan_su (id TEXT, organization_id TEXT,
                id_nhan_vien TEXT, id_muc_tieu TEXT, loai_doi_tuong TEXT DEFAULT 'goithau')""",
            "CREATE TEMP TABLE ma_tran_phan_quyen (organization_id TEXT, emp_id TEXT, goithau TEXT DEFAULT 'view')",
        ):
            connection.execute(ddl)
        for table in ("procurement_monitor_state", "user_notifications", "email_delivery_status"):
            connection.execute(build_create_table_sql(table, SCHEMA_DINH_NGHIA[table]).replace(
                "CREATE TABLE ", "CREATE TEMP TABLE ", 1,
            ))
        connection.execute("INSERT INTO to_chuc (id, owner_user_id) VALUES ('org', 'manager')")
        connection.execute("INSERT INTO ke_hoach_lcnt (id, organization_id) VALUES ('plan', 'org')")
        connection.execute("INSERT INTO goi_thau (id, organization_id, ke_hoach_id) VALUES ('package', 'org', 'plan')")
        for user, role in (("manager", "manager"), ("assigned", "employee"), ("unassigned", "employee"),
                           ("historical", "employee"), ("denied", "employee"), ("left", "employee")):
            connection.execute("INSERT INTO tai_khoan (id, email) VALUES (?, ?)", (user, f"{user}@example.test"))
            connection.execute("INSERT INTO thanh_vien_to_chuc (user_id, organization_id, vai_tro_trong_to_chuc) VALUES (?, 'org', ?)", (user, role))
            connection.execute("INSERT INTO ma_tran_phan_quyen (organization_id, emp_id) VALUES ('org', ?)", (user,))
        for user, target in (("manager", "package"), ("assigned", "package"), ("historical", "old-package"),
                             ("denied", "package"), ("left", "package")):
            connection.execute("INSERT INTO phan_cong_nhan_su (id, organization_id, id_nhan_vien, id_muc_tieu) VALUES (?, 'org', ?, ?)", (user, user, target))
        connection.execute("UPDATE ma_tran_phan_quyen SET goithau = '' WHERE emp_id = 'denied'")
        connection.execute("UPDATE thanh_vien_to_chuc SET trang_thai_thanh_vien = 'left' WHERE user_id = 'left'")
        connection.commit()
        monkeypatch.setenv("EMAIL_OUTBOX_ENCRYPTION_KEY", Fernet.generate_key().decode())
        clock = [moment("2026-10-17T08:30:00").timestamp()]
        observed = {"clarification": [], "petition": []}
        processor = ProcurementMonitor(proxy, fetch=lambda _: dict(observed), clock=lambda: clock[0])
        yield SimpleNamespace(db=proxy, conn=connection, worker=processor, clock=clock, observed=observed,
                              database_url=lambda: url)
    finally:
        connection.rollback()
        # TEMP tables survive commits, but not their owning physical connection.
        connection.close()
        database.close()


def advance(fixture, hours=6):
    fixture.clock[0] += hours * 3600


def emails(fixture):
    return fixture.conn.execute("SELECT * FROM email_delivery_status ORDER BY user_id").fetchall()


def test_empty_baseline_before_schedule_notifies_on_first_scheduled_check(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    assert f.worker.process_next()  # Arm monitoring immediately, not at 08:30.
    assert not emails(f)
    assert json.loads(f.conn.execute("SELECT seen_json FROM procurement_monitor_state").fetchone()[0]) == {
        "clarification": [], "petition": [],
    }
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    f.observed["clarification"] = [{"id": "new-question"}]
    f.observed["petition"] = [{"id": "new-petition"}]
    assert f.worker.process_next()
    assert [row["user_id"] for row in emails(f)] == ["assigned", "manager"]
    assert not f.worker.process_next()


def test_initial_existing_content_is_not_emailed_and_new_answer_is(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    f.observed["clarification"] = [{"id": "old-question"}]
    assert f.worker.process_next()
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    assert f.worker.process_next()
    assert not emails(f)
    f.clock[0] = moment("2026-10-17T14:30:00").timestamp()
    f.observed["clarification"].append({"id": "new-answer"})
    assert f.worker.process_next()
    assert len(emails(f)) == 2


def test_restart_before_schedule_does_not_reset_or_consume_known_empty_baseline(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    assert f.worker.process_next()
    f.clock[0] = moment("2026-10-17T07:30:00").timestamp()
    f.observed["petition"] = [{"id": "new-petition"}]
    calls = []
    restarted = ProcurementMonitor(f.db, fetch=lambda code: calls.append(code) or f.observed,
                                   clock=lambda: f.clock[0])
    assert not restarted.process_next()
    assert not calls and not emails(f)
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    assert restarted.process_next()
    assert len(emails(f)) == 2


def test_partial_baseline_retry_does_not_consume_new_content_before_schedule(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    f.observed["petition"] = None
    assert f.worker.process_next()
    f.clock[0] = moment("2026-10-17T07:10:00").timestamp()
    f.observed.update(clarification=[{"id": "new-question"}], petition=[{"id": "initial-petition"}])
    assert f.worker.process_next()
    baseline = json.loads(f.conn.execute("SELECT seen_json FROM procurement_monitor_state").fetchone()[0])
    assert baseline["clarification"] == []  # Keep this change pending for 08:30.
    assert len(baseline["petition"]) == 1 and not emails(f)
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    assert f.worker.process_next()
    assert len(emails(f)) == 2
    message = f.conn.execute("SELECT message FROM user_notifications LIMIT 1").fetchone()[0]
    assert "làm rõ HSMT" in message and "kiến nghị" not in message


def test_unavailable_baseline_does_not_block_scheduled_changes_in_known_category(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T07:00:00").timestamp()
    f.observed["petition"] = None
    assert f.worker.process_next()
    f.clock[0] = moment("2026-10-17T08:30:00").timestamp()
    f.observed["clarification"] = [{"id": "new-question"}]
    assert f.worker.process_next()
    assert len(emails(f)) == 2


@pytest.mark.parametrize("clock", ["09:00:00", "15:00:00"])
def test_newly_tracked_package_is_initialized_without_waiting_for_next_slot(monitor_db, clock):
    f = monitor_db
    f.clock[0] = moment(f"2026-10-17T{clock}").timestamp()
    f.observed["petition"] = [{"id": "initial-petition"}]
    assert f.worker.process_next()
    assert not emails(f)
    assert not f.worker.process_next()
    f.clock[0] = moment("2026-10-18T08:30:00").timestamp()
    f.observed["petition"].append({"id": "new-petition"})
    assert f.worker.process_next()
    assert len(emails(f)) == 2


def test_baseline_retry_is_bounded_and_does_not_treat_failure_as_empty(monitor_db):
    f = monitor_db
    f.clock[0] = moment("2026-10-17T06:00:00").timestamp()
    f.observed["petition"] = None
    assert f.worker.process_next()
    assert not f.worker.process_next()
    f.clock[0] += 301
    assert f.worker.process_next()
    f.clock[0] += 601
    assert f.worker.process_next()
    f.clock[0] += 901
    assert not f.worker.process_next()
    assert "petition" not in json.loads(f.conn.execute("SELECT seen_json FROM procurement_monitor_state").fetchone()[0])
    assert not emails(f)


def test_baseline_then_new_content_atomically_queues_one_email_per_current_recipient(monitor_db):
    f = monitor_db
    f.observed["clarification"] = [{"id": "old-question"}]
    assert f.worker.process_next()
    assert not emails(f)
    assert not f.worker.process_next()  # same slot, even after process restart
    advance(f)
    f.observed["clarification"].append({"id": "new-answer"})
    f.observed["petition"] = [{"id": "new-petition"}]
    assert f.worker.process_next()
    deliveries = emails(f)
    assert [row["user_id"] for row in deliveries] == ["assigned", "manager"]
    assert all(row["status"] == "pending" for row in deliveries)
    key = Fernet(os.environ["EMAIL_OUTBOX_ENCRYPTION_KEY"].encode())
    html = key.decrypt(deliveries[0]["body_ciphertext"].encode()).decode()
    assert "làm rõ HSMT" in html and "kiến nghị" in html
    assert "muasamcong" not in html.lower()
    assert "new-answer" not in html
    assert f.conn.execute("SELECT count(*) FROM user_notifications").fetchone()[0] == 2
    advance(f, 18)
    assert f.worker.process_next()
    assert len(emails(f)) == 2  # unchanged/reordered data never sends again


@pytest.mark.parametrize(("column", "value"), [
    ("is_latest", 0), ("archived_at", "2026-10-17"), ("trang_thai", "CANCELLED"),
    ("trang_thai", "PREPARING"), ("ma_goi_thau", "internal-code"),
])
def test_skip_ineligible_current_package(monitor_db, column, value):
    f = monitor_db
    assert column in {"is_latest", "archived_at", "trang_thai", "ma_goi_thau"}
    f.conn.execute(f"UPDATE goi_thau SET {column} = ?", (value,))  # noqa: S608 - test-only fixed allowlist.
    f.conn.commit()
    assert not f.worker.process_next()


def test_latest_parent_plan_and_active_organization_required(monitor_db):
    f = monitor_db
    f.conn.execute("UPDATE ke_hoach_lcnt SET is_latest = 0")
    f.conn.commit()
    assert not f.worker.process_next()
    f.conn.execute("UPDATE ke_hoach_lcnt SET is_latest = 1")
    f.conn.execute("UPDATE to_chuc SET trang_thai = 'suspended'")
    f.conn.commit()
    assert not f.worker.process_next()


def test_awarded_exactly_ten_days_is_checked_but_eleven_is_not(monitor_db):
    f = monitor_db
    f.conn.execute("UPDATE goi_thau SET trang_thai = 'AWARDED', ngay_quyet_dinh_ket_qua = '2026-10-06'")
    f.conn.commit()
    assert not f.worker.process_next()
    f.conn.execute("UPDATE goi_thau SET ngay_quyet_dinh_ket_qua = '2026-10-07'")
    f.conn.commit()
    assert f.worker.process_next()


def test_claim_lease_and_fencing_survive_worker_restart(monitor_db):
    f = monitor_db
    now = moment("2026-10-17T08:30:00")
    slot = due_slot(now)
    old = f.worker._claim(now, slot)
    assert old and f.worker._claim(now, slot) is None
    f.clock[0] += 1801
    fresh = f.worker._claim(now + timedelta(seconds=1801), slot)
    assert fresh and fresh[1] != old[1]
    f.worker._finish(*old, slot, f.observed)
    assert f.conn.execute("SELECT lease_token FROM procurement_monitor_state").fetchone()[0] == fresh[1]
    f.conn.rollback()
    f.worker._finish(*fresh, slot, f.observed)
    assert not f.worker.process_next()


def test_missing_email_key_preserves_pending_changes_for_retry(monitor_db, monkeypatch):
    f = monitor_db
    assert f.worker.process_next()
    advance(f)
    monkeypatch.delenv("EMAIL_OUTBOX_ENCRYPTION_KEY")
    f.observed["petition"] = [{"id": "new"}]
    assert f.worker.process_next()
    state = f.conn.execute("SELECT seen_json, last_error FROM procurement_monitor_state").fetchone()
    assert json.loads(state[0])["petition"] == []
    assert state[1] == "EMAIL_CONFIGURATION_MISSING" and not emails(f)
    monkeypatch.setenv("EMAIL_OUTBOX_ENCRYPTION_KEY", Fernet.generate_key().decode())
    f.clock[0] += 301
    assert f.worker.process_next()
    assert len(emails(f)) == 2


def test_partial_source_failure_can_retry_without_duplicate_email(monitor_db):
    f = monitor_db
    assert f.worker.process_next()
    advance(f)
    f.observed.update(clarification=[{"id": "new"}], petition=None)
    assert f.worker.process_next()
    assert len(emails(f)) == 2
    f.clock[0] += 301
    f.observed["petition"] = [{"id": "petition"}]
    assert f.worker.process_next()
    assert len(emails(f)) == 4


def test_failed_first_read_does_not_create_a_false_empty_baseline(monitor_db):
    f = monitor_db
    f.observed["petition"] = None
    assert f.worker.process_next()
    f.clock[0] += 301
    f.observed["petition"] = [{"id": "existing"}]
    assert f.worker.process_next()
    assert not emails(f)


def test_version_and_assignment_rechecked_after_network_call(monitor_db):
    f = monitor_db
    assert f.worker.process_next()
    advance(f)
    def fetch(_):
        f.conn.execute("DELETE FROM phan_cong_nhan_su WHERE id_nhan_vien = 'assigned'")
        f.conn.commit()
        return {"clarification": [{"id": "new"}], "petition": []}
    f.worker.fetch = fetch
    assert f.worker.process_next()
    assert [row["user_id"] for row in emails(f)] == ["manager"]
    advance(f, 18)
    def version_changed(_):
        f.conn.execute("UPDATE goi_thau SET is_latest = 0")
        f.conn.commit()
        return {"clarification": [{"id": "another"}], "petition": []}
    f.worker.fetch = version_changed
    assert f.worker.process_next()
    assert len(emails(f)) == 1


def test_baseline_is_preserved_across_physical_package_version(monitor_db):
    f = monitor_db
    assert f.worker.process_next()
    f.conn.execute("UPDATE goi_thau SET id_goc = 'package', id = 'new-version'")
    f.conn.execute("UPDATE phan_cong_nhan_su SET id_muc_tieu = 'new-version' WHERE id_muc_tieu = 'package'")
    f.conn.commit()
    advance(f)
    f.observed["petition"] = [{"id": "new"}]
    assert f.worker.process_next()
    assert len(emails(f)) == 2
    assert f.conn.execute("SELECT count(*) FROM procurement_monitor_state").fetchone()[0] == 1


def test_personal_owner_is_only_personal_recipient(monitor_db):
    f = monitor_db
    f.conn.execute("UPDATE goi_thau SET owner_type = 'personal', organization_id = 'personal:assigned'")
    f.conn.execute("UPDATE ke_hoach_lcnt SET organization_id = 'personal:assigned'")
    f.conn.commit()
    assert f.worker.process_next()
    advance(f)
    f.observed["petition"] = [{"id": "new"}]
    assert f.worker.process_next()
    assert [row["user_id"] for row in emails(f)] == ["assigned"]


def test_outbox_failure_rolls_back_notifications_and_seen_hashes(monitor_db, monkeypatch):
    import backend.notifications.service as service

    f = monitor_db
    assert f.worker.process_next()
    advance(f)
    f.observed["petition"] = [{"id": "new"}]
    original = service.create_email_deliveries
    def fail(*_):
        raise RuntimeError("simulated outbox failure")
    monkeypatch.setattr(service, "create_email_deliveries", fail)
    assert f.worker.process_next()
    assert not emails(f)
    assert f.conn.execute("SELECT count(*) FROM user_notifications").fetchone()[0] == 0
    assert json.loads(f.conn.execute("SELECT seen_json FROM procurement_monitor_state").fetchone()[0])["petition"] == []
    monkeypatch.setattr(service, "create_email_deliveries", original)
    f.clock[0] += 301
    assert f.worker.process_next()
    assert len(emails(f)) == 2


def test_current_recipient_policy_excludes_foreign_historical_and_denied(monitor_db):
    f = monitor_db
    package = dict(f.conn.execute("SELECT * FROM goi_thau").fetchone())
    assert recipients(f.conn.cursor(), package) == ["assigned", "manager"]
    f.conn.execute("UPDATE thanh_vien_to_chuc SET organization_id = 'foreign' WHERE user_id = 'assigned'")
    assert recipients(f.conn.cursor(), package) == ["manager"]


def test_v101_migration_adds_state_and_preserves_existing_notification(monitor_db):
    f = monitor_db
    f.conn.execute("DROP TABLE pg_temp.procurement_monitor_state")
    f.conn.execute("CREATE TEMP TABLE audit_log (organization_id TEXT, target_type TEXT, target_id TEXT, id BIGINT, action TEXT)")
    f.conn.execute("""INSERT INTO user_notifications
        (id, user_id, kind, title, message, created_at) VALUES ('old', 'manager', 'assignment_added', 'title', 'message', 1)""")
    # Migration DDL remains connection-local for this test, including table creation.
    context = SimpleNamespace(build_create_table_sql=lambda table, spec: build_create_table_sql(table, spec).replace(
        "CREATE TABLE ", "CREATE TEMP TABLE ", 1,
    ))
    _upgrade_to_v101_add_procurement_monitor(f.conn.cursor(), context)
    assert f.conn.execute("SELECT kind FROM user_notifications WHERE id = 'old'").fetchone()[0] == 'assignment_added'
    assert f.conn.execute("SELECT count(*) FROM procurement_monitor_state").fetchone()[0] == 0


@pytest.mark.parametrize("start_clock", ["07:00:00", "08:30:00"])
def test_concurrent_connections_claim_once_and_publish_once(monitor_db, start_clock):
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from uuid import uuid4

    import psycopg
    from psycopg import sql

    from backend.db.db_helper import PostgresCursor, compat_row_factory

    f = monitor_db
    f.clock[0] = moment(f"2026-10-17T{start_clock}").timestamp()
    schema_name = "bf_monitor_concurrency_" + uuid4().hex
    tables = ("goi_thau", "ke_hoach_lcnt", "to_chuc", "tai_khoan", "thanh_vien_to_chuc",
              "phan_cong_nhan_su", "ma_tran_phan_quyen", "procurement_monitor_state",
              "user_notifications", "email_delivery_status")
    f.conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))
    try:
        for table in tables:
            f.conn.execute(sql.SQL("CREATE TABLE {}.{} (LIKE pg_temp.{} INCLUDING ALL)").format(
                sql.Identifier(schema_name), sql.Identifier(table), sql.Identifier(table),
            ))
            f.conn.execute(sql.SQL("INSERT INTO {}.{} SELECT * FROM pg_temp.{}").format(
                sql.Identifier(schema_name), sql.Identifier(table), sql.Identifier(table),
            ))
        f.conn.commit()

        def get_connection():
            raw = psycopg.connect(f.database_url(), options=f"-c search_path={schema_name},public", row_factory=compat_row_factory)
            return SimpleNamespace(
                execute=lambda *args: PostgresCursor(raw.cursor()).execute(*args),
                cursor=lambda: PostgresCursor(raw.cursor()), commit=raw.commit,
                rollback=raw.rollback, close=raw.close,
            )

        processor = ProcurementMonitor(SimpleNamespace(get_connection=get_connection),
                                       fetch=lambda _: f.observed, clock=lambda: f.clock[0])
        barrier = threading.Barrier(2)

        def run(_):
            barrier.wait(timeout=5)
            return processor.process_next()

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(run, range(2))) == [False, True]
        advance(f)
        f.observed["petition"] = [{"id": "new"}]
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(run, range(2))) == [False, True]
        rows = f.conn.execute(sql.SQL("SELECT user_id FROM {}.email_delivery_status ORDER BY user_id").format(
            sql.Identifier(schema_name),
        )).fetchall()
        assert [row[0] for row in rows] == ["assigned", "manager"]
    finally:
        f.conn.rollback()
        # Only the exact schema created above is removed; no public/user tables.
        assert schema_name.startswith("bf_monitor_concurrency_") and len(schema_name) == 55
        f.conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema_name)))
        f.conn.commit()
