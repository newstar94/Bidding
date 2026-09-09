from contextlib import nullcontext

import psycopg
import pytest

from scripts import lifecycle_e2e_fixture as fixture


class CleanupCursor:
    def __init__(self, error=None):
        self.commands = []
        self.rowcount = 1
        self.error = error

    def execute(self, command, params=None):
        rendered = command if isinstance(command, str) else command.as_string()
        self.commands.append(rendered)
        if 'DELETE FROM "mutable"' in rendered and self.error:
            raise self.error
        return self


def configure_cleanup(monkeypatch, cursor):
    class Connection:
        def cursor(self):
            return nullcontext(cursor)

    monkeypatch.setenv("DATABASE_URL", "unused-test-url")
    monkeypatch.setattr(fixture.psycopg, "connect", lambda url: nullcontext(Connection()))
    monkeypatch.setattr(fixture, "_organization_tables", lambda cur: ["audit_log", "mutable"])
    monkeypatch.setattr(fixture, "_immutable_organization_tables", lambda cur: ["audit_log"])
    monkeypatch.setattr(fixture, "_organization_row_count", lambda *args: 7)


def test_cleanup_preserves_and_reports_immutable_audit_rows(monkeypatch):
    cursor = CleanupCursor()
    configure_cleanup(monkeypatch, cursor)
    result = fixture._cleanup({"organizationId": "test-org", "account": {"id": "test-user"}})
    assert result["preservedAuditRows"] == 7
    assert result["preservedImmutableRowsByTable"] == {"audit_log": 7}
    assert not any('DELETE FROM "audit_log"' in command for command in cursor.commands)
    assert result["deletedOrganizations"] == result["deletedAccounts"] == 1


def test_cleanup_rolls_back_savepoint_and_propagates_other_check_violations(monkeypatch):
    error = psycopg.errors.CheckViolation("OTHER_CONSTRAINT")
    cursor = CleanupCursor(error)
    configure_cleanup(monkeypatch, cursor)
    with pytest.raises(psycopg.errors.CheckViolation, match="OTHER_CONSTRAINT"):
        fixture._cleanup({"organizationId": "test-org", "account": {"id": "test-user"}})
    assert cursor.commands[-2:] == [
        "ROLLBACK TO SAVEPOINT lifecycle_cleanup_table",
        "RELEASE SAVEPOINT lifecycle_cleanup_table",
    ]


def test_cleanup_fails_when_foreign_key_dependencies_cannot_progress(monkeypatch):
    cursor = CleanupCursor(psycopg.errors.ForeignKeyViolation("referenced row"))
    configure_cleanup(monkeypatch, cursor)
    with pytest.raises(RuntimeError, match="could not resolve dependencies"):
        fixture._cleanup({"organizationId": "test-org", "account": {"id": "test-user"}})
    assert cursor.commands[-2:] == [
        "ROLLBACK TO SAVEPOINT lifecycle_cleanup_table",
        "RELEASE SAVEPOINT lifecycle_cleanup_table",
    ]
    assert not any("DELETE FROM to_chuc" in command for command in cursor.commands)


@pytest.mark.parametrize("role", [None, "employee"])
@pytest.mark.parametrize("seed_investor", [False, True])
def test_fixture_preserves_manager_default_and_explicit_specialist_permissions(monkeypatch, role, seed_investor):
    calls = []

    class Cursor:
        def execute(self, query, params=None):
            calls.append((query, params))

    class Connection:
        def cursor(self):
            return nullcontext(Cursor())

    monkeypatch.setenv("DATABASE_URL", "unused-test-url")
    monkeypatch.setattr(fixture.psycopg, "connect", lambda url: nullcontext(Connection()))
    monkeypatch.setattr(fixture, "hash_password", lambda password: "fixture-hash")
    payload = {
        "runId": "specialist-test", "organizationId": "test-org",
        "password": "unused",
        "account": {"id": "employee", "username": "employee", "name": "Employee",
                    "email": "employee@example.test"},
    }
    if role:
        payload["membershipRole"] = role
    payload["seedInvestor"] = seed_investor
    fixture._setup(payload)
    membership = next(params for query, params in calls if "INSERT INTO thanh_vien_to_chuc" in query)
    assert membership[2] == (role or "manager")
    permissions = [query for query, params in calls if "INSERT INTO ma_tran_phan_quyen" in query]
    if role == "employee":
        assert len(permissions) == 1
        assert permissions[0].count("'view'") == 7
        assert "'edit'" not in permissions[0]
    else:
        assert permissions == []
    metadata = next(params for query, params in calls if "INSERT INTO sync_metadata" in query)
    assert metadata == ("test-org", 1 if role == "employee" or seed_investor else 0)
    investors = [params for query, params in calls if "INSERT INTO chu_dau_tu" in query]
    assert len(investors) == int(role == "employee" or seed_investor)
    if investors:
        assert investors[0][1] == "test-org"
