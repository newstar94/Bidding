from contextlib import nullcontext

from scripts import package_pairwise_fixture as fixture


def test_package_pairwise_fixture_identifies_its_creator_as_organization_owner(monkeypatch):
    calls = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((query, params))
            return self

    class Connection:
        def cursor(self):
            return nullcontext(Cursor())

    monkeypatch.setenv("DATABASE_URL", "unused-test-url")
    monkeypatch.setattr(fixture.psycopg, "connect", lambda url: nullcontext(Connection()))
    monkeypatch.setattr(fixture, "hash_password", lambda password: "fixture-hash")
    payload = {
        "runId": "pairwise-owner-test",
        "organizationId": "test-org",
        "password": "unused",
        "account": {
            "id": "creator-user", "username": "creator", "name": "Creator",
            "email": "creator@example.test",
        },
    }

    result = fixture._setup(payload)

    organization_index, organization_sql, organization_params = next(
        (index, query, params) for index, (query, params) in enumerate(calls)
        if "INSERT INTO to_chuc" in query
    )
    assert "owner_user_id" in organization_sql
    assert organization_params == ("test-org", "Pairwise pairwise-owner-test", "creator-user")
    account_index, account_sql, account_params = next(
        (index, query, params) for index, (query, params) in enumerate(calls)
        if "INSERT INTO tai_khoan" in query
    )
    assert account_index < organization_index
    assert account_params[0] == organization_params[2]
    assert "'user'" in account_sql
    membership_sql, membership_params = next(
        (query, params) for query, params in calls if "INSERT INTO thanh_vien_to_chuc" in query
    )
    assert "'manager'" in membership_sql
    assert membership_params == ("creator-user", "test-org", "Creator")
    assert result == {"ownerId": "pairwise-owner-test-owner", "planId": "pairwise-owner-test-plan"}
