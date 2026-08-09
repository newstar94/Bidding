import json
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from types import SimpleNamespace
import uuid

import psycopg
import pytest

from backend.auth import admin_user_routes
from backend.auth.session_utils import OrgPermissionError
from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.sync.command import SyncActorContext, SyncMutationEnvelope
from backend.sync.service import _prepare_sync_transaction
from backend.shared.workspace_scope import (
    lock_personal_workspace_mutations,
    personal_scope_id,
)


def _test_database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'") or None
    return None


def test_account_deletion_runbook_keeps_legal_decisions_external():
    runbook = (
        Path(__file__).resolve().parents[1]
        / "deploy"
        / "runbooks"
        / "account-deletion-retention.md"
    ).read_text(encoding="utf-8")

    for required_contract in (
        "ACCOUNT_DELETION_RETENTION_REVIEW_REQUIRED",
        "record_snapshot_json",
        "legal hold",
        "không tự purge",
        "không thêm `ON DELETE CASCADE`",
    ):
        assert required_contract in runbook


class _ConnectionProxy:
    def __init__(self, raw_connection):
        self._raw_connection = raw_connection

    def cursor(self):
        return PostgresCursor(self._raw_connection.cursor())

    def commit(self):
        self._raw_connection.commit()

    def rollback(self):
        self._raw_connection.rollback()

    def close(self):
        if not self._raw_connection.closed:
            self._raw_connection.rollback()
            self._raw_connection.close()


class _DatabaseProxy:
    def __init__(self, database_url):
        self.database_url = database_url

    def get_connection(self):
        return _ConnectionProxy(
            psycopg.connect(
                self.database_url,
                row_factory=compat_row_factory,
            )
        )


def test_personal_workspace_mutation_lock_serializes_account_retention_check():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        first = psycopg.connect(database_url, row_factory=compat_row_factory)
        second = psycopg.connect(database_url, row_factory=compat_row_factory)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    scope_id = personal_scope_id(f"retention-lock-{uuid.uuid4().hex}")
    first_cursor = PostgresCursor(first.cursor())
    second_cursor = PostgresCursor(second.cursor())
    try:
        assert lock_personal_workspace_mutations(first_cursor, scope_id) is True
        second_cursor.execute("SET LOCAL lock_timeout = '250ms'")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            lock_personal_workspace_mutations(second_cursor, scope_id)
        second.rollback()

        first.commit()
        assert lock_personal_workspace_mutations(second_cursor, scope_id) is True
    finally:
        first.rollback()
        second.rollback()
        first.close()
        second.close()


def test_personal_sync_rechecks_account_after_waiting_for_deletion_lock():
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        deletion = psycopg.connect(database_url, row_factory=compat_row_factory)
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    target_user_id = f"retention-sync-{uuid.uuid4().hex}"
    personal_scope = personal_scope_id(target_user_id)
    deletion_cursor = PostgresCursor(deletion.cursor())
    deletion_cursor.execute(
        """INSERT INTO tai_khoan
               (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                vai_tro, email, email_norm, da_xac_minh)
           VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1)""",
        (
            target_user_id,
            target_user_id,
            target_user_id,
            "test-password-hash",
            "Retention Sync User",
            f"{target_user_id}@example.test",
            f"{target_user_id}@example.test",
        ),
    )
    deletion.commit()
    lock_personal_workspace_mutations(deletion_cursor, personal_scope)

    def prepare_waiting_sync():
        raw_connection = psycopg.connect(database_url, row_factory=compat_row_factory)
        connection = _ConnectionProxy(raw_connection)
        cursor = connection.cursor()
        request = SimpleNamespace(
            headers={"X-Active-Org": personal_scope},
            state=SimpleNamespace(),
        )
        actor = SyncActorContext(
            request=request,
            role="user",
            user_id=target_user_id,
            organization_id=personal_scope,
            owner_type="personal",
            can_upload_workspace_assets=True,
        )
        try:
            context, response = _prepare_sync_transaction(
                connection,
                cursor,
                actor,
                SyncMutationEnvelope(payload={}, client_mutation_id="", request_hash=""),
                lambda _message: None,
            )
            return context, response
        except OrgPermissionError as error:
            return None, error
        finally:
            connection.close()

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(prepare_waiting_sync)
            with pytest.raises(FutureTimeoutError):
                future.result(timeout=0.25)

            deletion_cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (target_user_id,))
            deletion.commit()
            context, verdict = future.result(timeout=5)

        assert context is None
        assert verdict is not None
    finally:
        deletion.rollback()
        deletion_cursor.execute(
            "DELETE FROM sync_metadata WHERE organization_id = ?", (personal_scope,)
        )
        deletion_cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (target_user_id,))
        deletion.commit()
        deletion.close()


@pytest.mark.parametrize("has_personal_tombstone", (True, False))
def test_account_deletion_enforces_personal_tombstone_retention_contract(
    monkeypatch,
    has_personal_tombstone,
):
    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    try:
        setup_connection = psycopg.connect(
            database_url,
            row_factory=compat_row_factory,
        )
    except psycopg.Error as error:
        pytest.skip(f"PostgreSQL test database is unavailable: {type(error).__name__}")

    target_user_id = f"retention-user-{uuid.uuid4().hex}"
    tombstone_record_id = f"retention-record-{uuid.uuid4().hex}"
    personal_scope = personal_scope_id(target_user_id)
    setup_cursor = PostgresCursor(setup_connection.cursor())
    actor = setup_cursor.execute(
        "SELECT id FROM tai_khoan WHERE vai_tro = 'super_admin' LIMIT 1"
    ).fetchone()
    if not actor:
        setup_connection.close()
        pytest.skip("A super-admin fixture is required")
    actor_user_id = str(actor[0])
    try:
        setup_cursor.execute(
            """INSERT INTO tai_khoan
                   (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                   vai_tro, email, email_norm, da_xac_minh)
               VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 1)""",
            (
                target_user_id,
                target_user_id,
                target_user_id,
                "test-password-hash",
                "Retention Test User",
                f"{target_user_id}@example.test",
                f"{target_user_id}@example.test",
            ),
        )
        if has_personal_tombstone:
            setup_cursor.execute(
                """INSERT INTO deleted_records
                       (table_name, record_id, organization_id, delete_version,
                        record_snapshot_json, delete_actor_user_id)
                   VALUES (?, ?, ?, 1, ?, ?)""",
                (
                    "goi_thau",
                    tombstone_record_id,
                    personal_scope,
                    json.dumps({"email": f"{target_user_id}@example.test"}),
                    actor_user_id,
                ),
            )
        setup_connection.commit()

        monkeypatch.setattr(
            admin_user_routes,
            "database",
            _DatabaseProxy(database_url),
        )
        monkeypatch.setattr(
            admin_user_routes,
            "verify_session",
            lambda _request, required_role=None: (
                True,
                SimpleNamespace(user_id=actor_user_id),
            ),
        )
        monkeypatch.setattr(admin_user_routes, "log_audit", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            admin_user_routes,
            "enqueue_websocket_event",
            lambda *args, **kwargs: None,
        )

        response = admin_user_routes._delete_user_sync(
            SimpleNamespace(path_params={"user_id": target_user_id})
        )
        payload = json.loads(response.body.decode("utf-8"))

        target_row = setup_cursor.execute(
            "SELECT id FROM tai_khoan WHERE id = ?", (target_user_id,)
        ).fetchone()
        if has_personal_tombstone:
            assert response.status_code == 409
            assert payload["code"] == "ACCOUNT_DELETION_RETENTION_REVIEW_REQUIRED"
            assert payload["retentionBlockers"]["personalTombstones"] == 1
            assert target_row[0] == target_user_id
            assert setup_cursor.execute(
                "SELECT COUNT(*) FROM deleted_records WHERE organization_id = ?",
                (personal_scope,),
            ).fetchone()[0] == 1
        else:
            assert response.status_code == 200
            assert payload["success"] is True
            assert target_row is None
    finally:
        setup_connection.rollback()
        setup_cursor.execute(
            "DELETE FROM deleted_records WHERE organization_id = ?",
            (personal_scope,),
        )
        setup_cursor.execute("DELETE FROM tai_khoan WHERE id = ?", (target_user_id,))
        setup_connection.commit()
        setup_connection.close()
