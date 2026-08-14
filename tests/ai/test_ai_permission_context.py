from types import SimpleNamespace

import pytest

from backend.ai import permission_context
from backend.ai.workspace_search import search_workspace_records
from backend.analytics.query_scope import visibility_clause
from backend.auth.session_utils import OrgPermissionError


class _Cursor:
    def execute(self, _statement, _parameters=()):
        return self

    def fetchone(self):
        return ("HCP",)


class _Connection:
    def cursor(self):
        return _Cursor()

    def close(self):
        return None


def test_manager_context_can_read_shared_reference_modules(monkeypatch):
    request = SimpleNamespace(state=SimpleNamespace())
    session = SimpleNamespace(user_id="manager-1", platform_role="user", active_role="manager")

    monkeypatch.setattr(permission_context, "verify_session", lambda _request: (True, session))
    monkeypatch.setattr(
        permission_context,
        "get_active_org",
        lambda target, *_args, **_kwargs: (
            setattr(target.state, "organization_context", SimpleNamespace(membership_role="manager", scope_type="organization"))
            or "org-1"
        ),
    )
    monkeypatch.setattr(permission_context.database, "get_connection", lambda: _Connection())
    monkeypatch.setattr(permission_context, "has_module_permission", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(permission_context, "is_personal_scope_for_user", lambda *_args: False)

    context = permission_context.build_request_context(request)

    assert permission_context.MODULES["investors"] == "chudautu"
    assert context.permissions["chudautu"]
    assert context.permissions["nhathau"]


def test_manager_role_from_org_a_cannot_expand_employee_scope_in_org_b(monkeypatch):
    request = SimpleNamespace(state=SimpleNamespace())
    session = SimpleNamespace(
        user_id="user-1",
        platform_role="user",
        active_role="manager",
        active_role_organization_id="org-a",
    )

    monkeypatch.setattr(
        permission_context,
        "verify_session",
        lambda _request: (True, session),
    )

    def resolve_org(target, *_args, **_kwargs):
        target.state.organization_context = SimpleNamespace(
            membership_role="employee",
            scope_type="organization",
        )
        return "org-b"

    monkeypatch.setattr(permission_context, "get_active_org", resolve_org)
    monkeypatch.setattr(
        permission_context.database,
        "get_connection",
        lambda: _Connection(),
    )
    monkeypatch.setattr(
        permission_context,
        "has_module_permission",
        lambda *_args: _args[-1] == "view",
    )
    monkeypatch.setattr(
        permission_context,
        "is_personal_scope_for_user",
        lambda *_args: False,
    )

    context = permission_context.build_request_context(request)
    clause, parameters = visibility_clause(context, "packages", "pkg")

    assert context.membership_role == "employee"
    assert context.active_role == "employee"
    assert context.permissions["goithau"] == "view"
    assert "pc.id_nhan_vien = ?" in clause
    assert parameters == ("org-b", "user-1")

    class SearchCursor:
        def execute(self, statement, parameters=()):
            self.statement = " ".join(str(statement).split())
            self.parameters = tuple(parameters)
            return self

        def fetchone(self):
            return {"record_count": 0}

    search_cursor = SearchCursor()
    search_workspace_records(
        search_cursor,
        context,
        {
            "entity": "packages",
            "operation": "count",
            "query": "",
            "status": "",
            "packageId": "",
            "limit": 20,
        },
    )
    assert "pc.id_nhan_vien = ?" in search_cursor.statement
    assert search_cursor.parameters == ("org-b", "user-1")


@pytest.mark.parametrize(
    (
        "selected_role",
        "selected_organization",
        "current_organization",
        "membership_role",
        "expected_role",
    ),
    [
        ("employee", "org-a", "org-b", "manager", "manager"),
        ("manager", "org-a", "org-b", "manager", "manager"),
        ("manager", "org-a", "org-a", "employee", "employee"),
        ("manager", "org-b", "org-b", "employee", "employee"),
        ("employee", "org-b", "org-b", "manager", "employee"),
    ],
)
def test_effective_ai_role_is_rederived_from_current_membership(
    selected_role,
    selected_organization,
    current_organization,
    membership_role,
    expected_role,
):
    session = SimpleNamespace(
        platform_role="user",
        active_role=selected_role,
        active_role_organization_id=selected_organization,
    )

    assert permission_context.effective_workspace_role(
        session,
        current_organization,
        membership_role,
        "organization",
    ) == expected_role


def test_ai_context_rejects_workspace_without_current_membership(monkeypatch):
    request = SimpleNamespace(state=SimpleNamespace())
    session = SimpleNamespace(
        user_id="user-1",
        platform_role="user",
        active_role="manager",
        active_role_organization_id="org-a",
    )
    monkeypatch.setattr(
        permission_context,
        "verify_session",
        lambda _request: (True, session),
    )
    monkeypatch.setattr(
        permission_context,
        "get_active_org",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            OrgPermissionError("no membership in org-b")
        ),
    )
    monkeypatch.setattr(
        permission_context.database,
        "get_connection",
        lambda: _Connection(),
    )

    with pytest.raises(OrgPermissionError):
        permission_context.build_request_context(request)
