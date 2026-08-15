import json
import sqlite3
from types import SimpleNamespace

from backend.api import org_routes


class _Database:
    def __init__(self, connection):
        self.connection = connection

    def get_connection(self):
        return self.connection


def _connection(*, status="active", verified=1):
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE tai_khoan (
            id TEXT PRIMARY KEY,
            ho_ten TEXT,
            email TEXT,
            email_norm TEXT,
            vai_tro TEXT,
            trang_thai TEXT,
            da_xac_minh INTEGER
        );
        INSERT INTO tai_khoan
        VALUES ('candidate-1', 'New Star', 'newstar94@gmail.com',
                'newstar94@gmail.com', 'user', 'active', 1);
        """
    )
    connection.execute(
        "UPDATE tai_khoan SET trang_thai = ?, da_xac_minh = ? WHERE id = 'candidate-1'",
        (status, verified),
    )
    connection.commit()
    return connection


def _request(email="newstar94@gmail.com"):
    return SimpleNamespace(query_params={"email": email}, headers={})


def _patch_lookup(monkeypatch, connection, *, manager=True):
    monkeypatch.setattr(org_routes, "database", _Database(connection))
    monkeypatch.setattr(org_routes, "get_active_org", lambda *_args: "org-1")
    monkeypatch.setattr(org_routes, "is_business_organization", lambda *_args: True)
    monkeypatch.setattr(org_routes, "is_organization_manager", lambda *_args: manager)
    audit_events = []
    monkeypatch.setattr(
        org_routes,
        "log_audit",
        lambda action, **kwargs: audit_events.append((action, kwargs)),
    )
    return audit_events


def test_manager_can_lookup_verified_active_account_outside_current_org(monkeypatch):
    connection = _connection()
    audit_events = _patch_lookup(monkeypatch, connection)
    role = SimpleNamespace(user_id="manager-1")

    response = org_routes._lookup_membership_candidate_sync(
        _request("  NEWSTAR94@gmail.com "), role
    )
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert payload == {
        "candidate": {
            "id": "candidate-1",
            "name": "New Star",
            "email": "newstar94@gmail.com",
        }
    }
    assert audit_events[0][0] == "organization.membership_candidate_looked_up"
    assert audit_events[0][1]["organization_id"] == "org-1"
    assert audit_events[0][1]["metadata"]["found"] is True
    assert len(audit_events[0][1]["metadata"]["email_digest"]) == 16
    assert "newstar94@gmail.com" not in json.dumps(
        audit_events[0][1]["metadata"]
    )


def test_membership_candidate_lookup_denies_non_manager(monkeypatch):
    connection = _connection()
    _patch_lookup(monkeypatch, connection, manager=False)

    response = org_routes._lookup_membership_candidate_sync(
        _request(), SimpleNamespace(user_id="employee-1")
    )

    assert response.status_code == 403


def test_membership_candidate_lookup_hides_inactive_or_unverified_accounts(
    monkeypatch,
):
    for status, verified in (("inactive", 1), ("active", 0)):
        connection = _connection(status=status, verified=verified)
        _patch_lookup(monkeypatch, connection)
        response = org_routes._lookup_membership_candidate_sync(
            _request(), SimpleNamespace(user_id="manager-1")
        )
        assert response.status_code == 200
        assert json.loads(response.body) == {"candidate": None}


def test_membership_candidate_lookup_requires_exact_email(monkeypatch):
    connection = _connection()
    _patch_lookup(monkeypatch, connection)

    response = org_routes._lookup_membership_candidate_sync(
        _request("newstar94@gmail.co"), SimpleNamespace(user_id="manager-1")
    )

    assert response.status_code == 200
    assert json.loads(response.body) == {"candidate": None}


def test_ordinary_manager_cannot_identify_platform_super_admin(monkeypatch):
    connection = _connection()
    connection.execute(
        "UPDATE tai_khoan SET vai_tro = 'super_admin' WHERE id = 'candidate-1'"
    )
    connection.commit()
    _patch_lookup(monkeypatch, connection)

    response = org_routes._lookup_membership_candidate_sync(
        _request(), SimpleNamespace(user_id="manager-1", role="manager")
    )

    assert response.status_code == 200
    assert json.loads(response.body) == {"candidate": None}
