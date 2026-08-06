import asyncio
import json
from types import SimpleNamespace

from backend.ai import routes
from backend.ai.types import AiRequestContext


def _context():
    return AiRequestContext(
        user_id="user-1",
        organization_id="org-1",
        organization_name="Workspace 1",
        platform_role="user",
        membership_role="member",
        scope_type="organization",
    )


def test_delete_feedback_route_removes_current_users_feedback(monkeypatch):
    calls = []

    async def context_or_response(_request):
        return _context(), None

    async def read_json(_request):
        return {"messageId": "aim-1"}, None

    async def write_database(function, *args, **kwargs):
        calls.append((function, args, kwargs))

    monkeypatch.setattr(routes, "_context_or_response", context_or_response)
    monkeypatch.setattr(routes, "read_json_object", read_json)
    monkeypatch.setattr(routes, "run_database_write", write_database)

    response = asyncio.run(routes.ai_feedback_api(SimpleNamespace(method="DELETE")))

    assert response.status_code == 200
    assert json.loads(response.body) == {"success": True, "removed": True}
    assert calls == [(routes.remove_feedback, (_context(), "aim-1"), {})]


def test_feedback_route_accepts_post_and_delete():
    feedback_routes = [route for route in routes.ai_routes if route.path == "/api/ai/feedback"]

    assert len(feedback_routes) == 1
    assert feedback_routes[0].methods == {"POST", "DELETE"}
