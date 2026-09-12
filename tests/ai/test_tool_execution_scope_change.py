from types import SimpleNamespace
from dataclasses import replace

import pytest

from backend.ai import tool_executor
from backend.ai.errors import AiError
from backend.auth.session_utils import OrgPermissionError
from backend.ai.types import AiRequestContext


@pytest.mark.parametrize("user,organization", [("user-a", "org-b"), ("user-b", "org-a")])
def test_changed_identity_or_workspace_cannot_execute_planned_tool(monkeypatch, user, organization):
    planned = SimpleNamespace(user_id="user-a", organization_id="org-a")
    monkeypatch.setattr(tool_executor, "build_request_context", lambda _: SimpleNamespace(user_id=user, organization_id=organization))
    def forbidden(*args, **kwargs):
        pytest.fail("Changed scope must be rejected before tool or database execution")
    monkeypatch.setattr(tool_executor.database, "get_connection", forbidden)
    monkeypatch.setattr(tool_executor, "execute_read_tool", forbidden)
    with pytest.raises(AiError) as error:
        tool_executor.execute_tool(object(), planned, "search_workspace", {})
    assert error.value.code == "AI_SCOPE_VALIDATION_FAILED"


def test_revoked_membership_prevents_planned_tool_execution(monkeypatch):
    planned = SimpleNamespace(user_id="user-a", organization_id="org-a")
    failure = OrgPermissionError("revoked")
    def revoked(request):
        raise failure
    def forbidden(*args, **kwargs):
        pytest.fail("Revoked membership must not reach the tool")
    monkeypatch.setattr(tool_executor, "build_request_context", revoked)
    monkeypatch.setattr(tool_executor.database, "get_connection", forbidden)
    monkeypatch.setattr(tool_executor, "execute_read_tool", forbidden)
    with pytest.raises(OrgPermissionError) as error:
        tool_executor.execute_tool(object(), planned, "search_workspace", {})
    assert error.value is failure


def test_same_workspace_tool_uses_reduced_permissions_before_any_query(monkeypatch):
    planned = AiRequestContext(
        user_id="user-a", organization_id="org-a", organization_name="Workspace",
        platform_role="user", membership_role="employee", scope_type="organization",
        active_role="employee", permissions={"goithau": "view"},
    )
    fresh = replace(planned, permissions={"goithau": ""})
    closed = []
    class Connection:
        def cursor(self): return self
        def execute(self, *args, **kwargs):
            pytest.fail("A revoked module permission must not query business data")
        def close(self): closed.append(True)
    monkeypatch.setattr(tool_executor, "build_request_context", lambda _: fresh)
    monkeypatch.setattr(tool_executor.database, "get_connection", Connection)
    with pytest.raises(AiError) as error:
        tool_executor.execute_tool(object(), planned, "search_workspace", {
            "entity": "packages", "operation": "list", "query": "",
            "status": "", "packageId": "", "limit": 20,
        })
    assert error.value.code == "AI_PERMISSION_DENIED"
    assert closed == [True]
    assert planned.permissions == {"goithau": "view"}
