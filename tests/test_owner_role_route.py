"""Exercise the membership route with transaction/auth seams isolated."""
import asyncio
from types import SimpleNamespace

import pytest

from backend.auth import auth_routes as routes


@pytest.mark.parametrize("actor_id,target_role,new_role,manager_count,expected", [
    ("owner", "employee", "manager", 1, 200),
    ("owner", "manager", "employee", 2, 200),
    ("other-manager", "employee", "manager", 2, 403),
    ("owner", "manager", "employee", 1, 409),
])
def test_owner_can_manage_roles_with_existing_invariants(monkeypatch, actor_id, target_role,
                                                        new_role, manager_count, expected):
    actor = SimpleNamespace(user_id=actor_id, active_role="manager", platform_role="user")
    class Connection:
        def __init__(self):
            self.sql = ""
            self.writes = []
            self.committed = False
            self.rolled_back = False
        def cursor(self):
            return self
        def execute(self, sql, params=()):
            self.sql = " ".join(sql.split())
            self.params = params
            if self.sql.startswith("UPDATE"):
                self.writes.append(params)
            return self
        def fetchone(self):
            if "owner_user_id" in self.sql:
                return ("owner",)
            if "count(*)" in self.sql:
                return (manager_count,)
            if "vai_tro_trong_to_chuc" in self.sql:
                return ("manager" if self.params[0] == actor_id else target_role,)
            raise AssertionError(self.sql)
        def commit(self):
            self.committed = True
        def rollback(self):
            self.rolled_back = True
        def close(self):
            pass
    connection = Connection()
    async def read(_request):
        return {"user_id": "target", "role": new_role, "scope": "organization"}, None
    monkeypatch.setattr(routes, "read_json_object", read)
    monkeypatch.setattr(routes, "verify_session", lambda *_: (True, actor))
    monkeypatch.setattr(routes, "verify_session_in_transaction", lambda *_a, **_k: (True, actor))
    monkeypatch.setattr(routes, "_load_user_by_session_token", lambda *_: {})
    monkeypatch.setattr(routes, "verify_recent_reauthentication", lambda *_: (True, None))
    monkeypatch.setattr(routes, "validate_or_response", lambda *_: None)
    monkeypatch.setattr(routes, "get_active_org", lambda *_: "org-1")
    monkeypatch.setattr(routes, "is_business_organization", lambda *_: True)
    monkeypatch.setattr(routes, "lock_organization_membership_invariants", lambda *_: None)
    monkeypatch.setattr(routes, "log_audit", lambda *_a, **_k: None)
    monkeypatch.setattr(routes, "disconnect_user_websockets", lambda *_: None)
    monkeypatch.setattr(routes.database, "get_connection", lambda: connection)
    response = asyncio.run(routes.update_user_role_api(SimpleNamespace(cookies={}, state=SimpleNamespace())))
    assert response.status_code == expected
    assert bool(connection.writes) is (expected == 200)
    assert connection.committed is (expected == 200)
    assert connection.rolled_back is (expected != 200)
