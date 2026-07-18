import json

import pytest

from backend.auth.auth_helper import SessionRole
from backend.db import db_utils
from backend.db.db_helper import SQLiteDatabase
import backend.sync.service as sync_service


class _Request:
    headers = {}
    cookies = {}
    query_params = {}

    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


async def _sync(payload):
    response = await sync_service.process_sync_request(_Request(payload))
    return response, json.loads(response.body)


@pytest.mark.anyio
async def test_row_versions_isolate_unrelated_edits_detect_stale_writes_and_replay(monkeypatch, tmp_path):
    database = SQLiteDatabase(tmp_path / "row-concurrency.db")
    monkeypatch.setattr(db_utils, "database", database)
    monkeypatch.setenv("ADMIN_PASSWORD", "Test-only-password-123!")
    db_utils.khoi_tao_va_di_tru_he_thong()

    connection = database.get_connection()
    organization_id = connection.execute("SELECT id FROM to_chuc LIMIT 1").fetchone()[0]
    user_id = connection.execute("SELECT id FROM tai_khoan LIMIT 1").fetchone()[0]
    connection.close()
    role = SessionRole("super_admin", user_id)
    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(sync_service, "verify_session", lambda _request: (True, role))
    monkeypatch.setattr(sync_service, "get_active_org", lambda _request, _user: organization_id)

    first_response, first = await _sync({
        "clientMutationId": "create-status-a",
        "custompaperstatuses": [{"id": "status-a", "name": "A", "color": "#111111"}],
    })
    assert first_response.status_code == 200
    assert first["rowVersions"] == [{"table": "custompaperstatuses", "id": "status-a", "rowVersion": 1}]

    second_response, _ = await _sync({
        "clientMutationId": "create-status-b",
        "custompaperstatuses": [{"id": "status-b", "name": "B", "color": "#222222"}],
    })
    assert second_response.status_code == 200

    # The organization sequence changed when B was created, but A can still be
    # edited because concurrency is checked against A's own row version.
    # Client A commits the edit it prepared from row version 1.
    update_response, updated = await _sync({
        "clientMutationId": "update-status-a",
        "baseSyncVersion": "0",
        "custompaperstatuses": [{
            "id": "status-a", "name": "A updated", "color": "#333333",
            "expectedVersion": 1,
        }],
    })
    assert update_response.status_code == 200
    assert updated["rowVersions"][0]["rowVersion"] == 2

    # Client B prepared its edit from the same version. It must receive the
    # current server record instead of silently overwriting client A.
    stale_response, stale = await _sync({
        "clientMutationId": "stale-status-a",
        "custompaperstatuses": [{
            "id": "status-a", "name": "A stale", "color": "#444444",
            "expectedVersion": 1,
        }],
    })
    assert stale_response.status_code == 409
    assert stale["code"] == "ROW_VERSION_CONFLICT"
    conflict = stale["errors"][0]
    assert conflict["currentVersion"] == 2
    assert conflict["serverRecord"]["name"] == "A updated"

    replay_response, replay = await _sync({
        "clientMutationId": "update-status-a",
        "custompaperstatuses": [{
            "id": "status-a", "name": "must not run twice", "color": "#555555",
            "expectedVersion": 2,
        }],
    })
    assert replay_response.status_code == 200
    assert replay == updated
    connection = database.get_connection()
    row = connection.execute(
        "SELECT name, row_version FROM trang_thai_ho_so_giay WHERE id = 'status-a'"
    ).fetchone()
    connection.close()
    assert tuple(row) == ("A updated", 2)

    stale_delete_response, stale_delete = await _sync({
        "clientMutationId": "delete-status-a-stale",
        "deletions": [{"table": "custompaperstatuses", "id": "status-a", "expectedVersion": 1}],
    })
    assert stale_delete_response.status_code == 409
    assert stale_delete["errors"][0]["currentVersion"] == 2

    delete_response, _ = await _sync({
        "clientMutationId": "delete-status-a-current",
        "deletions": [{"table": "custompaperstatuses", "id": "status-a", "expectedVersion": 2}],
    })
    assert delete_response.status_code == 200
    connection = database.get_connection()
    assert connection.execute(
        "SELECT 1 FROM trang_thai_ho_so_giay WHERE id = 'status-a'"
    ).fetchone() is None
    connection.close()
