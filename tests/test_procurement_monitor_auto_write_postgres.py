"""ADR 0091 scheduled clarification writes on real PostgreSQL TEMP tables.

Builds on the ADR 0090 harness; no production rows, source requests or SMTP.
"""

import json
import os

from cryptography.fernet import Fernet
import pytest

import backend.procurement_monitor.clarification_writer as writer
from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.procurement_monitor.clarification_merge import local_row_id
from backend.procurement_monitor.worker import MAX_ATTEMPTS
from tests.test_procurement_monitor_postgres import advance, emails, monitor_db  # noqa: F401 - shared fixture


NOTICE = "IB2600271825"
Q1 = {"sourceRequestId": "up-1", "sourceRequestNo": "REQ01", "requestedAt": "2026-10-16T09:00:41", "content": "Câu hỏi về bảo hành"}
A1 = {"sourceRequestId": "up-1", "sourceRequestNo": "REQ01", "respondedAt": "2026-10-17T10:30:00", "content": "Trả lời: 24 tháng"}
Q2 = {"sourceRequestId": "up-2", "sourceRequestNo": "REQ02", "requestedAt": "2026-10-17T11:00:00", "content": "Câu hỏi về tiến độ"}


def temp_table(name):
    spec = dict(SCHEMA_DINH_NGHIA[name])
    # TEMP tables cannot reference the permanent parents; keep CHECKs only.
    spec["foreign_keys"] = [item for item in spec.get("foreign_keys", []) if not item.strip().upper().startswith("FOREIGN KEY")]
    return build_create_table_sql(name, spec).replace("CREATE TABLE ", "CREATE TEMP TABLE ", 1)


@pytest.fixture
def write_db(monitor_db):  # noqa: F811 - pytest fixture injection
    f = monitor_db
    for ddl in (
        "ALTER TABLE goi_thau ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE goi_thau ADD COLUMN phien_ban TEXT NOT NULL DEFAULT '00'",
        "ALTER TABLE goi_thau ADD COLUMN sync_version INTEGER DEFAULT 0",
        "ALTER TABLE goi_thau ADD COLUMN updated_at TEXT",
        *(temp_table(name) for name in (
            "goi_thau_lam_ro", "sync_metadata", "audit_chain_heads", "audit_log",
            "nhat_ky_thuc_hien", "websocket_events", "usage_credit_grants",
        )),
    ):
        f.conn.execute(ddl)
    f.conn.commit()
    return f


def set_source(f, versions):
    f.observed["clarification"] = [row for rows in versions.values() for row in (*rows["requests"], *rows["responses"])]
    f.observed["clarificationVersions"] = json.loads(json.dumps(versions))


def armed(f, versions):
    """Silent first observation at 08:30, then the 14:30 slot is due."""
    set_source(f, versions)
    assert f.worker.process_next()
    advance(f)


def lam_ro(f, package="package"):
    return [dict(row) for row in f.conn.execute(
        "SELECT * FROM goi_thau_lam_ro WHERE goi_thau_id = ? ORDER BY loai DESC, sort_order, id", (package,),
    ).fetchall()]


def package_row(f):
    return dict(f.conn.execute("SELECT * FROM goi_thau").fetchone())


def email_html(f):
    key = Fernet(os.environ["EMAIL_OUTBOX_ENCRYPTION_KEY"].encode())
    return key.decrypt(emails(f)[0]["body_ciphertext"].encode()).decode()


def enforce_credits(monkeypatch):
    monkeypatch.setenv("COMMERCIAL_POLICY_ENABLED", "true")
    monkeypatch.setenv("COMMERCIAL_POLICY_MODE", "enforce")
    monkeypatch.setenv("PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED", "true")
    monkeypatch.delenv("TRIAL_FULL_ACCESS_ENABLED", raising=False)


def grant(f, *, source, expires_at, remaining=10, owner=("organization", "org")):
    kind, identifier = owner
    f.conn.execute(
        """INSERT INTO usage_credit_grants (id, account_user_id, organization_id, owner_kind, feature,
               total, remaining, reserved, source, release_id, policy_checksum, issued_at, expires_at)
           VALUES (?, ?, ?, ?, 'procurement.source_fetch', 10, ?, 0, ?, 'release', ?, 1, ?)""",
        (f"grant-{source}-{expires_at}", identifier if kind == "account" else None,
         identifier if kind == "organization" else None, kind, remaining, source, "0" * 64, int(expires_at)),
    )
    f.conn.commit()


def test_new_clarification_is_appended_with_system_actor_and_version_bump(write_db):
    f = write_db
    armed(f, {"00": {"requests": [Q1], "responses": []}})
    assert not lam_ro(f)  # The silent baseline never writes.
    set_source(f, {"00": {"requests": [Q1], "responses": [A1]}})
    assert f.worker.process_next()

    rows = lam_ro(f)
    assert [(row["id"], row["loai"], row["thoi_gian"], row["noi_dung"]) for row in rows] == [
        (local_row_id("package", NOTICE, "00", "request", "REQ01"), "yeu_cau", "2026-10-16 09:00:00", Q1["content"]),
        (local_row_id("package", NOTICE, "00", "response", "REQ01"), "tra_loi", "2026-10-17 10:30:00", A1["content"]),
    ]
    package = package_row(f)
    assert package["row_version"] == 2 and package["sync_version"] == 1
    assert all(row["sync_version"] == 1 for row in rows)
    # A stale editor's CAS on the previous version no longer matches.
    assert f.conn.execute("UPDATE goi_thau SET ten_goi_thau = 'stale' WHERE id = 'package' AND row_version = 1").rowcount == 0
    audit = dict(f.conn.execute("SELECT * FROM audit_log").fetchone())
    assert audit["actor_user_id"] is None and audit["action"] == "procurement_monitor.clarification_auto_write"
    assert json.loads(audit["metadata_json"])["rowIds"] == [row["id"] for row in rows]
    activity = dict(f.conn.execute("SELECT * FROM nhat_ky_thuc_hien").fetchone())
    assert activity["actor_name_snapshot"] == "Hệ thống" and activity["action"] == "goithau.updated"
    assert json.loads(activity["metadata_json"])["changedFields"] == ["yeu_cau_lam_ro_list", "tra_loi_lam_ro_list"]
    event = json.loads(f.conn.execute("SELECT payload_json FROM websocket_events").fetchone()[0])
    assert event == {"type": "sync_update", "table": "goithau", "id": "package", "syncVersion": 1}
    html = email_html(f)
    assert "Đã tự cập nhật 1 yêu cầu và 1 trả lời làm rõ" in html
    assert Q1["content"] not in html and A1["content"] not in html


def test_manual_rows_are_kept_and_matching_content_is_not_duplicated(write_db):
    f = write_db
    armed(f, {"00": {"requests": [Q1], "responses": []}})
    f.conn.execute("""INSERT INTO goi_thau_lam_ro (id, organization_id, owner_type, goi_thau_id, loai, thoi_gian, noi_dung, sort_order)
                      VALUES ('lr-manual', 'org', 'organization', 'package', 'yeu_cau', '2026-10-16 09:00:00', 'Câu hỏi về bảo hành  ', 0),
                             ('lr-draft', 'org', 'organization', 'package', 'yeu_cau', NULL, 'Đang soạn', 1)""")
    f.conn.commit()
    set_source(f, {"00": {"requests": [Q1], "responses": [A1]}})
    assert f.worker.process_next()
    rows = lam_ro(f)
    assert [row["id"] for row in rows if row["loai"] == "yeu_cau"] == ["lr-manual", "lr-draft"]
    assert [row["noi_dung"] for row in rows if row["loai"] == "yeu_cau"] == ["Câu hỏi về bảo hành  ", "Đang soạn"]
    assert [row["noi_dung"] for row in rows if row["loai"] == "tra_loi"] == [A1["content"]]


def test_rows_only_on_a_newer_notice_version_are_reported_not_written(write_db):
    f = write_db
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [], "responses": []}, "01": {"requests": [Q2], "responses": []}})
    assert f.worker.process_next()
    assert not lam_ro(f) and package_row(f)["row_version"] == 1
    assert "phiên bản TBMT mới hơn" in email_html(f)


@pytest.mark.parametrize(("grants", "written"), [
    ([], False),
    ([("purchase", 9_999_999_999, 10)], False),
    ([("admin", 9_999_999_999, 10)], False),
    ([("plan", 1_000, 10)], False),
    ([("plan", 9_999_999_999, 0)], True),
])
def test_only_unexpired_plan_grants_enable_writes_when_credits_are_enforced(write_db, monkeypatch, grants, written):
    f = write_db
    enforce_credits(monkeypatch)
    for source, expires_at, remaining in grants:
        grant(f, source=source, expires_at=expires_at, remaining=remaining)
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    assert f.worker.process_next()
    assert bool(lam_ro(f)) is written
    expected = "Đã tự cập nhật" if written else "không có lấy dữ liệu tự động"
    assert expected in email_html(f)
    balances = [tuple(row) for row in f.conn.execute("SELECT source, remaining, reserved FROM usage_credit_grants ORDER BY id")]
    assert balances == sorted((source, remaining, 0) for source, _, remaining in grants)  # Never debited.


def test_personal_workspace_uses_the_account_plan_grant(write_db, monkeypatch):
    f = write_db
    enforce_credits(monkeypatch)
    f.conn.execute("UPDATE goi_thau SET owner_type = 'personal', organization_id = 'personal:assigned'")
    f.conn.execute("UPDATE ke_hoach_lcnt SET organization_id = 'personal:assigned'")
    f.conn.commit()
    grant(f, source="plan", expires_at=9_999_999_999, owner=("account", "assigned"))
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    assert f.worker.process_next()
    assert [(row["organization_id"], row["owner_type"]) for row in lam_ro(f)] == [("personal:assigned", "personal")]


def test_busy_serialization_rows_defer_then_email_on_last_attempt(write_db, monkeypatch):
    f = write_db
    monkeypatch.setattr(writer, "_lock_serialization_rows", lambda *_: False)
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    for attempt in range(1, MAX_ATTEMPTS):
        assert f.worker.process_next()
        state = dict(f.conn.execute("SELECT * FROM procurement_monitor_state").fetchone())
        assert state["last_error"] == "AUTO_WRITE_BUSY" and not emails(f)
        assert json.loads(state["seen_json"])["clarification"] == []
        f.clock[0] += 300 * attempt + 1
    assert f.worker.process_next()
    assert not lam_ro(f) and package_row(f)["row_version"] == 1
    assert "đang thay đổi" in email_html(f)
    assert json.loads(f.conn.execute("SELECT seen_json FROM procurement_monitor_state").fetchone()[0])["clarification"]


def test_rollback_switch_keeps_email_only_behavior(write_db, monkeypatch):
    f = write_db
    monkeypatch.setenv("PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED", "false")
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    assert f.worker.process_next()
    assert not lam_ro(f)
    assert "tự cập nhật" not in email_html(f)


def test_outbox_failure_rolls_back_the_write(write_db, monkeypatch):
    import backend.notifications.service as service

    f = write_db
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    original = service.create_email_deliveries
    def fail(*_):
        raise RuntimeError("simulated outbox failure")
    monkeypatch.setattr(service, "create_email_deliveries", fail)
    assert f.worker.process_next()
    assert not lam_ro(f) and package_row(f)["row_version"] == 1
    assert f.conn.execute("SELECT count(*) FROM audit_log").fetchone()[0] == 0
    assert f.conn.execute("SELECT count(*) FROM websocket_events").fetchone()[0] == 0
    monkeypatch.setattr(service, "create_email_deliveries", original)
    f.clock[0] += 301
    assert f.worker.process_next()
    assert len(lam_ro(f)) == 1 and package_row(f)["row_version"] == 2


def test_write_does_not_wait_for_recipients_and_repeats_idempotently(write_db):
    f = write_db
    armed(f, {"00": {"requests": [], "responses": []}})
    f.conn.execute("DELETE FROM thanh_vien_to_chuc")
    f.conn.commit()
    set_source(f, {"00": {"requests": [Q1], "responses": []}})
    assert f.worker.process_next()
    assert len(lam_ro(f)) == 1
    state = dict(f.conn.execute("SELECT * FROM procurement_monitor_state").fetchone())
    assert state["last_error"] == "NO_ELIGIBLE_RECIPIENT"
    assert json.loads(state["seen_json"])["clarification"] == []  # Content stays unseen for email.
    f.clock[0] += 301
    assert f.worker.process_next()
    assert len(lam_ro(f)) == 1 and package_row(f)["row_version"] == 2


def test_cloned_package_version_does_not_receive_duplicates(write_db):
    f = write_db
    armed(f, {"00": {"requests": [], "responses": []}})
    set_source(f, {"00": {"requests": [Q1], "responses": [A1]}})
    assert f.worker.process_next()
    # A new physical version clones child rows with fresh, non-source ids.
    f.conn.execute("UPDATE goi_thau SET id_goc = 'package', id = 'new-version'")
    f.conn.execute("UPDATE goi_thau_lam_ro SET goi_thau_id = 'new-version', id = 'lr-' || md5(id)")
    f.conn.execute("UPDATE phan_cong_nhan_su SET id_muc_tieu = 'new-version' WHERE id_muc_tieu = 'package'")
    f.conn.commit()
    advance(f, 18)
    set_source(f, {"00": {"requests": [Q1, Q2], "responses": [A1]}})
    assert f.worker.process_next()
    contents = [row["noi_dung"] for row in lam_ro(f, "new-version")]
    assert sorted(contents) == sorted([Q1["content"], Q2["content"], A1["content"]])
