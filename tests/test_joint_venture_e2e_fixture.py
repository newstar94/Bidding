from contextlib import nullcontext

import pytest

from scripts import joint_venture_e2e_fixture as fixture


@pytest.mark.parametrize("create_account", [False, True])
def test_joint_venture_fixture_identifies_its_creator_as_organization_owner(monkeypatch, create_account):
    calls = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((query, params))
            self.query = query
            return self

        def fetchone(self):
            if "SELECT mat_khau" in self.query:
                return ("fixture-hash", "active")
            return ("creator-user",)

    class Connection:
        def cursor(self):
            return nullcontext(Cursor())

    monkeypatch.setenv("DATABASE_URL", "unused-test-url")
    monkeypatch.setattr(fixture.psycopg, "connect", lambda url: nullcontext(Connection()))
    monkeypatch.setattr(fixture, "hash_password", lambda password: "fixture-hash")
    monkeypatch.setattr(fixture, "verify_password", lambda *args: True)
    payload = {
        "runId": "joint-owner-test", "organizationId": "test-org",
        "username": "creator", "password": "unused",
        "package": {"id": "test-package", "code": "test-code", "name": "Test package", "price": 1000},
        "contractors": [],
        "fixtureDates": {key: "test-date" for key in [
            "ownerEffective", "planApproval", "packageStart", "packagePublishedAt",
            "packageClosingAt", "packageOpeningAt",
        ]},
    }
    if create_account:
        payload["account"] = {
            "id": "creator-user", "username": "creator", "name": "Creator",
            "email": "creator@example.test",
        }

    fixture._setup(payload)

    organization_sql, organization_params = next(
        (query, params) for query, params in calls if "INSERT INTO to_chuc" in query
    )
    assert "owner_user_id" in organization_sql
    assert organization_params == ("test-org", "Joint venture E2E joint-owner-test", "creator-user")
    membership_params = next(
        params for query, params in calls if "INSERT INTO thanh_vien_to_chuc" in query
    )
    assert membership_params[:2] == ("creator-user", "test-org")
