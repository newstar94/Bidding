"""Real PostgreSQL contract tests (enabled by BIDDING_TEST_POSTGRESQL_URL)."""

import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from urllib.parse import urlsplit, urlunsplit

import pytest


TEST_POSTGRESQL_URL = os.environ.get("BIDDING_TEST_POSTGRESQL_URL", "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_POSTGRESQL_URL,
    reason="BIDDING_TEST_POSTGRESQL_URL is required for PostgreSQL integration tests",
)


def _database_url(base_url, database_name):
    parsed = urlsplit(base_url)
    return urlunsplit(
        (parsed.scheme, parsed.netloc, f"/{database_name}", parsed.query, parsed.fragment)
    )


@pytest.fixture(scope="module")
def postgresql_database():
    import psycopg
    from psycopg import sql

    from backend.db.postgresql import PostgreSQLDatabase
    from backend.db.postgresql_migrations import initialize_postgresql_database

    database_name = f"bidding_test_{uuid.uuid4().hex[:12]}"
    maintenance_url = _database_url(TEST_POSTGRESQL_URL, "postgres")
    with psycopg.connect(maintenance_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name)))

    environment = {
        "ADMIN_PASSWORD": "Temporary-Pg-Integration-Only-2026!",
        "ADMIN_USERNAME": "pgintegrationadmin",
        "ADMIN_NAME": "PostgreSQL Integration Test",
        "ADMIN_EMAIL": "pgintegration@example.test",
        "DEFAULT_ORG_NAME": "PostgreSQL Integration Test",
        "POSTGRES_POOL_MIN_SIZE": "0",
        "POSTGRES_POOL_MAX_SIZE": "3",
    }
    database = PostgreSQLDatabase(
        _database_url(TEST_POSTGRESQL_URL, database_name),
        environ=environment,
    )
    try:
        assert initialize_postgresql_database(database, environment) == 1
        yield database, environment
    finally:
        database.close()
        with psycopg.connect(maintenance_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database_name)
                )
            )


def test_real_postgresql_bootstrap_is_idempotent_and_ready(postgresql_database):
    from backend.db.postgresql_migrations import initialize_postgresql_database
    from backend.startup import verify_database_readiness, verify_database_responsive

    database, environment = postgresql_database
    assert initialize_postgresql_database(database, environment) == 1
    assert verify_database_readiness(database, 1) is True
    verify_database_responsive(database, 1)

    connection = database.get_connection()
    try:
        assert connection.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()"
        ).fetchone()[0] == 46
        assert connection.execute(
            "SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = current_schema()"
        ).fetchone()[0] == 41
        extensions = {
            row[0]
            for row in connection.execute(
                "SELECT extname FROM pg_extension WHERE extname IN ('unaccent', 'pg_trgm')"
            ).fetchall()
        }
        assert extensions == {"unaccent", "pg_trgm"}
    finally:
        connection.close()
    stats = database.pool_stats()
    assert stats["in_use"] == 0
    assert stats["available"] == stats["size"]


def test_real_postgresql_lineage_uniqueness_sync_and_tombstone(postgresql_database):
    from psycopg.errors import CheckViolation, UniqueViolation

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        connection.execute(
            """
            INSERT INTO chu_dau_tu (
                id, organization_id, ma_chu_dau_tu, ten_chu_dau_tu
            ) VALUES (?, ?, ?, ?)
            """,
            ("cdt-pg-1", organization_id, "CDT-PG", "Bệnh viện Đấu thầu"),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id_goc, sync_version FROM chu_dau_tu WHERE id = ?",
            ("cdt-pg-1",),
        ).fetchone()
        assert tuple(row) == ("cdt-pg-1", 0)

        connection.execute(
            "UPDATE chu_dau_tu SET ten_chu_dau_tu = ? WHERE id = ?",
            ("Bệnh viện Mua sắm", "cdt-pg-1"),
        )
        connection.commit()
        sync_version = connection.execute(
            "SELECT sync_version FROM chu_dau_tu WHERE id = ?", ("cdt-pg-1",)
        ).fetchone()[0]
        assert sync_version > 0

        with pytest.raises(UniqueViolation):
            connection.execute(
                """
                INSERT INTO chu_dau_tu (
                    id, organization_id, ma_chu_dau_tu, ten_chu_dau_tu
                ) VALUES (?, ?, ?, ?)
                """,
                ("cdt-pg-2", organization_id, " cdt-pg ", "Bản trùng"),
            )
        connection.rollback()

        with pytest.raises(CheckViolation, match="LINEAGE_IMMUTABLE"):
            connection.execute(
                "UPDATE chu_dau_tu SET id_goc = ? WHERE id = ?",
                ("other-root", "cdt-pg-1"),
            )
        connection.rollback()

        connection.execute("DELETE FROM chu_dau_tu WHERE id = ?", ("cdt-pg-1",))
        connection.commit()
        tombstone = connection.execute(
            """
            SELECT delete_version FROM deleted_records
            WHERE organization_id = ? AND table_name = 'chu_dau_tu' AND record_id = ?
            """,
            (organization_id, "cdt-pg-1"),
        ).fetchone()
        assert tombstone is not None and tombstone[0] > sync_version
    finally:
        connection.close()


def test_real_postgresql_vietnamese_search_is_accent_insensitive(postgresql_database):
    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO chu_dau_tu (id, organization_id, ten_chu_dau_tu) VALUES (?, ?, ?)",
            ("cdt-search", organization_id, "Trung tâm Y tế Nguyễn Trãi"),
        )
        connection.commit()
        result = connection.execute(
            """
            SELECT id FROM chu_dau_tu
            WHERE organization_id = ?
              AND bidding_immutable_unaccent(lower(
                    COALESCE(ma_chu_dau_tu, '') || ' ' ||
                    COALESCE(ten_chu_dau_tu, '') || ' ' ||
                    COALESCE(ten_viet_tat, '') || ' ' ||
                    COALESCE(ma_so_thue, '')
                  )) LIKE ?
            """,
            (organization_id, "%nguyen trai%"),
        ).fetchall()
        assert [row[0] for row in result] == ["cdt-search"]
        connection.execute("SET LOCAL enable_seqscan = off")
        plan = "\n".join(
            row[0]
            for row in connection.execute(
                """
                    EXPLAIN SELECT id FROM chu_dau_tu
                    WHERE bidding_immutable_unaccent(lower(
                        COALESCE(ma_chu_dau_tu, '') || ' ' ||
                        COALESCE(ten_chu_dau_tu, '') || ' ' ||
                        COALESCE(ten_viet_tat, '') || ' ' ||
                        COALESCE(ma_so_thue, '')
                      )) LIKE ?
                """,
                    ("%nguyen trai%",),
            ).fetchall()
        )
        assert "idx_chu_dau_tu_search_trgm" in plan
    finally:
        connection.close()


def test_real_postgresql_search_matches_versioned_sqlite_fts_corpus(
    postgresql_database,
):
    from backend.db.db_utils import _ensure_fts_indexes
    from backend.db.postgresql_features import POSTGRESQL_SEARCH_COLUMNS
    from backend.sync.queries import (
        build_fts_match_query,
        build_postgresql_search_filter,
    )

    corpus_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "vietnamese_search_corpus.json"
    )
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    assert corpus["contractVersion"] == 1

    sqlite_connection = sqlite3.connect(":memory:")
    sqlite_connection.executescript(
        """
        CREATE TABLE ke_hoach_lcnt (
            organization_id TEXT, id TEXT, ma_ke_hoach TEXT,
            ten_ke_hoach TEXT, ten_du_an_du_toan TEXT
        );
        CREATE TABLE goi_thau (
            organization_id TEXT, id TEXT, ma_goi_thau TEXT, ten_goi_thau TEXT
        );
        CREATE TABLE chu_dau_tu (
            organization_id TEXT, id TEXT, ma_chu_dau_tu TEXT,
            ten_chu_dau_tu TEXT, ten_viet_tat TEXT, ma_so_thue TEXT
        );
        CREATE TABLE nha_thau (
            organization_id TEXT, id TEXT, ma_nha_thau TEXT,
            ten_nha_thau TEXT, ten_viet_tat TEXT, ma_so_thue TEXT
        );
        CREATE TABLE hop_dong (
            organization_id TEXT, id TEXT, so_hop_dong TEXT, ten_hop_dong TEXT
        );
        """
    )
    _ensure_fts_indexes(sqlite_connection.cursor())

    database, _environment = postgresql_database
    postgresql_connection = database.get_connection()
    try:
        postgresql_organization_id = postgresql_connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        table_order = {
            "chu_dau_tu": 0,
            "nha_thau": 1,
            "ke_hoach_lcnt": 2,
            "goi_thau": 3,
            "hop_dong": 4,
        }
        for record in sorted(
            corpus["records"], key=lambda item: table_order[item["table"]]
        ):
            table_name = record["table"]
            assert table_name in POSTGRESQL_SEARCH_COLUMNS
            values = record["values"]
            sqlite_columns = ["organization_id", "id", *values.keys()]
            sqlite_placeholders = ", ".join("?" for _column in sqlite_columns)
            sqlite_connection.execute(
                f"""INSERT INTO {table_name} ({", ".join(sqlite_columns)})
                    VALUES ({sqlite_placeholders})""",
                (corpus["organizationId"], record["id"], *values.values()),
            )
            postgresql_values = {**values, **record.get("requiredValues", {})}
            postgresql_columns = ["organization_id", "id", *postgresql_values.keys()]
            postgresql_placeholders = ", ".join(
                "?" for _column in postgresql_columns
            )
            postgresql_connection.execute(
                f"""INSERT INTO {table_name} ({", ".join(postgresql_columns)})
                    VALUES ({postgresql_placeholders})""",
                (
                    postgresql_organization_id,
                    record["id"],
                    *postgresql_values.values(),
                ),
            )
        sqlite_connection.commit()
        postgresql_connection.commit()

        for case in corpus["cases"]:
            table_name = case["table"]
            expected_ids = sorted(case["expectedIds"])
            sqlite_query = build_fts_match_query(case["query"])
            sqlite_ids = sorted(
                row[0]
                for row in sqlite_connection.execute(
                    f"""SELECT id FROM fts_{table_name}
                        WHERE fts_{table_name} MATCH ? AND organization_id = ?
                          AND id LIKE ?""",
                    (sqlite_query, corpus["organizationId"], "corpus-%"),
                ).fetchall()
            )
            postgresql_filter, postgresql_parameters = (
                build_postgresql_search_filter(table_name, case["query"])
            )
            postgresql_ids = sorted(
                row[0]
                for row in postgresql_connection.execute(
                    f"""SELECT id FROM {table_name}
                        WHERE organization_id = ? AND id LIKE ?
                          AND {postgresql_filter}""",
                    (
                        postgresql_organization_id,
                        "corpus-%",
                        *postgresql_parameters,
                    ),
                ).fetchall()
            )
            assert sqlite_ids == expected_ids, case
            assert postgresql_ids == expected_ids, case
            assert postgresql_ids == sqlite_ids, case

        indexed_filter, indexed_parameters = build_postgresql_search_filter(
            "chu_dau_tu", "nguyen tr"
        )
        postgresql_connection.execute("SET LOCAL enable_seqscan = off")
        query_plan = "\n".join(
            row[0]
            for row in postgresql_connection.execute(
                f"""EXPLAIN SELECT id FROM chu_dau_tu
                    WHERE {indexed_filter}""",
                tuple(indexed_parameters),
            ).fetchall()
        )
        assert "idx_chu_dau_tu_search_trgm" in query_plan
    finally:
        sqlite_connection.close()
        postgresql_connection.close()


def test_real_postgresql_rejects_unverified_email_change(postgresql_database):
    from psycopg.errors import CheckViolation

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
        with pytest.raises(CheckViolation, match="verified email change required"):
            connection.execute(
                "UPDATE tai_khoan SET email = ?, email_norm = ? WHERE id = ?",
                ("bypass@example.test", "bypass@example.test", user_id),
            )
        connection.rollback()
    finally:
        connection.close()


def test_real_postgresql_concurrent_sync_and_audit_writers_do_not_branch(
    postgresql_database,
):
    from backend.shared.audit_chain import insert_audit_row, inspect_audit_chain
    from backend.sync.repository import next_sync_version

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
    finally:
        connection.close()

    worker_count = 3
    barrier = threading.Barrier(worker_count)
    results = []
    errors = []
    result_lock = threading.Lock()

    def write(worker_id):
        connection = database.get_connection()
        try:
            barrier.wait(timeout=5)
            connection.execute("BEGIN")
            version = next_sync_version(connection.cursor(), organization_id)
            insert_audit_row(
                connection.cursor(),
                actor_user_id=f"worker-{worker_id}",
                organization_id=organization_id,
                action="postgresql.concurrent_test",
                target_type="integration",
                target_id=str(worker_id),
            )
            connection.commit()
            with result_lock:
                results.append(version)
        except BaseException as error:
            connection.rollback()
            with result_lock:
                errors.append(error)
        finally:
            connection.close()

    threads = [
        threading.Thread(target=write, args=(index,))
        for index in range(worker_count)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert len(results) == len(set(results)) == worker_count
    connection = database.get_connection()
    try:
        verification = inspect_audit_chain(connection.cursor())
        assert verification.valid is True
        assert verification.row_count >= worker_count
    finally:
        connection.close()


def test_real_postgresql_deadlock_is_rolled_back_and_retried(postgresql_database):
    from backend.db.retry import run_transaction_with_retry

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        connection.executemany(
            """INSERT INTO rate_limit_buckets
               (bucket_key, window_started_at, attempt_count, expires_at)
               VALUES (?, 1, 0, 4102444800)
               ON CONFLICT(bucket_key) DO UPDATE SET attempt_count = 0""",
            [("deadlock-a",), ("deadlock-b",)],
        )
        connection.commit()
    finally:
        connection.close()

    barrier = threading.Barrier(2)
    retry_counts = []
    errors = []
    result_lock = threading.Lock()

    def worker(first_key, second_key):
        attempts_seen = []

        def mutate(connection, attempt):
            attempts_seen.append(attempt)
            connection.execute(
                "UPDATE rate_limit_buckets SET attempt_count = attempt_count + 1 WHERE bucket_key = ?",
                (first_key,),
            )
            if attempt == 1:
                barrier.wait(timeout=5)
            connection.execute(
                "UPDATE rate_limit_buckets SET attempt_count = attempt_count + 1 WHERE bucket_key = ?",
                (second_key,),
            )

        try:
            run_transaction_with_retry(database, mutate, max_attempts=3)
            with result_lock:
                retry_counts.append(len(attempts_seen) - 1)
        except BaseException as error:
            with result_lock:
                errors.append(error)

    threads = [
        threading.Thread(target=worker, args=("deadlock-a", "deadlock-b")),
        threading.Thread(target=worker, args=("deadlock-b", "deadlock-a")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert sum(retry_counts) >= 1
    connection = database.get_connection()
    try:
        counts = connection.execute(
            """SELECT bucket_key, attempt_count FROM rate_limit_buckets
               WHERE bucket_key IN ('deadlock-a', 'deadlock-b') ORDER BY bucket_key"""
        ).fetchall()
        assert [row[1] for row in counts] == [2, 2]
    finally:
        connection.close()


def test_real_postgresql_row_version_compare_and_swap_prevents_lost_update(
    postgresql_database,
):
    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        record_id = f"status-cas-{uuid.uuid4().hex[:8]}"
        connection.execute(
            """
            INSERT INTO trang_thai_ho_so_giay (
                id, organization_id, name, color, row_version
            ) VALUES (?, ?, ?, ?, 1)
            """,
            (record_id, organization_id, "Ban đầu", "#111111"),
        )
        connection.commit()
    finally:
        connection.close()

    barrier = threading.Barrier(2)
    row_counts = []
    errors = []
    result_lock = threading.Lock()

    def update_once(name):
        worker_connection = database.get_connection()
        try:
            isolation = worker_connection.execute(
                "SHOW transaction_isolation"
            ).fetchone()[0]
            assert isolation == "read committed"
            barrier.wait(timeout=5)
            result = worker_connection.execute(
                """
                UPDATE trang_thai_ho_so_giay
                SET name = ?, row_version = row_version + 1
                WHERE organization_id = ? AND id = ? AND row_version = 1
                """,
                (name, organization_id, record_id),
            )
            worker_connection.commit()
            with result_lock:
                row_counts.append(result.rowcount)
        except BaseException as error:
            worker_connection.rollback()
            with result_lock:
                errors.append(error)
        finally:
            worker_connection.close()

    threads = [
        threading.Thread(target=update_once, args=("Writer A",)),
        threading.Thread(target=update_once, args=("Writer B",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert sorted(row_counts) == [0, 1]
    connection = database.get_connection()
    try:
        row = connection.execute(
            """
            SELECT name, row_version
            FROM trang_thai_ho_so_giay
            WHERE organization_id = ? AND id = ?
            """,
            (organization_id, record_id),
        ).fetchone()
        assert row[0] in {"Writer A", "Writer B"}
        assert row[1] == 2
    finally:
        connection.close()


def test_real_postgresql_sync_idempotency_replay_returns_original_result(
    postgresql_database,
    monkeypatch,
):
    from backend.auth.auth_helper import SessionRole
    from backend.db import db_utils
    import backend.sync.service as sync_service

    class Request:
        headers = {}
        cookies = {}
        query_params = {}

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
    finally:
        connection.close()

    role = SessionRole("super_admin", user_id)
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(
        sync_service,
        "get_active_org",
        lambda _request, _user_id: organization_id,
    )
    mutation_id = f"pg-replay-{uuid.uuid4().hex[:12]}"
    record_id = f"status-replay-{uuid.uuid4().hex[:8]}"
    original_payload = {
        "clientMutationId": mutation_id,
        "custompaperstatuses": [
            {"id": record_id, "name": "Kết quả gốc", "color": "#123456"}
        ],
    }
    replay_payload = {
        "clientMutationId": mutation_id,
        "custompaperstatuses": [
            {
                "id": record_id,
                "name": "Không được ghi đè",
                "color": "#654321",
                "expectedVersion": 1,
            }
        ],
    }

    first = sync_service._process_sync_request_blocking(Request(), original_payload)
    replay = sync_service._process_sync_request_blocking(Request(), replay_payload)
    assert first.status_code == replay.status_code == 200
    assert json.loads(first.body) == json.loads(replay.body)

    connection = database.get_connection()
    try:
        row = connection.execute(
            """
            SELECT name, color, row_version
            FROM trang_thai_ho_so_giay
            WHERE organization_id = ? AND id = ?
            """,
            (organization_id, record_id),
        ).fetchone()
        assert tuple(row) == ("Kết quả gốc", "#123456", 1)
        assert connection.execute(
            """
            SELECT count(*) FROM sync_mutations
            WHERE organization_id = ? AND actor_user_id = ?
              AND client_mutation_id = ?
            """,
            (organization_id, user_id, mutation_id),
        ).fetchone()[0] == 1
    finally:
        connection.close()


def test_real_postgresql_websocket_outbox_is_ordered_and_cleanup_is_portable(
    postgresql_database,
    monkeypatch,
):
    from backend.sync import websocket as websocket_module

    database, _environment = postgresql_database
    monkeypatch.setattr(websocket_module, "database", database)
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
    finally:
        connection.close()
    first_id = websocket_module._latest_broker_event_id()
    websocket_module._store_broker_event(
        "broadcast",
        organization_id=organization_id,
        payload={"event": "db_changed"},
    )
    websocket_module._store_broker_event("revoke_user", user_id=user_id)

    events = websocket_module._load_broker_events(first_id)
    assert [event["event_type"] for event in events] == ["broadcast", "revoke_user"]
    assert events[0]["organization_id"] == organization_id
    assert json.loads(events[0]["payload_json"]) == {"event": "db_changed"}
    assert events[1]["user_id"] == user_id

    connection = database.get_connection()
    try:
        connection.execute(
            "UPDATE websocket_events SET created_at = ? WHERE id = ?",
            ("2000-01-01 00:00:00", events[0]["id"]),
        )
        connection.commit()
    finally:
        connection.close()
    websocket_module._cleanup_broker_events()
    remaining = websocket_module._load_broker_events(first_id)
    assert [event["id"] for event in remaining] == [events[1]["id"]]


def test_real_postgresql_sensitive_policy_stays_fail_closed_per_workspace(
    postgresql_database,
):
    from backend.shared.sensitive_data import (
        resolve_sensitive_read_policy,
        serialize_sensitive_read_item,
    )

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        organization_id = connection.execute(
            "SELECT organization_id FROM thanh_vien_to_chuc LIMIT 1"
        ).fetchone()[0]
        user_id = f"pg-sensitive-{uuid.uuid4().hex[:10]}"
        email = f"{user_id}@example.test"
        connection.execute(
            """
            INSERT INTO tai_khoan (
                id, mat_khau, ho_ten, vai_tro, email, email_norm, da_xac_minh
            ) VALUES (?, ?, ?, 'user', ?, ?, 1)
            """,
            (user_id, "not-a-login-credential", "Read-only member", email, email),
        )
        connection.execute(
            """
            INSERT INTO thanh_vien_to_chuc (
                user_id, organization_id, vai_tro_trong_to_chuc
            ) VALUES (?, ?, 'employee')
            """,
            (user_id, organization_id),
        )
        connection.execute(
            """
            INSERT INTO ma_tran_phan_quyen (
                id, organization_id, emp_id, nhathau, chuyengia
            ) VALUES (?, ?, ?, 'view', 'view')
            """,
            (f"permission-{user_id}", organization_id, user_id),
        )
        connection.commit()

        policy = resolve_sensitive_read_policy(
            connection.cursor(),
            "user",
            user_id,
            organization_id,
            {"nha_thau", "chuyen_gia"},
        )
        assert policy.can_view_contractor_financials is False
        assert policy.can_view_expert_details is False
        assert policy.can_view_signature_images is False

        contractor = serialize_sensitive_read_item(
            "nha_thau",
            {
                "id": "contractor-sensitive",
                "soTaiKhoan": "1234567890123",
                "noiMoTaiKhoan": "Ngân hàng thử nghiệm",
                "maNganHang": "001",
                "anhDau": "/private/stamp.png",
            },
            policy,
        )
        expert = serialize_sensitive_read_item(
            "chuyen_gia",
            {
                "id": "expert-sensitive",
                "soCCCD": "001234567890",
                "anhChungChi": "/private/certificate.png",
                "anhChuKy": "/private/signature.png",
            },
            policy,
        )
        assert contractor["soTaiKhoan"] == "*********0123"
        assert contractor["noiMoTaiKhoan"] is None
        assert contractor["maNganHang"] is None
        assert contractor["anhDau"] is None
        assert expert["soCCCD"] == "********7890"
        assert expert["anhChungChi"] is None
        assert expert["anhChuKy"] is None

        other_workspace_policy = resolve_sensitive_read_policy(
            connection.cursor(),
            "user",
            user_id,
            f"other-{organization_id}",
            {"nha_thau", "chuyen_gia"},
        )
        assert other_workspace_policy.can_view_contractor_financials is False
        assert other_workspace_policy.can_view_expert_details is False
        assert other_workspace_policy.can_view_signature_images is False
    finally:
        connection.close()


def test_real_postgresql_roles_are_idempotent_and_least_privilege(
    postgresql_database,
):
    import psycopg
    from psycopg import sql

    from scripts.provision_postgresql_roles import provision_roles

    database, _environment = postgresql_database
    suffix = uuid.uuid4().hex[:8]
    roles = {
        "migration": f"bf_migrator_{suffix}",
        "application": f"bf_app_{suffix}",
        "monitor": f"bf_monitor_{suffix}",
    }
    passwords = {
        "migration": f"Migration-{suffix}-only!",
        "application": f"Application-{suffix}-only!",
        "monitor": f"Monitor-{suffix}-only!",
    }
    try:
        first = provision_roles(
            database.dsn,
            roles,
            passwords,
            require_verified_tls=False,
            connection_limits={"migration": 2, "application": 7, "monitor": 3},
        )
        second = provision_roles(
            database.dsn,
            roles,
            passwords,
            require_verified_tls=False,
            connection_limits={"migration": 2, "application": 7, "monitor": 3},
        )
        assert first == second
        assert first["passwordsPrinted"] is False

        with psycopg.connect(database.dsn) as connection:
            attributes = {
                row[0]: tuple(row[1:])
                for row in connection.execute(
                    """
                    SELECT rolname, rolsuper, rolcreatedb, rolcreaterole,
                           rolbypassrls, rolconnlimit
                    FROM pg_roles WHERE rolname = ANY(%s)
                    """,
                    (list(roles.values()),),
                ).fetchall()
            }
            assert attributes[roles["migration"]] == (False, False, False, False, 2)
            assert attributes[roles["application"]] == (False, False, False, False, 7)
            assert attributes[roles["monitor"]] == (False, False, False, False, 3)
            assert connection.execute(
                "SELECT has_schema_privilege(%s, 'public', 'CREATE')",
                (roles["migration"],),
            ).fetchone()[0] is True
            assert connection.execute(
                "SELECT has_schema_privilege(%s, 'public', 'CREATE')",
                (roles["application"],),
            ).fetchone()[0] is False
            assert connection.execute(
                "SELECT has_table_privilege(%s, 'goi_thau', 'SELECT,INSERT,UPDATE,DELETE')",
                (roles["application"],),
            ).fetchone()[0] is True
            assert connection.execute(
                "SELECT has_table_privilege(%s, 'goi_thau', 'SELECT')",
                (roles["monitor"],),
            ).fetchone()[0] is True
            assert connection.execute(
                "SELECT has_table_privilege(%s, 'goi_thau', 'INSERT')",
                (roles["monitor"],),
            ).fetchone()[0] is False
    finally:
        with psycopg.connect(database.dsn, autocommit=True) as connection:
            connection.execute(
                sql.SQL("REVOKE pg_read_all_data, pg_monitor FROM {}").format(
                    sql.Identifier(roles["monitor"])
                )
            )
            for role_name in roles.values():
                connection.execute(
                    sql.SQL("DROP OWNED BY {} CASCADE").format(
                        sql.Identifier(role_name)
                    )
                )
            for role_name in (
                roles["application"],
                roles["monitor"],
                roles["migration"],
            ):
                connection.execute(
                    sql.SQL("DROP ROLE IF EXISTS {}").format(
                        sql.Identifier(role_name)
                    )
                )


def test_real_postgresql_fresh_install_and_rollback_recreate_rehearsal():
    from scripts.rehearse_postgresql_fresh_install import run_rehearsal

    result = run_rehearsal(TEST_POSTGRESQL_URL, require_verified_tls=False)
    assert result["mode"] == "fresh-install-no-legacy-data"
    assert result["passed"] is True
    assert result["secretsPrinted"] is False
    for phase in ("initialInstall", "rollbackRecreate"):
        assert result[phase]["schemaVersion"] == 1
        assert result[phase]["tableCount"] == 46
        assert result[phase]["userCount"] == 1
        assert result[phase]["organizationCount"] == 1
        assert result[phase]["applicationCanCreateSchemaObjects"] is False


def test_real_postgresql_payload_types_and_order_match_sqlite(
    postgresql_database,
    monkeypatch,
    tmp_path,
):
    from backend.db import db_utils
    from backend.db.db_helper import SQLiteDatabase
    from backend.sync.mapper import map_db_to_json

    sqlite_database = SQLiteDatabase(tmp_path / "dialect-parity.db")
    with monkeypatch.context() as patch:
        patch.setattr(db_utils, "database", sqlite_database)
        patch.setenv("ADMIN_PASSWORD", "Dialect-parity-only-2026!")
        patch.setenv("ADMIN_EMAIL", "dialect-parity@example.test")
        db_utils.khoi_tao_va_di_tru_he_thong()

    postgresql, _environment = postgresql_database
    sqlite_connection = sqlite_database.get_connection()
    postgresql_connection = postgresql.get_connection()
    suffix = uuid.uuid4().hex[:8]
    try:
        sqlite_org = sqlite_connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
        postgresql_org = postgresql_connection.execute(
            "SELECT id FROM to_chuc LIMIT 1"
        ).fetchone()[0]

        def seed(connection, organization_id):
            investor_id = f"parity-investor-{suffix}"
            plan_id = f"parity-plan-{suffix}"
            connection.execute(
                """
                INSERT INTO chu_dau_tu (
                    id, organization_id, ma_chu_dau_tu, ten_chu_dau_tu
                ) VALUES (?, ?, ?, ?)
                """,
                (
                    investor_id,
                    organization_id,
                    f"CDT-{suffix}",
                    "Chủ đầu tư parity",
                ),
            )
            connection.execute(
                """
                INSERT INTO ke_hoach_lcnt (
                    id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
                    ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                    ngay_phe_duyet, quyet_dinh_phe_duyet,
                    is_tong_muc_tu_dong
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    plan_id,
                    organization_id,
                    plan_id,
                    f"KH-{suffix}",
                    "Kế hoạch parity",
                    "Dự toán parity",
                    "Dự án",
                    investor_id,
                    "2026-07-18",
                    f"QD-{suffix}",
                ),
            )
            for index in (2, 1):
                package_id = f"parity-package-{suffix}-{index}"
                connection.execute(
                    """
                    INSERT INTO goi_thau (
                        id, organization_id, id_goc, ma_goi_thau,
                        ke_hoach_id, ten_goi_thau, gia_goi_thau,
                        thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
                        thoi_gian_bat_dau_to_chuc, trang_thai,
                        ngay_quyet_dinh, ty_le_bao_dam_hop_dong,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        package_id,
                        organization_id,
                        package_id,
                        f"GT-{index:04d}",
                        plan_id,
                        f"Gói parity {index}",
                        1_234_567 + index,
                        "90 ngày",
                        "Ngân sách",
                        "Quý III/2026",
                        "2026-07-01",
                        "PREPARING",
                        "2026-07-18",
                        12.34,
                        "2026-07-18 07:30:45",
                        "2026-07-18 07:30:45",
                    ),
                )
            connection.commit()

        seed(sqlite_connection, sqlite_org)
        seed(postgresql_connection, postgresql_org)

        def payloads(connection, organization_id):
            rows = connection.execute(
                """
                SELECT * FROM goi_thau
                WHERE organization_id = ? AND id LIKE ?
                ORDER BY ma_goi_thau, id
                """,
                (organization_id, f"parity-package-{suffix}-%"),
            ).fetchall()
            result = []
            for row in rows:
                payload = map_db_to_json("goi_thau", dict(row))
                payload.pop("syncVersion", None)
                result.append(payload)
            return result

        sqlite_payloads = payloads(sqlite_connection, sqlite_org)
        postgresql_payloads = payloads(postgresql_connection, postgresql_org)
        for payload in sqlite_payloads:
            payload["organizationId"] = "<organization>"
        for payload in postgresql_payloads:
            payload["organizationId"] = "<organization>"
        assert [item["maGoiThau"] for item in sqlite_payloads] == [
            "GT-0001",
            "GT-0002",
        ]
        assert postgresql_payloads == sqlite_payloads
        assert postgresql_payloads[0]["giaGoiThau"] == "1234568"
        assert postgresql_payloads[0]["isLatest"] == 1
        assert postgresql_payloads[0]["ngayQuyetDinh"] == "2026-07-18"
        assert postgresql_payloads[0]["tyLeBaoDamHopDong"] == 12.34
        assert postgresql_payloads[0]["nhaThauTrungThauId"] is None
        assert postgresql_payloads[0]["createdAt"] == "2026-07-18 07:30:45"
    finally:
        sqlite_connection.close()
        postgresql_connection.close()


def test_real_postgresql_document_worker_admission_is_cluster_wide(
    postgresql_database,
):
    from backend.documents.distributed_admission import try_acquire_document_lease

    database, _environment = postgresql_database
    connection = database.get_connection()
    try:
        connection.execute("DELETE FROM document_worker_leases")
        connection.commit()
    finally:
        connection.close()

    first = try_acquire_document_lease(
        database, max_concurrency=2, ttl_seconds=60
    )
    second = try_acquire_document_lease(
        database, max_concurrency=2, ttl_seconds=60
    )
    rejected = try_acquire_document_lease(
        database, max_concurrency=2, ttl_seconds=60
    )
    assert first is not None and first.lease_id
    assert second is not None and second.lease_id
    assert rejected is None

    first.release()
    replacement = try_acquire_document_lease(
        database, max_concurrency=2, ttl_seconds=60
    )
    assert replacement is not None and replacement.lease_id

    connection = database.get_connection()
    try:
        connection.execute(
            "UPDATE document_worker_leases SET expires_at = 1"
        )
        connection.commit()
    finally:
        connection.close()
    after_expiry = try_acquire_document_lease(
        database, max_concurrency=1, ttl_seconds=60
    )
    assert after_expiry is not None and after_expiry.lease_id
    after_expiry.release()


def test_real_postgresql_permission_matrix_covers_none_view_and_edit(
    postgresql_database,
):
    from backend.shared.access_policy import has_module_permission

    database, _environment = postgresql_database
    connection = database.get_connection()
    modules = (
        "kehoach",
        "goithau",
        "chudautu",
        "nhathau",
        "chuyengia",
        "hopdong",
        "thongtinmothau",
    )
    suffix = uuid.uuid4().hex[:8]
    user_id = f"permission-user-{suffix}"
    try:
        organization_id = connection.execute(
            "SELECT id FROM to_chuc LIMIT 1"
        ).fetchone()[0]
        email = f"{user_id}@example.test"
        connection.execute(
            """
            INSERT INTO tai_khoan (
                id, mat_khau, ho_ten, vai_tro, email, email_norm
            ) VALUES (?, 'not-a-login-credential', 'Permission user', 'user', ?, ?)
            """,
            (user_id, email, email),
        )
        connection.execute(
            """
            INSERT INTO thanh_vien_to_chuc (
                user_id, organization_id, vai_tro_trong_to_chuc
            ) VALUES (?, ?, 'employee')
            """,
            (user_id, organization_id),
        )
        connection.execute(
            """
            INSERT INTO ma_tran_phan_quyen (id, organization_id, emp_id)
            VALUES (?, ?, ?)
            """,
            (f"permission-matrix-{suffix}", organization_id, user_id),
        )
        connection.commit()

        for module_name in modules:
            for mode, can_view, can_edit in (
                ("", False, False),
                ("view", True, False),
                ("edit", True, True),
            ):
                connection.execute(
                    f"UPDATE ma_tran_phan_quyen SET {module_name} = ? "
                    "WHERE organization_id = ? AND emp_id = ?",
                    (mode, organization_id, user_id),
                )
                connection.commit()
                cursor = connection.cursor()
                assert has_module_permission(
                    cursor,
                    "user",
                    user_id,
                    organization_id,
                    module_name,
                    "view",
                ) is can_view
                assert has_module_permission(
                    cursor,
                    "user",
                    user_id,
                    organization_id,
                    module_name,
                    "edit",
                ) is can_edit
        assert has_module_permission(
            connection.cursor(),
            "user",
            user_id,
            f"other-{organization_id}",
            "kehoach",
            "view",
        ) is False
    finally:
        connection.close()
